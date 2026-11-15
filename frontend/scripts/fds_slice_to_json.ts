/* EXPERIMENT: turn a real NIST FDS run's slice into the replay format (src/scene/fdsSlice.ts).
   Calls the NIST fds2ascii tool once per output time (each call averages the slice over a short
   window around that time) and merges the frames into one JSON file.

   npm run fds:slice -- <run dir> [--chid firetwin_iss] [--slice 1] [--every 3] [--tend 60]
                        [--plane-y 0] [--out public/fds/nist_real_slice.json]
   --slice is the slice's index in fds2ascii's list (1 = soot density, 2 = temperature for decks
   from src/lab/fdsDeck.ts). FDS_BIN (default ~/FDS/FDS6/bin) locates fds2ascii.
   fds2ascii writes X, Z, value for a PBY slice; the plane's Y comes from --plane-y. */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2).filter(a => a !== "--");
const run = resolve(args.find(a => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--")) ?? ".");
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const chid = opt("chid", "firetwin_iss");
const slice = opt("slice", "1");
const every = +opt("every", "3"), tEnd = +opt("tend", "60"), planeY = +opt("plane-y", "0");
const out = resolve(opt("out", "public/fds/nist_real_slice.json"));
const bin = process.env.FDS_BIN ?? join(homedir(), "FDS/FDS6/bin");

const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
// Cell-centred slices (SLCC in the .smv): fds2ascii reports cell (i, k) on grid node (i + 1, k + 1),
// so drop node row/column 0 and move each value back by half a cell to the true cell centre.
const smvSlices = readFileSync(join(run, `${chid}.smv`), "utf8").split("\n").filter(l => /^SLC[CF] /.test(l));
const cellCentred = smvSlices[Number(slice) - 1]?.startsWith("SLCC") ?? false;
let keep: boolean[] = [];
let quantity = "", units = "";
let points: number[][] = [];
const times: number[] = [], values: number[][] = [];
for (let t = every; t <= tEnd + 1e-9; t += every) {
  const tmp = join(run, `_fds2ascii_${t}.csv`);
  const answers = [chid, "2", "1", "n", `${t - every / 2} ${t + every / 2}`, "1", slice, tmp].join("\n") + "\n";
  const r = spawnSync("fds2ascii", [], { cwd: run, input: answers, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`fds2ascii failed at t=${t}: ${r.stderr || r.stdout}`);
  const lines = readFileSync(tmp, "utf8").trim().split(/\r?\n/);
  rmSync(tmp);
  const head = lines[0].split(",").map(s => s.trim());
  quantity = head[2]; units = lines[1].split(",")[2].trim();
  const rows = lines.slice(2).map(l => l.split(",").map(Number));
  if (!points.length) {
    const xs = [...new Set(rows.map(r => r[0]))].sort((a, b) => a - b);
    const zs = [...new Set(rows.map(r => r[1]))].sort((a, b) => a - b);
    const hx = cellCentred ? (xs[1] - xs[0]) / 2 : 0, hz = cellCentred ? (zs[1] - zs[0]) / 2 : 0;
    keep = rows.map(([x, z]) => !cellCentred || (x > xs[0] && z > zs[0]));
    points = rows.filter((_, n) => keep[n]).map(([x, z]) => [+(x - hx).toFixed(4), planeY, +(z - hz).toFixed(4)]); // FDS X, Y, Z (up)
  }
  times.push(t);
  values.push(rows.filter((_, n) => keep[n]).map(row => row[2]));
}
mkdirSync(dirname(out), { recursive: true });
const title = readFileSync(join(run, `${chid}.fds`), "utf8").match(/TITLE='([^']*)'/)?.[1] ?? chid;
writeFileSync(out, JSON.stringify({
  format: "firetwin-fds-slice/1", quantity, units, coords: "fds",
  source: `NIST FDS 6.11.1 run: ${title} (fds2ascii, ${every} s averages${cellCentred ? ", cell-centred" : ""})`,
  times, points, values,
}));
console.log(`wrote ${out}: ${quantity} [${units}], ${points.length} points x ${times.length} times`);
