// The timeline cut: the real board, one page, 4K render, big type, music. No narration — it plays muted first.
// node ui/clip.mjs [--skip-record]   → video/jev-adrank-x-4k.mp4 and video/jev-adrank-x.mp4 (1080p)
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const RAW = resolve("video/.clip4k.mp4"), BED = resolve("video/.bed.wav");
const OUT4K = resolve("video/jev-adrank-x-4k.mp4"), OUT = resolve("video/jev-adrank-x.mp4");
const LOOPS = "/Library/Audio/Apple Loops/Apple/07 Chillwave";     // ships with GarageBand / Logic
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
const probe = (f) => +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim();

if (!process.argv.includes("--skip-record"))
  sh("node", ["ui/record.mjs", "--pages", "1", "--mode", "clip", "--big", "1", "--zoom", "2", "--size", "3840x2160",
    "--until", "endcard", "--hold", "3.2", "--out", RAW, "--marks", "video/marks-clip.json"]);
const dur = probe(RAW);

// Music: three loops from the same Chillwave pack (same tempo, same key), looped past the video, faded at the end.
// Apple's loop licence covers using them inside your own work; the mix is baked into the mp4 and never committed on its own.
if (existsSync(LOOPS)) {
  const reps = Math.ceil(dur / 4.8);
  sh("ffmpeg", ["-hide_banner", "-v", "error", "-y",
    "-stream_loop", String(reps), "-i", `${LOOPS}/Brooklyn Nights Synth.caf`,
    "-stream_loop", String(reps), "-i", `${LOOPS}/Brooklyn Nights Bass.caf`,
    "-stream_loop", String(reps), "-i", `${LOOPS}/80s Back Beat 01.caf`,
    "-filter_complex", "[0:a]volume=0.9[s];[1:a]volume=0.8[b];[2:a]volume=0.7[d];[s][b][d]amix=inputs=3:normalize=0,loudnorm=I=-17:TP=-1.5:LRA=9[m]",
    "-map", "[m]", "-ar", "48000", BED]);
} else {
  console.log("no Apple Loops on this machine — muxing a silent track instead");
  sh("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(dur), BED]);
}
const fade = `afade=t=in:d=0.5,afade=t=out:st=${(dur - 1.6).toFixed(2)}:d=1.6`;
sh("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-i", RAW, "-i", BED, "-filter_complex", `[1:a]${fade}[a]`,
  "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", OUT4K]);
sh("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-i", OUT4K, "-vf", "scale=1920:1080:flags=lanczos",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", OUT]);
rmSync(BED, { force: true });
console.log(`\nwrote ${OUT4K}\nwrote ${OUT}   (${dur.toFixed(1)} s)`);
