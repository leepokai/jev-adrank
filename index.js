// Public surface. Point these at your own inventory; the objects below are the only shapes they read.
//
//   Ad      { id, advertiser, product, price_ntd, category, creative, len_s, rating,
//             bid, hist_ctr, hist_cvr }        // bid is a max CPC; hist_* are the calibration priors
//   User    { id, profile, tags }              // profile is free text — whatever you know about them
//   Session { events: [{ title, topic, dwell_s, len_s, engaged }] }   // this session, newest last
//   AdState { adSeen: {adId: n}, adSeenCat: {category: n} }           // frequency state
//
export { reviewCreatives, jevBid, bidOnly, oracleBid, auction, calibrate, eligible,
         FLOOR_ECPM, MIN_PCTR, MIN_PCVR, FREQ_CAP } from "./src/auction.js";
export { jevRank, selectPage, retrieve, heuristic, meter, resetMeter, cost, pct, mode } from "./src/rank.js";
export { COMMISSION, HARM, adView } from "./src/ads.js";
