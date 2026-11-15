/* EXPERIMENT: drives the g = 0 SootField for the 3D views, like SmokeDriver does for the particles:
   one field per ignition shared by the main view and Compare, the 10x demo clock in bounded steps,
   cleared on Reset. Also maps the field to per-cell opacity (Beer-Lambert, as Smokeview shades 3D
   soot: alpha = 1 - exp(-kappa * c)). */
import type { SimulateOut, Vec3 } from "../api/types";
import { VENTS } from "../lab/config.js";
import { SCENE_TIME_SCALE } from "./clock";
import { flowOf } from "./flameLogic";
import { type FieldSettings, SootField } from "./microgravity";
import { MAX_FRAME_GAP_S } from "./smokeLogic";

const VENT_POS: Vec3[] = (VENTS as { pos: number[] }[]).map(v => [v.pos[0], v.pos[1], v.pos[2]]);
export const SOOT_KAPPA = 4; // opacity per unit soot per cell (tuned so a 10 cm/s plume reads clearly)
export const SOOT_MAX_ALPHA = 0.55;

export function fieldSettings(sim: SimulateOut | null): FieldSettings {
  if (!sim) return { emitting: false, source: 0, dir: [1, 0, 0], speedMS: 0, vents: VENT_POS };
  const flow = flowOf(sim.inputs);
  const emitting = sim.state === "burning";
  const p = Math.min(1, Math.max(0, sim.burn_probability));
  return { emitting, source: emitting ? 0.4 + 0.6 * p : 0, dir: flow.dir, speedMS: flow.speedCmS / 100, vents: VENT_POS };
}

export class SootDriver {
  readonly field = new SootField();
  readonly alpha: Float32Array;
  private lastAdvanceAt: number | null = null;

  constructor() {
    this.alpha = new Float32Array(this.field.c.length);
  }

  clear(): void {
    this.field.reset();
    this.alpha.fill(0);
    this.lastAdvanceAt = null;
  }

  resume(s: FieldSettings, now = Date.now()): void {
    if (this.lastAdvanceAt !== null) this.advance((now - this.lastAdvanceAt) / 1000, s, now);
  }

  advance(realSeconds: number, s: FieldSettings, now = Date.now()): void {
    this.lastAdvanceAt = now;
    this.field.step(Math.min(Math.max(0, realSeconds), MAX_FRAME_GAP_S) * SCENE_TIME_SCALE, s);
    const c = this.field.c;
    for (let m = 0; m < c.length; m++) this.alpha[m] = SOOT_MAX_ALPHA * (1 - Math.exp(-SOOT_KAPPA * c[m]));
  }
}

let shared: { ignition: number; driver: SootDriver } | null = null;

/** One field per ignition, shared by every 3D view. */
export function sootDriverFor(ignition: number): SootDriver {
  if (shared?.ignition !== ignition) shared = { ignition, driver: new SootDriver() };
  return shared.driver;
}
