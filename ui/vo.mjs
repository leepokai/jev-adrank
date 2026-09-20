// Voiceover for the recording: one mp3 per line via edge-tts (free Microsoft voices, no key),
// each placed at a timestamp resolved from video/marks.json — the real event times of that take.
// Usage: node ui/vo.mjs [--in video/jev-adrank-silent.mp4] [--out video/jev-adrank.mp4]
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { args } from "../src/cli.js";
const A = args({ in: "video/jev-adrank-silent.mp4", out: "video/jev-adrank.mp4", force: false });
const vid = resolve(A.in), out = resolve(A.out);
const dir = resolve("video/vo");
mkdirSync(dir, { recursive: true });

const { voice, rate, lines } = JSON.parse(readFileSync(resolve("ui/vo.json"), "utf8"));
const marks = JSON.parse(readFileSync(resolve("video/marks.json"), "utf8"));

/** "bids#2+1.0" -> seconds. Bare "key+n" means the first occurrence. */
function resolveAt(at) {
  const [spec, off = "0"] = at.split("+");
  const [key, nth = "1"] = spec.split("#");
  const hits = marks.filter((m) => m.k === key);
  if (!hits[+nth - 1]) throw new Error(`no mark ${spec} in marks.json (have: ${[...new Set(marks.map((m) => m.k))].join(", ")})`);
  return +(hits[+nth - 1].t + +off).toFixed(2);
}

const clips = lines.map((l) => {
  const mp3 = resolve(dir, `${l.id}.mp3`);
  if (!existsSync(mp3) || A.force)
    execFileSync("uvx", ["edge-tts", "--voice", voice, "--rate", rate, "--text", l.text, "--write-media", mp3], { stdio: "inherit" });
  const secs = +(execFileSync("afinfo", [mp3]).toString().match(/estimated duration: ([\d.]+)/)?.[1] ?? 0);
  return { ...l, mp3, at: resolveAt(l.at), secs };
});

let clash = 0;
clips.sort((a, b) => a.at - b.at).forEach((c, i) => {
  const next = clips[i + 1];
  const over = next ? c.at + c.secs - next.at : 0;
  if (over > 0.25) clash++;
  console.log(`${String(c.at).padStart(6)}s  ${c.secs.toFixed(1)}s  ${c.id.padEnd(9)}${over > 0.25 ? `  overruns ${c.id === clips.at(-1)?.id ? "" : next.id} by ${over.toFixed(1)}s` : ""}`);
});
const dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", vid]).toString().trim();
const tail = clips.at(-1).at + clips.at(-1).secs - dur;
if (tail > 0) console.log(`\nlast line runs ${tail.toFixed(1)}s past the end of the video — re-record with a longer hold or trim the line`);
if (clash) console.log(`${clash} line(s) overlap the next by more than 0.25s`);

const ff = ["-y", "-i", vid, ...clips.flatMap((c) => ["-i", c.mp3])];
const filter = clips.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.at * 1000)}:all=1[a${i}]`).join(";")
  + ";" + clips.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${clips.length}:normalize=0:dropout_transition=0[vo]`;
execFileSync("ffmpeg", [...ff, "-filter_complex", filter, "-map", "0:v", "-map", "[vo]",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out], { stdio: "inherit" });
console.log("\nwrote", out);
