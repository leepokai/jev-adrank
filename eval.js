#!/usr/bin/env node
// A/B over the ad stack. Every arm sees the same users, the same seeds and the same inventory;
// slots are scored by expected value against the hidden truth, so the ranking difference is what moves.
import { PERSONAS } from "./src/data.js";
import { ADS } from "./src/ads.js";
import { meter, resetMeter, cost, pct, mode } from "./src/rank.js";
import { reviewCreatives, jevBid, bidOnly, oracleBid } from "./src/auction.js";
import { runShop } from "./src/shopsim.js";
import { runSession } from "./src/session.js";
import { jevRank, heuristic, oracle } from "./src/rank.js";
import { trueEngage } from "./src/data.js";

import { args } from "./src/cli.js";
const { sessions, pages, concurrency: conc, feed: FEED } = args({ sessions: 4, pages: 6, concurrency: 4, feed: false });
const c = { dim: "\x1b[2m", g: "\x1b[32m", r: "\x1b[31m", b: "\x1b[36m", bold: "\x1b[1m", x: "\x1b[0m" };
const nt = (n) => "NT$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 1 : 0 });

// --feed evaluates the organic ranker on its own, away from the ad stack.
if (FEED) {
  const runsF = PERSONAS.flatMap((u) => Array.from({ length: sessions }, (_, k) => ({ user: u, seed: 100 + k * 17 })));
  console.log(`\n${c.bold}organic feed A/B${c.x} ${c.dim}· backend ${mode()} · ${runsF.length} sessions × ${pages} pages${c.x}\n`);
  const armsF = [
    ["popularity + tags", (u, s, cd) => heuristic(u, s, cd, { useSession: false })],
    ["+ in-session bandit", (u, s, cd) => heuristic(u, s, cd)],
    ["jev", jevRank],
    ["oracle (hidden truth)", (u, s, cd) => oracle(u, s, cd, trueEngage)],
  ];
  console.log(c.dim + `  ${"arm".padEnd(22)} ${"CTR".padStart(6)} ${"dwell".padStart(6)} ${"NDCG@5".padStart(7)} ${"latent".padStart(7)}` + c.x);
  for (const [name, arm] of armsF) {
    resetMeter();
    const out = await pool(runsF, conc, ({ user, seed }) => runSession(user, arm, { pages, seed }));
    const mean = (f) => out.reduce((a, m) => a + f(m), 0) / out.length;
    // latent = share of slots spent on a topic the user really likes but never stated
    const latent = mean((m) => {
      const u = m.session.user, ev = m.session.events;
      return ev.filter((e) => !u.tags.includes(e.topic) && (u.w[e.topic] ?? 0) > 0.4).length / Math.max(1, ev.length);
    });
    const line = `  ${name.padEnd(22)} ${(mean((m) => m.ctr) * 100).toFixed(1).padStart(5)}% ${mean((m) => m.dwellPerImp).toFixed(0).padStart(5)}s ${mean((m) => m.ndcg).toFixed(3).padStart(7)} ${(latent * 100).toFixed(0).padStart(6)}%`
      + (meter.calls ? c.dim + `  ${meter.calls} calls · p50 ${pct(meter.lat, 0.5)} ms · $${cost().toFixed(4)}` + c.x : "");
    console.log(name === "jev" ? c.b + line + c.x : name.startsWith("oracle") ? c.dim + line + c.x : line);
  }
  console.log(`\n${c.dim}latent = share of slots given to a topic the user genuinely likes but never put in their profile — it can only be found from behaviour in the session.${c.x}\n`);
  process.exit(0);
}

const runs = PERSONAS.flatMap((u) => Array.from({ length: sessions }, (_, k) => ({ user: u, seed: 100 + k * 17 })));
console.log(`\n${c.bold}ad stack A/B${c.x} ${c.dim}· backend ${mode()} · ${PERSONAS.length} users × ${sessions} sessions × ${pages} pages = ${runs.length * pages} ad slots per arm${c.x}`);
if (mode() === "offline-stub") console.log(`${c.r}offline stub: the "jev" arms are a keyword heuristic, not the model. Numbers mean nothing until you set a key.${c.x}`);

resetMeter();
await reviewCreatives(ADS);
const reviewCost = cost();
const planted = ADS.filter((a) => a.hidden_policy !== "ok");
console.log(`${c.dim}review: caught ${planted.filter((a) => a.review === "rejected").length}/${planted.length} planted violations, ${ADS.filter((a) => a.hidden_policy === "ok" && a.review === "rejected").length} false positives, ${meter.lat[0] ?? 0} ms${c.x}\n`);

const ARMS = [
  ["bid × lifetime CTR", bidOnly, { review: false, gate: false }],
  ["+ creative review", bidOnly, { review: true, gate: false }],
  ["jev, review skipped", jevBid, { review: false, gate: true }],
  ["jev + review", jevBid, { review: true, gate: true }],
  ["oracle (hidden truth)", oracleBid, { review: true, gate: true }],
];

const results = [];
for (const [name, bidder, opts] of ARMS) {
  resetMeter();
  const t0 = performance.now();
  const out = await pool(runs, conc, ({ user, seed }) => runShop(user, bidder, { ...opts, pages, seed, expected: true }));
  const sum = (f) => out.reduce((a, m) => a + f(m), 0);
  const slots = sum((m) => m.slots), shown = slots + sum((m) => m.blanks);
  results.push({
    name, slots, blanks: sum((m) => m.blanks),
    rpm: (sum((m) => m.revenue) / Math.max(1, shown)) * 1000,
    takeRpm: (sum((m) => m.take) / Math.max(1, shown)) * 1000,
    ctr: sum((m) => m.clicks) / Math.max(1, slots),
    cvr: sum((m) => m.purchases) / Math.max(1e-9, sum((m) => m.clicks)),
    revenue: sum((m) => m.revenue), gmv: sum((m) => m.gmv),
    roas: sum((m) => m.gmv) / Math.max(1e-9, sum((m) => m.revenue)),
    bad: sum((m) => m.servedBad), harm: sum((m) => m.harm),
    calls: meter.calls, lat: [...meter.lat], cost: cost(), fb: meter.fallbacks, wall: Math.round(performance.now() - t0),
  });
  process.stdout.write(`${c.dim}ran ${name}${results.at(-1).calls ? ` (${results.at(-1).calls} calls, ${Math.round(results.at(-1).wall / 1000)}s)` : ""}${c.x}\n`);
}

const base = results[1];   // like-for-like: arm 1 buys its RPM with the impressions in its "bad" column
const hdr = `  ${"arm".padEnd(22)} ${"adRPM".padStart(7)} ${"takeRPM".padStart(8)} ${"lift".padStart(6)} ${"adCTR".padStart(6)} ${"CVR".padStart(6)} ${"GMV".padStart(9)} ${"ROAS".padStart(6)} ${"bad".padStart(4)} ${"harm".padStart(6)}`;
console.log(`\n${c.bold}results${c.x} ${c.dim}(expected value per slot, ${runs.length * pages} slots per arm)${c.x}`);
console.log(c.dim + hdr + c.x);
for (const r of results) {
  const lift = base.takeRpm ? ((r.takeRpm / base.takeRpm - 1) * 100).toFixed(0) + "%" : "—";
  const line = `  ${r.name.padEnd(22)} ${nt(r.rpm).padStart(7)} ${nt(r.takeRpm).padStart(8)} ${lift.padStart(6)} ${(r.ctr * 100).toFixed(2).padStart(5)}% ${(r.cvr * 100).toFixed(1).padStart(5)}% ${nt(r.gmv).padStart(9)} ${r.roas.toFixed(1).padStart(5)}x ${String(r.bad).padStart(4)} ${r.harm.toFixed(1).padStart(6)}`
    + (r.fb ? c.r + `  ${r.fb}/${r.calls + r.fb} calls fell back` + c.x : "");
  console.log(r.name === "jev + review" ? c.b + line + c.x : r.name.startsWith("oracle") ? c.dim + line + c.x : line);
}

const jev = results.find((r) => r.name === "jev + review");
console.log(`\n${c.dim}lift is against "+ creative review", not arm 1: arm 1\u2019s RPM is funded by the impressions in its "bad" column.\nadRPM = CPC revenue per 1000 slots · takeRPM = CPC revenue + 5% Shop commission on GMV, the number the marketplace actually banks · ROAS = buyer spend per NT$1 of ad revenue · blank = slots handed back to organic`);
console.log(`bad = policy-violating impressions served · harm = weighted user-trust cost${c.x}`);
console.log(`${c.dim}jev arms: ${jev.calls} auction calls, p50 ${pct(jev.lat, 0.5)} ms, p95 ${pct(jev.lat, 0.95)} ms, $${(jev.cost + reviewCost).toFixed(4)} for the whole run${jev.fb ? `, ${jev.fb} fallbacks` : ""}${c.x}`);
console.log(`${c.dim}at $${(jev.cost / Math.max(1, jev.calls) * 1e6).toFixed(0)} per 1M auctions, ranking costs ${((jev.cost / Math.max(1, jev.calls)) / (jev.takeRpm / 1000 / 31.5) * 100).toFixed(2)}% of the take it prices${c.x}\n`);

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n | 0, items.length)) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}
