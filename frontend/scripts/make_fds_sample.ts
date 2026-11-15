/* EXPERIMENT: writes public/fds/sample_slice.json, a slice in the fdsSlice.ts format, so the FDS replay
   can be tried without FDS installed. The data come from FireTwin's own g = 0 SootField (PMMA-like
   source, 10 cm/s fore airflow), sampled on the FDS PBY=0 plane. It is NOT FDS output; real runs
   come from the deck in src/lab/fdsDeck.ts. Run: npx vite-node scripts/make_fds_sample.ts */
import { mkdirSync, writeFileSync } from "node:fs";
import { SootField } from "../src/scene/microgravity";

const field = new SootField();
const settings = { emitting: true, source: 1, dir: [1, 0, 0] as [number, number, number], speedMS: 0.1, vents: [[4, 1.37, 0], [-4, 1.37, 0], [0, 1.37, 0]] as [number, number, number][] };
const k = Math.floor(field.nz / 2); // scene z = 0, i.e. FDS Y = 0 (PBY=0)
const points: number[][] = [];
for (let j = 0; j < field.ny; j++) for (let i = 0; i < field.nx; i++) {
  const [x, y, z] = field.centre(i, j, k);
  points.push([+x.toFixed(3), +z.toFixed(3), +y.toFixed(3)]); // FDS order: X, Y, Z (up)
}
const times: number[] = [], values: number[][] = [];
for (let t = 0; t <= 60; t += 3) {
  times.push(t);
  values.push(points.map((_, n) => +field.c[field.idx(n % field.nx, Math.floor(n / field.nx), k)].toFixed(4)));
  field.step(3, settings);
}
mkdirSync("public/fds", { recursive: true });
writeFileSync("public/fds/sample_slice.json", JSON.stringify({
  format: "firetwin-fds-slice/1", quantity: "SOOT DENSITY", units: "arbitrary", coords: "fds",
  source: "SYNTHETIC SAMPLE from FireTwin's g = 0 SootField (10 cm/s fore), NOT FDS output",
  times, points, values,
}));
console.log(`wrote public/fds/sample_slice.json: ${points.length} points x ${times.length} times`);
