// One scrolling session: retrieve -> rank -> show 5 -> the mock user reacts -> feed that back into the next page.
import { retrieve, selectPage, PAGE } from "./rank.js";
import { newSession, rng, impress, trueEngage } from "./data.js";

export async function runSession(user, arm, { pages = 6, seed = 1, onPage } = {}) {
  const rnd = rng(seed);
  const s = newSession(user);
  const m = { impressions: 0, engaged: 0, dwell: 0, ndcg: [], fallbacks: 0 };

  for (let p = 0; p < pages; p++) {
    s.page = p;
    const cands = retrieve(user, s, rnd);
    const res = await arm(user, s, cands);
    const scored = res.scored ?? res;
    const page = selectPage(scored);
    if (res.fallback) m.fallbacks++;

    const rows = [];
    for (const { item, score } of page) {
      const ev = impress(user, item, s, rnd);
      s.shown.add(item.id);
      s.topicSeen[item.topic] = (s.topicSeen[item.topic] ?? 0) + 1;
      s.events.push({ id: item.id, title: item.title, topic: item.topic, len_s: item.len_s, ...ev });
      m.impressions++; m.engaged += ev.engaged ? 1 : 0; m.dwell += ev.dwell_s;
      rows.push({ item, score, ...ev });
    }
    m.ndcg.push(ndcg(page.map((x) => x.item), cands, user, s));
    onPage?.({ page: p + 1, rows, intent: res.intent, intentP: res.intentP, fallback: res.fallback, cands });
  }
  return { ...m, ctr: m.engaged / m.impressions, dwellPerImp: m.dwell / m.impressions, ndcg: avg(m.ndcg), session: s };
}

// Relevance = the hidden true engagement probability. Measured against the best 5 the retrieval stage offered,
// and against the session state *before* this page was shown, so fatigue is scored the same for every arm.
function ndcg(shown, cands, user, s) {
  const before = { ...s.topicSeen };
  for (const it of shown) before[it.topic] = (before[it.topic] ?? 0) - 1;
  const snap = { topicSeen: before };
  const gain = (it, i) => trueEngage(user, it, snap) / Math.log2(i + 2);
  const dcg = shown.reduce((a, it, i) => a + gain(it, i), 0);
  const ideal = [...cands].sort((a, b) => trueEngage(user, b, snap) - trueEngage(user, a, snap)).slice(0, PAGE)
    .reduce((a, it, i) => a + gain(it, i), 0);
  return ideal ? dcg / ideal : 0;
}

export const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
