// Records the dashboard running a real session, then muxes it to mp4.
// node ui/record.mjs [--user Kai] [--pages 4] [--pace 1] [--out video/jev-rec-demo.mp4]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = `http://localhost:${process.env.PORT || 4173}/?user=${arg("user", "Kai")}&pages=${arg("pages", 4)}&pace=${arg("pace", 1)}`;
const out = resolve(arg("out", "video/jev-rec-demo.mp4"));
const raw = resolve("video/.raw");
rmSync(raw, { recursive: true, force: true });
mkdirSync(raw, { recursive: true });
mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const t0 = Date.now();
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  recordVideo: { dir: raw, size: { width: 1920, height: 1080 } },
});
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.error("page error:", m.text()));
console.log("recording", url);
await page.goto(url);
await page.waitForFunction(() => /session done|error/i.test(document.getElementById("settle")?.textContent ?? ""), null, { timeout: 600_000 });
await page.waitForTimeout(13_000);         // hold on the closing results card
const marks = await page.evaluate(() => window.__marks);
writeFileSync(resolve("video/marks.json"), JSON.stringify(marks.map((m) => ({ k: m.k, t: +((m.t - t0) / 1000).toFixed(2) })), null, 1));
await ctx.close();                        // flushes the webm
await browser.close();

const webm = join(raw, readdirSync(raw).find((f) => f.endsWith(".webm")));
execFileSync("ffmpeg", ["-y", "-i", webm, "-c:v", "libx264", "-preset", "slow", "-crf", "20",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "inherit" });
rmSync(raw, { recursive: true, force: true });
console.log("\nwrote", out);
