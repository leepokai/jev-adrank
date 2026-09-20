// One argv reader for every script here. A flag with no value, or a non-number where a number is
// expected, falls back to the default instead of leaking undefined/NaN into a seed or a loop bound.
import { parseArgs } from "node:util";

export function args(spec) {
  const options = Object.fromEntries(Object.entries(spec).map(([k, d]) => [k, { type: typeof d === "boolean" ? "boolean" : "string" }]));
  let values = {};
  try { ({ values } = parseArgs({ options, strict: false, allowPositionals: true })); } catch { /* fall through to defaults */ }
  const out = {};
  for (const [k, d] of Object.entries(spec)) {
    const v = values[k];
    if (typeof d === "boolean") out[k] = v === true;
    else if (v === undefined || v === true || (typeof v === "string" && v.startsWith("--"))) out[k] = d;
    else if (typeof d === "number") out[k] = Number.isFinite(+v) && v !== "" ? +v : d;
    else out[k] = v;
  }
  return out;
}
