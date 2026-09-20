// Two-stage feed ranking. Stage 1 is cheap and local. Stage 2 is one Jev call that scores the whole
// candidate page at once — latency is flat from 1 to 40 questions, so the page costs one round-trip.
import { ask, backend } from "jev-guard/jev";
import { ITEMS, TOPICS, observable } from "./data.js";

export const PAGE = 5;
export const CANDIDATES = 20;
const PRICE_PER_MTOK = 0.042;   // vercel.com/ai-gateway/models/jev — input only, output is free

export const meter = { calls: 0, tokens: 0, lat: [], fallbacks: 0 };
export const resetMeter = () => Object.assign(meter, { calls: 0, tokens: 0, lat: [], fallbacks: 0 });
export const cost = () => (meter.tokens / 1e6) * PRICE_PER_MTOK;
export const pct = (a, q) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : 0);

export const mode = () => (process.env.JEV_REC_OFFLINE === "1" || !backend() ? "offline-stub" : backend().kind);

// ---------- stage 1: retrieval (no model, no network) ----------
export function retrieve(user, session, rnd, k = CANDIDATES) {
  const pool = ITEMS.filter((it) => !session.shown.has(it.id));
  const scored = pool.map((it) => ({
    it,
    s: (user.tags.includes(it.topic) ? 1 : 0) + 2.5 * it.ctr7d + Math.max(0, 1 - it.age_h / 168) * 0.4,
  }));
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, k - 4).map((x) => x.it);
  const rest = scored.slice(k - 4).map((x) => x.it);
  for (let n = 0; n < 4 && rest.length; n++) top.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);  // exploration tail
  return top;
}

// ---------- arms ----------
/** Classical heuristic. useSession=true adds an in-session topic bandit, which is a strong baseline. */
export function heuristic(user, session, cands, { useSession = true } = {}) {
  const seen = session.topicSeen, hit = {};
  for (const e of session.events) if (e.engaged) hit[e.topic] = (hit[e.topic] ?? 0) + 1;
  return cands.map((it) => ({
    item: it,
    score: (user.tags.includes(it.topic) ? 1 : 0) + 2.5 * it.ctr7d + Math.max(0, 1 - it.age_h / 168) * 0.4
      + (useSession ? 0.6 * (hit[it.topic] ?? 0) - 0.35 * (seen[it.topic] ?? 0) : 0),
  }));
}

/** Ceiling: ranks by the hidden truth. Not reachable, just there to make a lift readable. */
export function oracle(user, session, cands, trueEngage) {
  return cands.map((it) => ({ item: it, score: trueEngage(user, it, session) }));
}

/** Jev arm: one call, one question per candidate plus one session-level intent question. */
export async function jevRank(user, session, cands) {
  const state = {
    user: { id: user.id, profile: user.profile, stated_interests: user.tags },
    session: {
      device: "phone", surface: "for-you feed", page: session.page + 1,
      just_watched: session.events.slice(-8).map((e) => ({
        title: e.title, topic: e.topic, seconds_watched: e.dwell_s, of_seconds: e.len_s,
        outcome: e.engaged ? (e.liked ? "watched and liked" : "watched") : "skipped immediately",
      })),
      topics_already_shown: session.topicSeen,
    },
    candidates: cands.map((it, i) => ({ n: i + 1, ...observable(it) })),
  };
  const questions = Object.fromEntries(cands.map((_, i) => [`c${i + 1}`, {
    type: "noul",
    instructions: `Will this user watch candidate #${i + 1} (state.candidates) past the first few seconds instead of scrolling past it? `
      + `Weigh their stated profile, what they actually watched, liked and skipped earlier in this session (session.just_watched), `
      + `how many items of that topic they have already been shown this session, the length against their patience, and the title itself.`,
    criteria: { true: "They stop and watch a meaningful part of it.", false: "They scroll past within a few seconds." },
  }]));
  questions.intent = {
    type: "choice",
    instructions: "Given the session so far, what is this user most in the mood for on the next page?",
    criteria: Object.fromEntries(TOPICS.map((t) => [t, `More ${t} content next.`])),
  };

  const t0 = performance.now();
  try {
    const a = mode() === "offline-stub" ? stub(user, session, cands) : await ask(state, questions, {
      timeoutMs: +(process.env.JEV_REC_TIMEOUT_MS || 2500),
    });
    meter.calls++;
    meter.lat.push(Math.round(performance.now() - t0));
    meter.tokens += Math.round(Buffer.byteLength(JSON.stringify({ state, questions })) / 4);
    return {
      scored: cands.map((it, i) => ({ item: it, score: a[`c${i + 1}`]?.p ?? 0 })),
      intent: a.intent?.choice, intentP: a.intent?.probabilities?.[a.intent?.choice],
    };
  } catch (err) {
    // A ranker that hangs is worse than a ranker that is dull: fall back to stage 1's order.
    meter.fallbacks++;
    meter.lat.push(Math.round(performance.now() - t0));
    return { scored: heuristic(user, session, cands), fallback: String(err.message).slice(0, 80) };
  }
}

// ---------- page policy: code owns it, the model only answers ----------
/** Greedy pick with a same-topic discount, so a 0.9-probability topic can't eat the whole page. */
export function selectPage(scored, { pageSize = PAGE, topicDiscount = 0.3 } = {}) {
  const pool = [...scored], used = {}, out = [];
  const adj = (x) => x.score - topicDiscount * (used[x.item.topic] ?? 0);
  while (out.length < pageSize && pool.length) {
    let b = 0;
    for (let i = 1; i < pool.length; i++) if (adj(pool[i]) > adj(pool[b])) b = i;
    const [x] = pool.splice(b, 1);
    used[x.item.topic] = (used[x.item.topic] ?? 0) + 1;
    out.push(x);
  }
  return out;
}

// ---------- offline stub, so the whole thing runs with no key ----------
// Deliberately crude: stated tags + title keyword overlap + noise. It is NOT Jev, and eval says so.
function stub(user, session, cands) {
  const words = new Set((user.profile.toLowerCase().match(/[a-z]+/g) ?? []));
  const out = {};
  cands.forEach((it, i) => {
    const overlap = (it.title.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 4 && words.has(w)).length;
    const z = (user.tags.includes(it.topic) ? 1.2 : -0.4) + 0.3 * overlap + 4 * (it.ctr7d - 0.1)
      - 0.4 * (session.topicSeen[it.topic] ?? 0) - Math.abs(it.len_s - 300) / 900;
    out[`c${i + 1}`] = { p: +(1 / (1 + Math.exp(-z))).toFixed(2) };
  });
  out.intent = { choice: user.tags[0], probabilities: { [user.tags[0]]: 1 } };
  return out;
}
