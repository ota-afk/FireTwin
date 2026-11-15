/* EXPERIMENT: write an FDS input deck from the command line (same generator as the "FDS deck" button).
   npx vite-node scripts/make_fds_deck.ts -- --material Heptane --o2 30 --flow 1 --dir +x \
     --cell 0.25 --tend 60 --hrr 0.5 [--dt 0.2] --out ../fds_runs/heptane_o2_30_f1/firetwin_iss.fds */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Vec3 } from "../src/api/types";
import { fdsDeck } from "../src/lab/fdsDeck";

const args = process.argv.slice(2).filter(a => a !== "--");
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DIRS: Record<string, Vec3> = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };
const out = opt("out", "firetwin_iss.fds");
const deck = fdsDeck(
  { module: "iss_lab", material: opt("material", "PMMA"), o2_pct: +opt("o2", "21"), pressure_kpa: +opt("pressure", "101.3"), flow_speed_cm_s: +opt("flow", "10"), flow_dir: DIRS[opt("dir", "+x")] },
  { cell: +opt("cell", "0.125"), tEnd: +opt("tend", "120"), hrrKw: +opt("hrr", "0.5"), frames: +opt("frames", "40"), chid: opt("chid", "firetwin_iss"), dt: opt("dt", "") ? +opt("dt", "") : undefined },
);
mkdirSync(dirname(out) || ".", { recursive: true });
writeFileSync(out, deck);
console.log(`wrote ${out}`);
