// Serves the dashboard and streams a real run over SSE. Every number the page shows comes from
// an actual Jev call; the only thing this file invents is the pacing between events.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { PERSONAS } from "../src/data.js";
import { ADS } from "../src/ads.js";
import { meter, resetMeter, cost, pct, mode } from "../src/rank.js";
import { reviewCreatives, jevBid, FLOOR_ECPM, MIN_PCTR, MIN_PCVR } from "../src/auction.js";
import { runShop } from "../src/shopsim.js";

const PORT = +(process.env.PORT || 4173);
// meter and the ADS review fields are module globals, so two streams at once would clobber each other's numbers.
// ponytail: one run at a time; per-run state if this ever serves more than one viewer.
let busy = false;
process.env.JEV_REC_TIMEOUT_MS ??= "6000";   // a demo would rather wait than show the fallback path
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pages_ = { "/": "./index.html", "/short": "./short.html" };
const ab = JSON.parse(await readFile(new URL("./ab.json", import.meta.url), "utf8"));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (pages_[url.pathname]) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(await readFile(new URL(pages_[url.pathname], import.meta.url)));
  }
  if (url.pathname !== "/run") { res.writeHead(404); return res.end(); }
  // A browser that reconnects after we ended the stream would replay the whole paid pipeline. Refuse it.
  if (req.headers["last-event-id"] !== undefined) { res.writeHead(204); return res.end(); }
  if (busy) { res.writeHead(409, { "content-type": "text/plain" }); return res.end("a run is already in progress"); }
  busy = true;

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let n = 0;
  const send = (o) => res.write(`id: ${++n}\ndata: ${JSON.stringify(o)}\n\n`);
  const pace = +(url.searchParams.get("pace") ?? 1);
  const wait = (ms) => sleep(ms * pace);
  // The short cut spends its seconds where a muted viewer needs them: on the two verdicts, not on scrolling.
  const T = {
    short: { boot: 300, afterCall: 150, clean: 6, reject: 190, verdict: 1900, page: 0, organic: 0, bids: 700, win: 2100 },
    // the real board, cut to a timeline length: the feed still visibly scrolls, the two verdicts get the seconds
    clip:  { boot: 700, afterCall: 200, clean: 14, reject: 300, verdict: 1900, page: 150, organic: 280, bids: 1000, win: 2600 },
    long:  { boot: 3800, afterCall: 500, clean: 95, reject: 420, verdict: 6800, page: 500, organic: 750, bids: 1500, win: 2200 },
  }[url.searchParams.get("mode") ?? "long"] ?? { boot: 3800, afterCall: 500, clean: 95, reject: 420, verdict: 6800, page: 500, organic: 750, bids: 1500, win: 2200 };

  try {
    const user = PERSONAS.find((p) => p.name === (url.searchParams.get("user") ?? "Kai")) ?? PERSONAS[0];
    const pages = +(url.searchParams.get("pages") ?? 4);
    send({ type: "boot", user: { name: user.name, id: user.id, profile: user.profile, tags: user.tags },
      backend: mode(), creatives: ADS.length, floor: FLOOR_ECPM, minPctr: MIN_PCTR, minPcvr: MIN_PCVR, pages });
    await wait(T.boot);

    // ---- stage 1: creative review, one call, revealed row by row ----
    resetMeter();
    send({ type: "review-start", ads: ADS.map((a) => ({ id: a.id, advertiser: a.advertiser, product: a.product, creative: a.creative })) });
    await reviewCreatives(ADS);
    const reviewMs = meter.lat[0] ?? 0, reviewCost = cost();
    send({ type: "review-call", ms: reviewMs, cost: reviewCost, n: ADS.length });
    await wait(T.afterCall);
    for (const a of ADS) {
      send({ type: "review-row", id: a.id, verdict: a.review, p: a.review_p, kind: a.review_kind, truth: a.hidden_policy });
      await wait(a.review === "rejected" ? T.reject : T.clean);
    }
    const planted = ADS.filter((a) => a.hidden_policy !== "ok");
    send({ type: "review-done", caught: planted.filter((a) => a.review === "rejected").length, planted: planted.length,
      falsePos: ADS.filter((a) => a.hidden_policy === "ok" && a.review === "rejected").length, clean: ADS.length - planted.length });
    await wait(T.verdict);

    // ---- stage 2: the feed, one auction per page ----
    resetMeter();
    send({ type: "feed-start" });
    const out = await runShop(user, jevBid, { pages, seed: 11, onEvent: async (e) => {
      if (e.type === "page") { send({ type: "page", page: e.page }); return wait(T.page); }
      if (e.type === "organic") {
        send({ type: "organic", title: e.item.title, topic: e.item.topic, len_s: e.item.len_s, engaged: e.engaged, dwell_s: e.dwell_s });
        return wait(T.organic);
      }
      if (e.type === "bids") { send({ type: "bids", rows: e.rows, ms: e.bidMs, fallback: e.fallback }); return wait(T.bids); }
      if (e.kind === "blank") { send({ type: "blank", why: e.why, pool: e.pool }); return wait(900); }
      if (e.kind === "ad") {
        send({ type: "win", id: e.ad.id, advertiser: e.ad.advertiser, product: e.ad.product, category: e.ad.category, price_ntd: e.ad.price_ntd,
          creative: e.ad.creative, paid: e.price, runnerUp: e.runnerUp, depth: e.depth, pCtr: e.pCtr, pCvr: e.pCvr, ecpm: e.ecpm,
          clicked: e.clicked, bought: e.bought, eRev: e.eRev, eGmv: e.eGmv, pTrue: e.pTrue, totals: e.totals,
          meters: { calls: meter.calls, p50: pct(meter.lat, 0.5), last: meter.lat.at(-1), cost: cost() + reviewCost } });
        return wait(T.win);
      }
    } });
    send({ type: "done", ...out, session: undefined, ast: undefined, ab,
      meters: { calls: meter.calls, p50: pct(meter.lat, 0.5), p95: pct(meter.lat, 0.95), cost: cost() + reviewCost, reviewCost } });
  } catch (err) {
    send({ type: "error", message: String(err.message ?? err) });
  } finally {
    busy = false;
  }
  res.end();
}).listen(PORT, () => console.log(`ui on http://localhost:${PORT}  (backend: ${mode()})`));
