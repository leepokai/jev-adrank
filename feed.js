#!/usr/bin/env node
// Live demo: one user scrolling a for-you feed, ranked page by page by Jev, reacting as they go.
import { PERSONAS, trueEngage } from "./src/data.js";
import { jevRank, heuristic, oracle, meter, resetMeter, cost, pct, mode, PAGE } from "./src/rank.js";
import { runSession } from "./src/session.js";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const who = arg("user", "Kai"), pages = +arg("pages", 6), seed = +arg("seed", 7);
const user = PERSONAS.find((p) => p.name.toLowerCase() === who.toLowerCase() || p.id === who);
if (!user) { console.error(`unknown user ${who}; try: ${PERSONAS.map((p) => p.name).join(", ")}`); process.exit(1); }

const c = { dim: "\x1b[2m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", b: "\x1b[36m", bold: "\x1b[1m", x: "\x1b[0m" };
const bar = (p, n = 12) => { const k = Math.max(0, Math.min(n, Math.round(p * n))); return "█".repeat(k) + c.dim + "·".repeat(n - k) + c.x; };
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

console.log(`\n${c.bold}Real-time feed ranking with Jev${c.x}   backend: ${c.b}${mode()}${c.x}   ${PAGE} slots/page, 20 candidates/page\n`);
console.log(`${c.bold}${user.name}${c.x} (${user.id})  ${c.dim}${user.profile}${c.x}`);
console.log(`${c.dim}stated interests: ${user.tags.join(", ")}   · hidden truth the ranker never sees: ${Object.entries(user.w).filter(([, v]) => v > 0.4).map(([k, v]) => `${k} ${v}`).join(", ")}${c.x}\n`);

resetMeter();
const jev = await runSession(user, jevRank, { pages, seed, onPage: ({ page, rows, intent, intentP, fallback }) => {
  const lat = meter.lat[meter.lat.length - 1];
  console.log(`${c.bold}page ${page}${c.x} ${c.dim}· ranked in ${lat} ms${fallback ? c.r + ` · FELL BACK (${fallback})` + c.x : ""}${c.x}`
    + (intent ? `  ${c.dim}next-page intent:${c.x} ${c.y}${intent}${c.x}${intentP ? c.dim + ` p=${intentP.toFixed(2)}` + c.x : ""}` : ""));
  rows.forEach((r, i) => {
    const out = r.engaged ? `${c.g}✓ watched ${r.dwell_s}s${r.liked ? " ♥" : ""}${c.x}` : `${c.dim}✗ skipped${c.x}`;
    console.log(`  ${c.dim}#${i + 1}${c.x} ${r.score.toFixed(2)} ${bar(r.score)} ${c.dim}${clip(r.item.topic, 9)}${c.x} ${clip(r.item.title, 46)} ${c.dim}${String(r.item.len_s).padStart(3)}s${c.x}  ${out.padEnd(22)} ${c.dim}true ${r.p_true.toFixed(2)}${c.x}`);
  });
  console.log("");
} });

const jevLat = [...meter.lat], jevCalls = meter.calls, jevCost = cost(), jevFb = meter.fallbacks;
resetMeter();
const base = await runSession(user, (u, s, cd) => heuristic(u, s, cd), { pages, seed });
const pop = await runSession(user, (u, s, cd) => heuristic(u, s, cd, { useSession: false }), { pages, seed });
const orc = await runSession(user, (u, s, cd) => oracle(u, s, cd, trueEngage), { pages, seed });

const row = (n, m, extra = "") => `  ${n.padEnd(26)} ${String((m.ctr * 100).toFixed(0) + "%").padStart(5)}   ${m.dwellPerImp.toFixed(0).padStart(4)}s   ${m.ndcg.toFixed(3)}   ${extra}`;
console.log(`${c.bold}session totals${c.x} ${c.dim}(${pages} pages × ${PAGE} slots, same seed, same candidate pool)${c.x}`);
console.log(`  ${"arm".padEnd(26)} ${"CTR".padStart(5)}   dwell   NDCG@5`);
console.log(row("popularity + tags", pop));
console.log(row("+ in-session bandit", base));
console.log(c.b + row(`jev (${jevCalls} calls)`, jev, `${c.dim}p50 ${pct(jevLat, 0.5)} ms · p95 ${pct(jevLat, 0.95)} ms · $${jevCost.toFixed(5)}${mode() === "offline-stub" ? " projected" : ""}${jevFb ? ` · ${jevFb} fallbacks` : ""}`) + c.x);
console.log(c.dim + row("oracle (hidden truth)", orc) + c.x);

const learned = Object.entries(jev.session.topicSeen).filter(([t]) => !user.tags.includes(t) && (user.w[t] ?? 0) > 0.4);
if (learned.length) console.log(`\n${c.y}picked up in-session:${c.x} ${learned.map(([t, n]) => `${t} (${n} slots, never in the stated profile)`).join(", ")}`);
console.log(`\n${c.dim}cost model: $0.042 / 1M input tokens, $0 output → $${(jevCost / (pages || 1)).toFixed(5)} per page, ~$${((jevCost / pages) * 1e6).toFixed(0)} per 1M feed pages${c.x}\n`);
