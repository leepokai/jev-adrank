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

// calibration: a score at the anchor returns the creative's own prior; the batch never changes an ad's number
{
  const { TAP_ANCHOR } = await import("./src/auction.js");
  const priors = [0.02, 0.05, 0.01];
  calibrate([TAP_ANCHOR, TAP_ANCHOR, TAP_ANCHOR], priors).forEach((p, i) => assert.ok(Math.abs(p - priors[i]) < 1e-9, `anchor score must return the prior, got ${p}`));
  const spread = calibrate([0.9, TAP_ANCHOR, 0.1], priors);
  assert.ok(spread[0] > priors[0] && spread[2] < priors[2], "above the anchor lifts, below it drops");
  assert.ok(calibrate([0.9], [0.02])[0] > 0.02 && calibrate([0.1], [0.02])[0] < 0.02, "a lone bidder's answer must still count");
  assert.equal(calibrate([0.6, 0.9], [0.02, 0.02])[0], calibrate([0.6, 0.1], [0.02, 0.02])[0], "who else is bidding must not move an ad's pCTR");
  assert.ok(calibrate([1], [0.9], { hi: 0.4 })[0] <= 0.4, "calibration must stay inside the clamp");
}

// auction: never above the winner's bid, never below the reserve, the CVR gate bites
{
  const ad = (id, bid) => ({ id, bid, category: "x", hidden_policy: "ok", price_ntd: 100, hist_ctr: 0.02, hist_cvr: 0.05 });
  const win = auction([
    { ad: ad("a", 10), pCtr: 0.05, pCvr: 0.1 },
    { ad: ad("b", 8), pCtr: 0.04, pCvr: 0.1 },
  ]);
  assert.equal(win.ad.id, "a", "highest eCPM must win");
  assert.ok(win.price <= 10 && win.price < win.ad.bid, `second price ${win.price} must sit under the winner's max bid`);

  const tiny = auction([{ ad: ad("t", 0.4), pCtr: 0.04, pCvr: 0.1 }]);            // eCPM 16 clears the floor of 12
  assert.ok(tiny && tiny.price <= 0.4, `a NT$0.40 bidder must never be charged more than NT$0.40, got ${tiny?.price}`);

  const alone = auction([{ ad: ad("w", 10), pCtr: 0.02, pCvr: 0.1 }]);
  const withDud = auction([{ ad: ad("w", 10), pCtr: 0.02, pCvr: 0.1 }, { ad: ad("d", 0.5), pCtr: 0.02, pCvr: 0.1 }]);   // dud eCPM 10 < floor
  assert.equal(withDud.price, alone.price, "a runner-up under the reserve must not lower the price below the reserve");

  assert.equal(auction([{ ad: ad("c", 0.2), pCtr: 0.02, pCvr: 0.1 }]), null, "a bid under the eCPM floor must not fill the slot");
  assert.equal(auction([{ ad: ad("d", 50), pCtr: 0.2, pCvr: MIN_PCVR / 2 }]), null, "traffic that cannot convert must not be sold");
  assert.ok(auction([{ ad: ad("d", 50), pCtr: 0.2, pCvr: MIN_PCVR / 2 }], { gate: false }), "gate:false must let it through");
}

// offline review reads only the creative text, so an inventory without hidden fields still gets sane verdicts
{
  const { reviewCreatives } = await import("./src/auction.js");
  const mine = [
    { id: "m1", creative: "A plain cotton t-shirt, three colours", advertiser: "A" },
    { id: "m2", creative: "GUARANTEED 300% returns in 7 days", advertiser: "B" },
    { id: "m3", creative: "Launch week: 30% off", advertiser: "C" },
  ];
  await reviewCreatives(mine);
  assert.deepEqual(mine.map((a) => a.review), ["approved", "rejected", "approved"], "stub must not reject clean copy or a normal discount");
  assert.equal(mine[1].review_kind, "misleading_financial");
}

// argv: a flag with no value or a bad number falls back to the default instead of undefined/NaN
{
  const { args } = await import("./src/cli.js");
  const saved = process.argv;
  process.argv = ["node", "x", "--pages", "--seed", "abc", "--feed", "--user", "Mei"];
  assert.deepEqual(args({ user: "Kai", pages: 6, seed: 7, feed: false }), { user: "Mei", pages: 6, seed: 7, feed: true });
  process.argv = saved;
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
