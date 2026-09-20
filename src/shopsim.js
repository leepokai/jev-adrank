// One shopping-feed session: organic slots plus an in-feed ad slot, with a real auction in between.
// `expected: true` scores each slot by its expected value instead of a coin flip — same decisions,
// far less Monte-Carlo noise, which is what you want when comparing arms.
import { newSession, rng, impress } from "./data.js";
import { ADS, newAdState, HARM, COMMISSION, trueCtr as tCtr, trueCvr as tCvr } from "./ads.js";
import { retrieve, selectPage, heuristic, PAGE } from "./rank.js";
import { eligible, auction, FLOOR_ECPM } from "./auction.js";

export async function runShop(user, bidder, { pages = 6, seed = 11, review = true, gate = true, expected = false, adSlot = 2, onPage } = {}) {
  const rnd = rng(seed), s = newSession(user), ast = newAdState();
  ast.topicAffinity = {};
  const spent = new Map();                       // per-run budgets, so arms never bleed into each other
  const left = (a) => a.daily_budget - (spent.get(a.id) ?? 0);

  for (let p = 0; p < pages; p++) {
    s.page = p;
    const cands = retrieve(user, s, rnd);
    const organic = selectPage(heuristic(user, s, cands), { pageSize: PAGE - 1 });
    const rows = [];

    for (let i = 0; i < PAGE; i++) {
      if (i === adSlot) { rows.push(await adSlotTurn()); continue; }
      const o = organic.shift();
      if (!o) continue;
      const ev = impress(user, o.item, s, rnd);
      s.shown.add(o.item.id);
      s.topicSeen[o.item.topic] = (s.topicSeen[o.item.topic] ?? 0) + 1;
      s.events.push({ id: o.item.id, title: o.item.title, topic: o.item.topic, len_s: o.item.len_s, ...ev });
      if (ev.engaged) ast.topicAffinity[o.item.topic] = (ast.topicAffinity[o.item.topic] ?? 0) + 1;
      rows.push({ kind: "organic", item: o.item, ...ev });
    }
    onPage?.({ page: p + 1, rows });
  }

  async function adSlotTurn() {
    const pool = eligible(user, ADS, ast, { review }).filter((a) => left(a) >= a.bid);
    if (!pool.length) { ast.blanks++; return { kind: "blank", pool: 0, why: "no eligible bidder" }; }
    const { scored, fallback } = await bidder(user, pool, ast, s);
    const win = auction(scored, { gate });
    if (!win) { ast.blanks++; return { kind: "blank", pool: pool.length, why: `no bid cleared the floor (eCPM < ${FLOOR_ECPM})` }; }

    const ad = win.ad;
    ast.slots++;
    ast.adSeen[ad.id] = (ast.adSeen[ad.id] ?? 0) + 1;
    ast.adSeenCat[ad.category] = (ast.adSeenCat[ad.category] ?? 0) + 1;
    const pc = tCtr(user, ad, ast), pv = tCvr(user, ad);
    let clicked, bought, rev, gmv, clicks, buys;
    if (expected) {
      clicks = pc; buys = pc * pv; rev = win.price * pc; gmv = ad.price_ntd * pc * pv;
      clicked = null; bought = null;
    } else {
      clicked = rnd() < pc; bought = clicked && rnd() < pv;
      clicks = clicked ? 1 : 0; buys = bought ? 1 : 0;
      rev = clicked ? win.price : 0; gmv = bought ? ad.price_ntd : 0;
    }
    spent.set(ad.id, (spent.get(ad.id) ?? 0) + rev);
    ast.clicks += clicks; ast.purchases += buys; ast.revenue += rev; ast.gmv += gmv;
    const harm = HARM[ad.hidden_policy] ?? 0;
    ast.harm += harm * (1 + clicks);
    if (harm) ast.servedBad++;
    return { kind: "ad", pool: pool.length, ad, price: win.price, pCtr: win.pCtr, pCvr: win.pCvr, ecpm: win.ecpm,
      depth: win.depth, runnerUp: win.runnerUp, clicked, bought, pTrue: pc, cvrTrue: pv, eRev: win.price * pc,
      eGmv: ad.price_ntd * pc * pv, fallback };
  }

  const shown = ast.slots + ast.blanks;
  return {
    slots: ast.slots, blanks: ast.blanks, clicks: ast.clicks, purchases: ast.purchases,
    revenue: ast.revenue, gmv: ast.gmv, harm: ast.harm, servedBad: ast.servedBad,
    take: ast.revenue + COMMISSION * ast.gmv,
    rpm: shown ? (ast.revenue / shown) * 1000 : 0,
    takeRpm: shown ? ((ast.revenue + COMMISSION * ast.gmv) / shown) * 1000 : 0,
    ctr: ast.slots ? ast.clicks / ast.slots : 0,
    cvr: ast.clicks ? ast.purchases / ast.clicks : 0,
    roas: ast.revenue ? ast.gmv / ast.revenue : 0,
    organicCtr: s.events.filter((e) => e.engaged).length / Math.max(1, s.events.length),
    session: s, ast,
  };
}
