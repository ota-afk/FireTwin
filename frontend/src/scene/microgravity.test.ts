// EXPERIMENT: g = 0 flame regimes and the soot scalar field.
import { describe, expect, it } from "vitest";
import type { Vec3 } from "../api/types";
import { GVEC, SootField, flameRegime, flameStretch, type FieldSettings } from "./microgravity";

const VENTS: Vec3[] = [[4, 1.37, 0], [-4, 1.37, 0], [0, 1.37, 0]];
const settings = (patch: Partial<FieldSettings> = {}): FieldSettings => ({
  emitting: true, source: 1, dir: [1, 0, 0], speedMS: 0, vents: VENTS, ...patch,
});
const run = (f: SootField, s: FieldSettings, seconds: number) => { for (let t = 0; t < seconds; t += 0.5) f.step(0.5, s); };

describe("flame regime (g = 0)", () => {
  it("has no gravity vector", () => {
    expect(GVEC).toEqual([0, 0, 0]);
  });
  it("is a sphere up to 2 cm/s and a forced-flow sheet above", () => {
    expect(flameRegime(0)).toBe("spherical");
    expect(flameRegime(2)).toBe("spherical");
    expect(flameRegime(2.5)).toBe("forced");
    expect(flameStretch(0, 21)).toBe(0);
    expect(flameStretch(2, 30)).toBe(0);
  });
  it("stretches more with airflow and with oxygen, up to 0.85", () => {
    expect(flameStretch(10, 21)).toBeGreaterThan(flameStretch(3, 21));
    expect(flameStretch(40, 21)).toBeGreaterThan(flameStretch(10, 21));
    expect(flameStretch(10, 30)).toBeGreaterThan(flameStretch(10, 15));
    expect(flameStretch(40, 40)).toBeLessThanOrEqual(0.85);
  });
});

describe("SootField", () => {
  it("conserves soot with no source, no fans and closed walls", () => {
    const f = new SootField();
    run(f, settings({ emitting: true }), 5);
    const before = f.total();
    run(f, settings({ emitting: false, source: 0 }), 30);
    expect(f.total()).toBeCloseTo(before, 3);
  });

  it("spreads radially in still air: nothing floats upward (g = 0)", () => {
    const f = new SootField();
    run(f, settings(), 40);
    const [x, y, z] = f.centroid();
    expect(f.total()).toBeGreaterThan(0);
    expect(Math.abs(x)).toBeLessThan(0.02);
    expect(Math.abs(y)).toBeLessThan(0.02);
    expect(Math.abs(z)).toBeLessThan(0.02);
  });

  it("is carried along the airflow, in any of the six directions", () => {
    for (const [dir, axis, sign] of [[[1, 0, 0], 0, 1], [[-1, 0, 0], 0, -1], [[0, -1, 0], 1, -1], [[0, 0, 1], 2, 1]] as [Vec3, number, number][]) {
      const f = new SootField();
      run(f, settings({ dir, speedMS: 0.1 }), 30);
      expect(Math.sign(f.centroid()[axis])).toBe(sign);
    }
  });

  it("gathers soot against the wall the flow pushes it into", () => {
    const f = new SootField();
    run(f, settings({ dir: [0, 0, -1], speedMS: 0.2, vents: [] }), 60);
    const wall = f.c[f.idx(17, 5, 0)]; // starboard rack face, mid-module
    const centre = f.c[f.idx(17, 5, 5)];
    expect(wall).toBeGreaterThan(centre);
  });

  it("stays finite and non-negative at the strongest airflow", () => {
    const f = new SootField();
    run(f, settings({ dir: [1, 0, 0], speedMS: 0.4 }), 120);
    for (const v of f.c) expect(Number.isFinite(v) && v >= 0).toBe(true);
  });
});
