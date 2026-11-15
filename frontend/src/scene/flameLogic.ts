/* FE-05: how a SimulateOut maps onto the flame. Pure, so it's unit-tested; Flame.tsx applies it
   to three.js objects inside useFrame. The model decides; the flame only illustrates. */
import type { ScenarioIn, SimulateOut, Vec3 } from "../api/types";
import { flameStretch } from "./microgravity";

export const MAX_FLOW_CM_S = 40; // ScenarioIn: flow_speed_cm_s is 0-40
export const IGNITE_S = 0.4; // the flame grows to full size (appears well under 1 s)
export const FADE_OUT_S = 2; // FE-05: shrinks and fades over ~2 s when extinguished

// The flame's life, 0 (none) to 1 (burning), stepped linearly each frame towards the target.
export function stepLife(life: number, alive: 0 | 1, dt: number): number {
  return Math.min(1, Math.max(0, life + (alive ? dt / IGNITE_S : -dt / FADE_OUT_S)));
}

export interface FlameTarget {
  alive: 0 | 1; // 0 = shrink and fade out (extinguished, or nothing ignited yet)
  burnP: number; // 0-1: with oxygen, sets the flame's size
  o2: number;
  stretch: number; // 0 = microgravity sphere ... 0.85 = stretched along the flow
  flowDir: Vec3; // unit vector the flame stretches along
  spreadScale: number; // 1 = no predicted spread; up to 1.35 for fast spread
  extrapolated: boolean; // grey stripes + "outside tested range" tag
}

export const NO_FLAME: FlameTarget = {
  alive: 0, burnP: 0, o2: 21, stretch: 0, flowDir: [1, 0, 0], spreadScale: 1, extrapolated: false,
};

// flow_dir as a unit vector ([1, 0, 0] when it has no length), and the speed in cm/s.
export function flowOf(inputs: ScenarioIn): { dir: Vec3; speedCmS: number } {
  const [x, y, z] = inputs.flow_dir;
  const len = Math.hypot(x, y, z);
  return {
    dir: len > 0 ? [x / len, y / len, z / len] : [1, 0, 0],
    speedCmS: len > 0 ? Math.max(0, inputs.flow_speed_cm_s) : 0,
  };
}

export function flameTarget(sim: SimulateOut | null): FlameTarget {
  if (!sim) return NO_FLAME;
  const flow = flowOf(sim.inputs);
  const spread = Math.max(0, sim.spread_rate_mm_s ?? 0);
  return {
    alive: sim.state === "burning" ? 1 : 0,
    burnP: Math.min(1, Math.max(0, sim.burn_probability)),
    o2: sim.inputs.o2_pct,
    // EXPERIMENT (g = 0): a true sphere up to 2 cm/s (FLEX-2), then drawn out along the forced flow,
    // more with faster airflow and richer oxygen (scene/microgravity.ts).
    stretch: flameStretch(flow.speedCmS, sim.inputs.o2_pct),
    flowDir: flow.dir,
    spreadScale: 1 + Math.min(1, spread / 2) * 0.35,
    extrapolated: sim.extrapolated,
  };
}
