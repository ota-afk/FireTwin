/* EXPERIMENT: calibrate the live g = 0 SootField against real NIST FDS runs.
   For each run in fds_runs/heptane_o2_30_f<cm/s>/ (decks from src/lab/fdsDeck.ts: 0.25 m grid,
   35 x 11 x 11, open supply/exhaust walls, no vent suction), the live solver is run on the same grid
   with the same boundaries and FDS's own heat-release history (firetwin_iss_hrr.csv), and the soot
   on the slice through the fire (soot.json from npm run fds:slice) is compared as normalised
   distributions (L1 distance, 0 = identical, 2 = disjoint) at 15, 30, 45 and 60 s.
   Stage 1 fits still-air diffusion and thermal expansion on 0 and 1 cm/s; stage 2 fits forced-flow
   eddy mixing on 4, 10 and 20 cm/s.  npx vite-node scripts/calibrate_fds.ts */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SootField, type TransportParams, UNCALIBRATED } from "../src/scene/microgravity";

const RUNS = resolve(process.argv[2] ?? "../fds_runs");
const CASES = [0, 1, 4, 10, 20];
const FRAMES = [15, 30, 45, 60];

interface Case { cmS: number; fds: Map<number, Float64Array>; hrr: [number, number][] }
function load(cmS: number): Case {
  const dir = join(RUNS, `heptane_o2_30_f${cmS}`);
  const s = JSON.parse(readFileSync(join(dir, "soot.json"), "utf8"));
  const fds = new Map<number, Float64Array>();
  // fds2ascii lists 36 x 12 grid nodes, X fastest; a cell-centred slice reports cell (i, k) on node
  // (i + 1, k + 1) (checked: the solid burner cell shows up as the zero at node (18, 6)).
  s.times.forEach((t: number, n: number) => {
    if (!FRAMES.includes(t)) return;
    const plane = new Float64Array(35 * 11);
    for (let iz = 0; iz < 11; iz++) for (let ix = 0; ix < 35; ix++) plane[ix + 35 * iz] = Math.max(0, s.values[n][ix + 1 + 36 * (iz + 1)]);
    fds.set(t, plane);
  });
  const hrr = readFileSync(join(dir, "firetwin_iss_hrr.csv"), "utf8").trim().split("\n").slice(2)
    .map(l => l.split(",").map(Number)).map(r => [r[0], Math.max(0, r[1])] as [number, number]);
  return { cmS, fds, hrr };
}
const hrrAt = (h: [number, number][], t: number) => {
  let i = 0;
  while (i < h.length - 1 && h[i + 1][0] <= t) i++;
  if (i >= h.length - 1) return h[h.length - 1][1];
  const [t0, q0] = h[i], [t1, q1] = h[i + 1];
  return q0 + (q1 - q0) * ((t - t0) / Math.max(1e-9, t1 - t0));
};

function simulate(c: Case, params: Partial<TransportParams>): Map<number, Float64Array> {
  const f = new SootField(35, 11, 11, params);
  const out = new Map<number, Float64Array>();
  const k = 5; // scene z = 0 = FDS Y = 0 (the slice plane)
  const dt = 0.5;
  for (let t = 0; t < 60 + 1e-9; t += dt) {
    const q = hrrAt(c.hrr, t + dt / 2);
    f.step(dt, { emitting: q > 0, source: q, dir: [1, 0, 0], speedMS: c.cmS / 100, vents: [], hrrKw: q, openEnds: true });
    const tt = Math.round((t + dt) * 10) / 10;
    if (FRAMES.includes(tt)) {
      const plane = new Float64Array(35 * 11);
      for (let j = 0; j < 11; j++) for (let i = 0; i < 35; i++) plane[i + 35 * j] = f.c[f.idx(i, j, k)];
      out.set(tt, plane);
    }
  }
  return out;
}

const norm = (a: Float64Array) => { let s = 0; for (const v of a) s += v; return s > 0 ? a.map(v => v / s) : a; };
function l1(a: Float64Array, b: Float64Array) { const p = norm(a), q = norm(b); let d = 0; for (let i = 0; i < p.length; i++) d += Math.abs(p[i] - q[i]); return d; }
function moments(a: Float64Array) {
  const p = norm(a); let cx = 0, cz = 0;
  for (let j = 0; j < 11; j++) for (let i = 0; i < 35; i++) { const w = p[i + 35 * j]; cx += w * (-4.25 + (i + 0.5) * (8.5 / 35)); cz += w * (-1.38 + (j + 0.5) * (2.76 / 11)); }
  let sx = 0, sz = 0;
  for (let j = 0; j < 11; j++) for (let i = 0; i < 35; i++) { const w = p[i + 35 * j]; sx += w * (-4.25 + (i + 0.5) * (8.5 / 35) - cx) ** 2; sz += w * (-1.38 + (j + 0.5) * (2.76 / 11) - cz) ** 2; }
  return { cx, sx: Math.sqrt(sx), sz: Math.sqrt(sz) };
}
function score(cases: Case[], params: Partial<TransportParams>) {
  let s = 0, n = 0;
  for (const c of cases) { const sim = simulate(c, params); for (const t of FRAMES) { s += l1(sim.get(t)!, c.fds.get(t)!); n++; } }
  return s / n;
}

const all = CASES.map(load);
const still = all.filter(c => c.cmS <= 1), forced = all.filter(c => c.cmS > 1);

console.log(`uncalibrated: still L1=${score(still, UNCALIBRATED).toFixed(3)} forced L1=${score(forced, UNCALIBRATED).toFixed(3)}`);
let best = { ...UNCALIBRATED }, bestS = Infinity;
for (const dStill of [1e-5, 1e-4, 3e-4, 1e-3, 2e-3, 4e-3]) for (const expansionPerKw of [0, 0.0028, 0.01, 0.03, 0.18]) for (const sourceRadius of [0.1, 0.15, 0.2]) {
  const p = { ...best, dStill, expansionPerKw, sourceRadius };
  const s = score(still, p);
  if (s < bestS) { bestS = s; best = p; }
}
console.log(`stage 1 (0-1 cm/s): dStill=${best.dStill} expansionPerKw=${best.expansionPerKw} sourceRadius=${best.sourceRadius} L1=${bestS.toFixed(3)}`);
bestS = Infinity;
for (const dForcedPerMS of [0, 0.003, 0.01, 0.03, 0.1, 0.2]) {
  const p = { ...best, dForcedPerMS };
  const s = score(forced, p);
  if (s < bestS) { bestS = s; best = p; }
}
console.log(`stage 2 (4-20 cm/s): dForcedPerMS=${best.dForcedPerMS} L1=${bestS.toFixed(3)}`);
console.log(`calibrated: still L1=${score(still, best).toFixed(3)} forced L1=${score(forced, best).toFixed(3)}`);
console.log("\ncase   t   FDS cx/sx/sz        live(uncal) cx/sx/sz   live(cal) cx/sx/sz");
for (const c of all) {
  const u = simulate(c, UNCALIBRATED), k = simulate(c, best);
  for (const t of [30, 60]) {
    const a = moments(c.fds.get(t)!), b = moments(u.get(t)!), d = moments(k.get(t)!);
    const fmt = (m: { cx: number; sx: number; sz: number }) => `${m.cx.toFixed(2)}/${m.sx.toFixed(2)}/${m.sz.toFixed(2)}`;
    console.log(`f${String(c.cmS).padEnd(3)} ${String(t).padStart(2)}   ${fmt(a).padEnd(18)}  ${fmt(b).padEnd(20)}   ${fmt(d)}`);
  }
}
console.log(`\nJSON ${JSON.stringify(best)}`);
