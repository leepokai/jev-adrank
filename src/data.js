// Mock world: a catalog, three users, and the hidden truth that decides whether a user actually watches.
// Rankers only ever see `observable()` fields. The weights in PERSONAS.w are the ground truth they must infer.

export const TOPICS = ["ai-infra", "keyboards", "gamedev", "cooking", "fitness", "travel", "finance", "gossip"];

const RAW = [
  ["ai-infra", "I trained a 7B model on 4x4090 — full logs and mistakes", "infra_nerd", 620, 5, 0.07],
  ["ai-infra", "vLLM vs SGLang: throughput on one H100, measured", "serving_lab", 480, 14, 0.06],
  ["ai-infra", "Flash attention explained with pictures, no math", "paper_walk", 300, 52, 0.11],
  ["ai-infra", "Why your ANN index is slower than a full scan", "vector_dive", 410, 96, 0.05],
  ["ai-infra", "Kubernetes autoscaling for GPU pods that actually scales", "sre_daily", 700, 30, 0.04],
  ["ai-infra", "A 90-second tour of continuous batching", "serving_lab", 95, 3, 0.09],
  ["keyboards", "Keycap profiles compared: Cherry vs MT3 vs SA", "kbd_lab", 380, 30, 0.05],
  ["keyboards", "Soldering a hotswap PCB in 8 minutes", "solder_kid", 490, 8, 0.06],
  ["keyboards", "Silent switches tested with a real microphone", "kbd_lab", 260, 61, 0.07],
  ["keyboards", "Designing a 40% case in Fusion 360", "cadcad", 820, 120, 0.03],
  ["keyboards", "My endgame board after 6 years", "typeandtell", 140, 2, 0.12],
  ["keyboards", "QMK tap-dance without losing your mind", "firmware_fox", 350, 44, 0.04],
  ["gamedev", "Writing a lock-free ring buffer for my game loop", "enginedev", 540, 20, 0.05],
  ["gamedev", "Godot 5 in 100 seconds", "quickbits", 100, 6, 0.14],
  ["gamedev", "Shipping a Steam demo alone: the whole checklist", "solodev_log", 760, 40, 0.06],
  ["gamedev", "Procedural dungeons: the algorithm nobody explains", "roguelike_ray", 420, 70, 0.08],
  ["gamedev", "I rebuilt Doom's renderer in Rust", "rustyrender", 650, 11, 0.09],
  ["gamedev", "Juice: 12 tiny effects that fix a boring game", "feelgood_fx", 280, 88, 0.13],
  ["cooking", "One-pan braised pork rice in 25 minutes", "kitchen_ah", 150, 4, 0.15],
  ["cooking", "The only knife skills video you need", "chef_lin", 600, 150, 0.09],
  ["cooking", "Night market beef noodle, at home", "kitchen_ah", 210, 36, 0.12],
  ["cooking", "Sourdough without a scale (yes, really)", "bread_bro", 330, 9, 0.07],
  ["cooking", "5 lunchboxes I actually eat", "mealprep_mia", 95, 1, 0.16],
  ["cooking", "Wok hei on a home stove: tested 6 ways", "chef_lin", 420, 64, 0.08],
  ["fitness", "Push day in 20 minutes, no equipment", "lift_leo", 180, 7, 0.13],
  ["fitness", "Why your run pace stalls at month 3", "runlab", 440, 55, 0.06],
  ["fitness", "Mobility routine for people who sit 10 hours", "desk_fix", 260, 18, 0.11],
  ["fitness", "I did 100 days of kettlebells", "swing_sam", 520, 110, 0.05],
  ["travel", "Bangkok street food, 8 stalls, one night", "wander_wu", 340, 12, 0.14],
  ["travel", "Taipei to Hualien by local train, slow and cheap", "railsnail", 470, 46, 0.07],
  ["travel", "Japan rail pass is no longer worth it — the math", "budgetgo", 280, 5, 0.1],
  ["travel", "48 hours in Seoul without a plan", "wander_wu", 610, 96, 0.08],
  ["finance", "Index funds in Taiwan: fees compared", "moneymap", 500, 22, 0.06],
  ["finance", "Your first NT$100k, allocated three ways", "moneymap", 380, 130, 0.05],
  ["finance", "What a 0.3% expense ratio really costs you", "fee_watch", 200, 60, 0.07],
  ["finance", "Salary negotiation for junior engineers", "career_cash", 420, 15, 0.12],
  ["gossip", "SHOCKING: actress spotted with mystery man", "gossipdaily", 45, 1, 0.19],
  ["gossip", "TOP 10 celebrity divorces of 2026", "gossipdaily", 60, 2, 0.21],
  ["gossip", "Celebrity outfits that broke the internet", "starstyle", 50, 6, 0.18],
  ["gossip", "The feud everyone is talking about, explained", "tea_time", 120, 10, 0.17],
  ["gossip", "Morning routine of a billionaire (you won't believe #4)", "hustleporn", 90, 24, 0.16],
  ["gossip", "Idol reacts to the rumour — full clip", "tea_time", 75, 3, 0.2],
];

export const ITEMS = RAW.map(([topic, title, creator, len_s, age_h, ctr7d], i) => ({
  id: `i_${String(i + 1).padStart(3, "0")}`, topic, title, creator, len_s, age_h, ctr7d,
}));

export const PERSONAS = [
  {
    id: "u_311", name: "Kai",
    // What a ranker is allowed to see. Note gamedev is NOT in here — it is a latent taste that only
    // shows up in behaviour, which is the whole point of ranking on the live session.
    profile: "26, backend/ML engineer in Taipei. Follows LLM serving and inference infrastructure, builds mechanical keyboards. Scrolls late at night, happy to sit through a long technical video, mutes celebrity content.",
    tags: ["ai-infra", "keyboards"],
    w: { "ai-infra": 0.9, keyboards: 0.55, gamedev: 0.6, finance: 0.1, fitness: 0.0, cooking: -0.2, travel: 0.1, gossip: -0.9 },
    len_pref: 420, bias: -0.3,
  },
  {
    id: "u_702", name: "Mei",
    profile: "31, food and travel creator. Cooks most nights, plans a trip every few months, watches on a phone during commutes and bails on anything long.",
    tags: ["cooking", "travel"],
    w: { cooking: 0.9, travel: 0.8, fitness: 0.4, gossip: 0.35, finance: -0.3, "ai-infra": -0.6, keyboards: -0.7, gamedev: -0.2 },
    len_pref: 120, bias: -0.2,
  },
  {
    id: "u_945", name: "Ray",
    profile: "19, CS student. Plays and makes small games, watches a lot of dev logs, broke, easily distracted.",
    tags: ["gamedev"],
    w: { gamedev: 0.95, gossip: 0.5, "ai-infra": 0.3, keyboards: 0.45, fitness: 0.2, travel: 0.0, cooking: -0.1, finance: -0.4 },
    len_pref: 240, bias: -0.25,
  },
];

/** The only item fields a ranker may look at. */
export const observable = (it) => ({ id: it.id, title: it.title, topic: it.topic, creator: it.creator, len_s: it.len_s, age_h: it.age_h, ctr7d: it.ctr7d });

/** Hidden ground truth: probability this user watches past the first few seconds. */
export function trueEngage(user, item, session) {
  const w = user.w[item.topic] ?? 0;
  const lenFit = -Math.abs(item.len_s - user.len_pref) / 600;
  const fresh = Math.max(0, 1 - item.age_h / 72) * 0.3;
  const pop = (item.ctr7d - 0.08) * 2;
  const fatigue = -0.5 * (session.topicSeen[item.topic] ?? 0);   // the 4th cooking video in a row lands badly
  const z = 2.8 * w + 1.4 * lenFit + fresh + pop + fatigue + user.bias;
  return 1 / (1 + Math.exp(-z));
}

/** Sample one impression. dwell is seconds; a skip is 1-4s. */
export function impress(user, item, session, rnd) {
  const p = trueEngage(user, item, session);
  const engaged = rnd() < p;
  const dwell = engaged ? Math.round(item.len_s * (0.25 + 0.65 * p) * (0.7 + 0.6 * rnd())) : 1 + Math.round(3 * rnd());
  return { engaged, dwell_s: Math.min(dwell, item.len_s), p_true: p, liked: engaged && rnd() < p * 0.5 };
}

export function newSession(user) {
  return { user, topicSeen: {}, shown: new Set(), events: [], page: 0 };
}

/** mulberry32 — seeded so demo and eval are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
