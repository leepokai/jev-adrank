#!/usr/bin/env node
// TikTok-Shop-style demo: a for-you feed with an in-feed shoppable ad slot on every page.
// Creative review runs once at ingest. Every ad slot is one Jev call that prices the whole auction.
import { PERSONAS } from "./src/data.js";
import { ADS } from "./src/ads.js";
import { meter, resetMeter, cost, pct, mode, PAGE } from "./src/rank.js";
import { reviewCreatives, jevBid, FLOOR_ECPM, MIN_PCTR, MIN_PCVR } from "./src/auction.js";
import { runShop } from "./src/shopsim.js";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const who = arg("user", "Kai"), pages = +arg("pages", 6), seed = +arg("seed", 11);
const user = PERSONAS.find((p) => p.name.toLowerCase() === who.toLowerCase() || p.id === who);
if (!user) { console.error(`unknown user ${who}; try ${PERSONAS.map((p) => p.name).join(", ")}`); process.exit(1); }

const c = { dim: "\x1b[2m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", b: "\x1b[36m", m: "\x1b[35m", bold: "\x1b[1m", x: "\x1b[0m" };
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const nt = (n) => "NT$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 });

console.log(`\n${c.bold}TikTok-Shop style ad stack on Jev${c.x}   backend: ${c.b}${mode()}${c.x}   ad load: 1 slot in ${PAGE}`);
console.log(`${c.dim}${user.name} (${user.id}) — ${user.profile}${c.x}\n`);

// ---------------- stage 0: creative review, once, at ingest ----------------
resetMeter();
await reviewCreatives(ADS);
const reviewLat = meter.lat[0] ?? 0, reviewCost = cost();
console.log(`${c.bold}① creative review${c.x} ${c.dim}· ${ADS.length} creatives in one call · ${reviewLat} ms · $${reviewCost.toFixed(5)}${c.x}`);
for (const a of ADS.filter((x) => x.review === "rejected" || x.hidden_policy !== "ok")) {
  const right = (a.review === "rejected") === (a.hidden_policy !== "ok");
  console.log(`   ${a.review === "rejected" ? c.r + "REJECT " + c.x : c.g + "approve" + c.x} ${c.dim}p=${(a.review_p ?? 0).toFixed(2)}${c.x} ${clip(a.review_kind ?? "-", 24)} ${clip(a.advertiser, 11)} ${c.dim}${clip(a.creative, 58)}${c.x}${right ? "" : c.y + " ← missed" + c.x}`);
}
const planted = ADS.filter((a) => a.hidden_policy !== "ok");
console.log(`   ${c.dim}caught ${planted.filter((a) => a.review === "rejected").length}/${planted.length} planted violations · ${ADS.filter((a) => a.hidden_policy === "ok" && a.review === "rejected").length} false positives on ${ADS.length - planted.length} clean creatives${c.x}\n`);

// ---------------- stage 1: the session ----------------
console.log(`${c.bold}② the feed${c.x} ${c.dim}· organic slots ranked locally, ad slot auctioned live · floor ${nt(FLOOR_ECPM)} eCPM, gates pCTR ≥ ${MIN_PCTR} and pCVR ≥ ${MIN_PCVR}${c.x}\n`);
resetMeter();
const live = await runShop(user, jevBid, { pages, seed, onPage: ({ page, rows }) => {
  console.log(`${c.bold}page ${page}${c.x}`);
  for (const r of rows) {
    if (r.kind === "organic") {
      console.log(`  ${c.dim}organic ${clip(r.item.topic, 9)}${c.x} ${clip(r.item.title, 46)} ${r.engaged ? `${c.g}✓ ${r.dwell_s}s${c.x}` : `${c.dim}✗ skip${c.x}`}`);
    } else if (r.kind === "blank") {
      console.log(`  ${c.y}AD SLOT${c.x} ${c.dim}${r.why} (${r.pool} eligible) → slot handed back to organic${c.x}`);
    } else {
      const res = r.bought ? `${c.m}✓ tapped → bought ${nt(r.ad.price_ntd)}${c.x}` : r.clicked ? `${c.g}✓ tapped${c.x}` : `${c.dim}✗ scrolled past${c.x}`;
      const flag = r.ad.hidden_policy !== "ok" ? ` ${c.r}[${r.ad.hidden_policy} slipped through]${c.x}` : "";
      console.log(`  ${c.b}AD${c.x}      ${c.dim}${clip(r.ad.category, 9)}${c.x} ${clip(r.ad.advertiser + " · " + r.ad.product, 46)} ${res}${flag}`);
      console.log(`          ${c.dim}pCTR ${(r.pCtr * 100).toFixed(1)}% · pCVR ${(r.pCvr * 100).toFixed(1)}% · eCPM ${nt(r.ecpm)} · beat ${r.depth - 1} rivals (${r.runnerUp ?? "floor"}), pays ${nt(r.price)} 2nd price${c.x}`);
      console.log(`          ${c.dim}expected from this slot: ${nt(r.eRev)} revenue, ${nt(r.eGmv)} GMV · truth: tap ${(r.pTrue * 100).toFixed(1)}%, buy ${(r.cvrTrue * 100).toFixed(1)}%${r.fallback ? c.r + " · FELL BACK: " + r.fallback : ""}${c.x}`);
    }
  }
  console.log("");
} });

const lat = [...meter.lat], calls = meter.calls, total = cost() + reviewCost, fb = meter.fallbacks;
console.log(`${c.bold}③ session totals${c.x} ${c.dim}${user.name}, ${pages} pages × ${PAGE} slots${c.x}`);
console.log(`   ad slots filled ${live.slots}${live.blanks ? `, ${live.blanks} handed back to organic` : ""} · taps ${live.clicks} · purchases ${live.purchases}`);
console.log(`   platform revenue ${nt(live.revenue)} · RPM ${nt(live.rpm)} · buyer GMV ${nt(live.gmv)} · ROAS ${live.roas.toFixed(1)}x`);
console.log(`   policy-violating impressions served: ${live.servedBad === 0 ? c.g + "0" + c.x : c.r + live.servedBad + c.x}`);
console.log(`\n${c.dim}jev: 1 review call + ${calls} auction calls · p50 ${pct(lat, 0.5)} ms · p95 ${pct(lat, 0.95)} ms · $${total.toFixed(5)}${mode() === "offline-stub" ? " projected" : ""}${fb ? ` · ${fb} fallbacks` : ""}${c.x}`);
console.log(`${c.dim}one auction = one call = $${(cost() / Math.max(1, calls)).toFixed(5)}. Single sessions are noisy — \`npm run eval\` runs the A/B.${c.x}\n`);
