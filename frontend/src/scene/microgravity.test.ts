// EXPERIMENT: g = 0 flame regimes and the soot scalar field.
import { describe, expect, it } from "vitest";
import type { Vec3 } from "../api/types";
import { GVEC, SootField, UNCALIBRATED, flameRegime, flameStretch, type FieldSettings } from "./microgravity";

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
  it("stretches fast once forced, saturating by 20 cm/s (FDS trend), more with oxygen, at most 1", () => {
    expect(flameStretch(10, 21)).toBeGreaterThan(flameStretch(3, 21));
    expect(flameStretch(20, 21)).toBeGreaterThan(flameStretch(10, 21));
    expect(flameStretch(40, 21)).toBe(flameStretch(20, 21)); // saturated
    expect(flameStretch(10, 30)).toBeGreaterThan(flameStretch(10, 15));
    expect(flameStretch(40, 40)).toBe(1);
    // FDS hot-zone aspect, relative to 1 cm/s: 4 cm/s gave ~0.54 of the 20 cm/s value, 10 cm/s ~0.73.
    const rel = (u: number) => (flameStretch(u, 30) - 0.15) / (flameStretch(20, 30) - 0.15);
    expect(rel(4)).toBeCloseTo(0.54, 1);
    expect(rel(10)).toBeGreaterThan(0.7);
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

  it("is calibrated to FDS: compact in still air and carried at the FDS rate (fds_runs, 0.5 kW)", () => {
    const vents: Vec3[] = [];
    const run2 = (params: object, cmS: number, t: number) => {
      const f = new SootField(35, 11, 11, params);
      for (let s = 0; s < t; s += 0.5) {
        const q = 0.25 + 0.0035 * s; // FDS's heat release ramped from ~0.25 to ~0.46 kW over the minute
        f.step(0.5, settings({ dir: [1, 0, 0], speedMS: cmS / 100, vents, openEnds: true, hrrKw: q, source: q }));
      }
      // Moments on the plane through the fire (z = 0, FDS's PBY=0 slice), as the calibration measured.
      const k = Math.floor(f.nz / 2);
      let m = 0, cx = 0, cy = 0;
      for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) {
        const v = f.c[f.idx(i, j, k)], p = f.centre(i, j, k); m += v; cx += v * p[0]; cy += v * p[1];
      }
      cx /= m; cy /= m;
      let s2 = 0;
      for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) s2 += f.c[f.idx(i, j, k)] * (f.centre(i, j, k)[1] - cy) ** 2;
      return { cx, sy: Math.sqrt(s2 / m) };
    };
    // FDS: cross-flow spread ~0.20 m after 60 s in still air; soot centroid 1.13 m downstream at 30 s, 10 cm/s.
    expect(run2({}, 0, 60).sy).toBeLessThan(0.35);
    expect(run2(UNCALIBRATED, 0, 60).sy).toBeGreaterThan(0.45);
    expect(run2({}, 10, 30).cx).toBeGreaterThan(1.13 - 0.25);
    expect(run2({}, 10, 30).cx).toBeLessThan(1.13 + 0.25);
  });

  it("stays finite and non-negative at the strongest airflow", () => {
    const f = new SootField();
    run(f, settings({ dir: [1, 0, 0], speedMS: 0.4 }), 120);
    for (const v of f.c) expect(Number.isFinite(v) && v >= 0).toBe(true);
  });
});
