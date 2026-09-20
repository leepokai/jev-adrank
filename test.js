#!/usr/bin/env node
// One runnable check for the parts that would silently produce wrong money: calibration, the auction,
// and page selection. Runs offline, no key, no network.  node test.js
import assert from "node:assert/strict";
process.env.JEV_REC_OFFLINE = "1";

const { calibrate, auction, FLOOR_ECPM, MIN_PCVR } = await import("./src/auction.js");
const { selectPage, retrieve } = await import("./src/rank.js");
const { PERSONAS, newSession, rng } = await import("./src/data.js");
const { runShop } = await import("./src/shopsim.js");
const { jevBid } = await import("./src/auction.js");

// calibration: an undifferentiated batch must fall back to each creative's own prior
{
  const priors = [0.02, 0.05, 0.01];
  const flat = calibrate([0.4, 0.4, 0.4], priors);
  flat.forEach((p, i) => assert.ok(Math.abs(p - priors[i]) < 1e-9, `flat scores should return the prior, got ${p}`));
  const spread = calibrate([0.9, 0.4, 0.1], priors);
  assert.ok(spread[0] > priors[0] && spread[2] < priors[2], "a higher score must lift above its prior, a lower one must fall below");
  assert.ok(calibrate([1], [0.9], { hi: 0.4 })[0] <= 0.4, "calibration must stay inside the clamp");
}

// auction: second price never exceeds the winner's bid, the floor is respected, the CVR gate bites
{
  const ad = (id, bid) => ({ id, bid, category: "x", hidden_policy: "ok", price_ntd: 100, hist_ctr: 0.02, hist_cvr: 0.05 });
  const win = auction([
    { ad: ad("a", 10), pCtr: 0.05, pCvr: 0.1 },
    { ad: ad("b", 8), pCtr: 0.04, pCvr: 0.1 },
  ]);
  assert.equal(win.ad.id, "a", "highest eCPM must win");
  assert.ok(win.price <= 10, `second price ${win.price} must not exceed the bid`);
  assert.ok(win.price < win.ad.bid, "with a runner-up present, the winner should pay less than its max bid");

  assert.equal(auction([{ ad: ad("c", 0.2), pCtr: 0.02, pCvr: 0.1 }]), null, "a bid under the eCPM floor must not fill the slot");
  assert.equal(auction([{ ad: ad("d", 50), pCtr: 0.2, pCvr: MIN_PCVR / 2 }]), null, "traffic that cannot convert must not be sold");
  assert.ok(auction([{ ad: ad("d", 50), pCtr: 0.2, pCvr: MIN_PCVR / 2 }], { gate: false }), "gate:false must let it through");
}

// page selection: fills the page, never repeats an item, and does not let one topic take every slot
{
  const items = Array.from({ length: 12 }, (_, i) => ({ item: { id: `i${i}`, topic: i < 8 ? "a" : "b" }, score: i < 8 ? 0.9 : 0.5 }));
  const page = selectPage(items, { pageSize: 5 });
  assert.equal(page.length, 5);
  assert.equal(new Set(page.map((x) => x.item.id)).size, 5, "no duplicate slots");
  assert.ok(page.some((x) => x.item.topic === "b"), "topic discount must break a single-topic sweep");
}

// retrieval never re-serves something the session already showed
{
  const u = PERSONAS[0], s = newSession(u), r = rng(1);
  const first = retrieve(u, s, r);
  first.forEach((it) => s.shown.add(it.id));
  assert.ok(retrieve(u, s, r).every((it) => !s.shown.has(it.id)), "retrieval must exclude already-shown items");
}

// end to end, offline: budgets hold, no rejected creative is ever served, money adds up
{
  const { ADS } = await import("./src/ads.js");
  const { reviewCreatives } = await import("./src/auction.js");
  await reviewCreatives(ADS);
  const m = await runShop(PERSONAS[0], jevBid, { pages: 6, seed: 5, expected: true });
  assert.ok(m.slots + m.blanks === 6, `every page must resolve its ad slot, got ${m.slots}+${m.blanks}`);
  assert.equal(m.servedBad, 0, "a rejected creative must never reach a slot");
  assert.ok(m.revenue >= 0 && m.gmv >= 0 && m.take >= m.revenue, "take must include the commission on GMV");
  assert.ok(m.ctr > 0 && m.ctr < 0.5, `expected CTR should stay in ad territory, got ${m.ctr}`);
}

console.log("ok — calibration, auction, page policy, retrieval and one end-to-end session");
