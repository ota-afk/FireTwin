/* EXPERIMENT (exp/fds-microgravity-physics): microgravity fire and soot transport for the 3D scene,
   modelled on the way NIST FDS treats smoke: a passive scalar (soot mass fraction) on a structured
   grid, carried by the flow and spread by diffusion, with the gravity vector set to zero
   (FDS `&MISC GVEC=0,0,0 /`). It is a visual model, not FDS itself: FDS solves the full low-Mach
   Navier-Stokes equations, while this prescribes the velocity field (cabin fans + vent returns +
   the fire's thermal expansion) and solves only the scalar transport

       dc/dt = -div(u c) + D lap(c) + S - k_vent c        (no buoyancy term: g = 0)

   with first-order upwind fluxes, zero-flux walls, and CFL/diffusion-limited substeps.
   Frame: docs/contract.md (metres, +x fore, +y overhead, +z port; the fire at the origin). The grid
   covers the aisle between the rack faces (8.5 m x 2.76 m x 2.76 m). The model's verdict still comes
   from the API: none of this decides whether the fire burns or which vent trips. */
import type { Vec3 } from "../api/types";

/** FDS GVEC: no gravity, so nothing (heat, flame front or soot) rises by itself. */
export const GVEC: Vec3 = [0, 0, 0];
/** At or below this airflow the flame is a microgravity sphere (FLEX-2), above it a forced-flow sheet. */
export const SPHERICAL_MAX_CM_S = 2;
export const MAX_FLOW_CM_S = 40;

export type FlameRegime = "spherical" | "forced";
export const flameRegime = (speedCmS: number): FlameRegime => (speedCmS <= SPHERICAL_MAX_CM_S ? "spherical" : "forced");

/** 0 at 13 % O2 (near the PSI extinction limit) to 1 at 30 %: how strongly oxygen feeds the flame. */
export function oxygenFactor(o2Pct: number): number {
  return Math.min(1, Math.max(0, (o2Pct - 13) / 17));
}

/** How far the flame sheet is drawn out along the airflow: 0 = sphere (still air, up to 2 cm/s),
    rising with the forced-flow speed and with oxygen, to at most 0.85. */
export function flameStretch(speedCmS: number, o2Pct: number): number {
  if (flameRegime(speedCmS) === "spherical") return 0;
  const u = Math.min(1, (speedCmS - SPHERICAL_MAX_CM_S) / (MAX_FLOW_CM_S - SPHERICAL_MAX_CM_S));
  return Math.min(0.85, (0.15 + 0.7 * Math.pow(u, 0.7)) * (0.6 + 0.4 * oxygenFactor(o2Pct)));
}

// ---------------- the soot scalar field ----------------

export const FIELD_BOUNDS = { x: 4.25, yz: 1.38 }; // aisle: bulkhead to bulkhead, rack face to rack face

export interface FieldSettings {
  emitting: boolean; // the model says the fire burns
  source: number; // soot released per simulated second (arbitrary units), e.g. from burn probability
  dir: Vec3; // unit airflow direction
  speedMS: number; // forced airflow, m/s (0 = fans off)
  vents: Vec3[]; // return-vent positions (contract frame)
}

const D_STILL = 0.004; // m^2/s: molecular + thermal mixing in still air
const D_FORCED = 0.02; // m^2/s per m/s of forced flow: eddy diffusivity grows with the fans
const EXPANSION_Q = 0.09; // m^3/s: volume source of the fire's thermal expansion (u_r = Q / 4 pi r^2)
const EXPANSION_MAX = 0.2; // m/s cap close to the fire
const VENT_PULL_RANGE = 1.2; // m: how far a return vent bends the flow toward itself
const VENT_SINK_RADIUS = 0.35; // m
const VENT_SINK_RATE = 0.6; // 1/s: exhaust through a return vent (fans on only)
const SOURCE_RADIUS = 0.2; // m

export class SootField {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly c: Float32Array; // soot per cell
  private next: Float32Array;
  private ux: Float32Array;
  private uy: Float32Array;
  private uz: Float32Array;
  private sink: Float32Array; // exhaust rate per cell (1/s)
  private src: Float32Array; // share of the source per cell (sums to 1)
  private uMax = 0;
  private diff = D_STILL;
  private key = "";

  constructor(nx = 34, ny = 11, nz = 11) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.dx = (2 * FIELD_BOUNDS.x) / nx;
    this.dy = (2 * FIELD_BOUNDS.yz) / ny;
    this.dz = (2 * FIELD_BOUNDS.yz) / nz;
    const n = nx * ny * nz;
    this.c = new Float32Array(n);
    this.next = new Float32Array(n);
    this.ux = new Float32Array(n); this.uy = new Float32Array(n); this.uz = new Float32Array(n);
    this.sink = new Float32Array(n);
    this.src = new Float32Array(n);
    let total = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [x, y, z] = this.centre(i, j, k);
      const w = Math.exp(-(x * x + y * y + z * z) / (SOURCE_RADIUS * SOURCE_RADIUS));
      this.src[this.idx(i, j, k)] = w; total += w;
    }
    for (let m = 0; m < n; m++) this.src[m] /= total;
  }

  idx(i: number, j: number, k: number): number { return i + this.nx * (j + this.ny * k); }
  centre(i: number, j: number, k: number): Vec3 {
    return [-FIELD_BOUNDS.x + (i + 0.5) * this.dx, -FIELD_BOUNDS.yz + (j + 0.5) * this.dy, -FIELD_BOUNDS.yz + (k + 0.5) * this.dz];
  }
  reset(): void { this.c.fill(0); }
  total(): number { let s = 0; for (const v of this.c) s += v; return s; }
  /** Mass-weighted centre of the soot cloud (for tests and the HUD). */
  centroid(): Vec3 {
    let s = 0, x = 0, y = 0, z = 0;
    for (let k = 0; k < this.nz; k++) for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const v = this.c[this.idx(i, j, k)]; if (!v) continue;
      const p = this.centre(i, j, k); s += v; x += v * p[0]; y += v * p[1]; z += v * p[2];
    }
    return s > 0 ? [x / s, y / s, z / s] : [0, 0, 0];
  }

  /** The velocity field for these settings (recomputed only when they change). g = 0: no buoyancy. */
  private prepare(p: FieldSettings): void {
    const key = `${p.emitting}|${p.dir.join(",")}|${p.speedMS}|${p.vents.flat().join(",")}`;
    if (key === this.key) return;
    this.key = key;
    const fans = p.speedMS > 0;
    let target: Vec3 | null = null, best = -Infinity;
    if (fans) for (const v of p.vents) { const s = v[0] * p.dir[0] + v[1] * p.dir[1] + v[2] * p.dir[2]; if (s > best) { best = s; target = v; } }
    this.diff = fans ? D_STILL + D_FORCED * p.speedMS * 10 : D_STILL;
    this.uMax = 0;
    for (let k = 0; k < this.nz; k++) for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const m = this.idx(i, j, k);
      const [x, y, z] = this.centre(i, j, k);
      // Forced cabin flow along the chosen axis, plus GVEC (zero) buoyancy: nothing rises on its own.
      let ux = p.dir[0] * p.speedMS + GVEC[0], uy = p.dir[1] * p.speedMS + GVEC[1], uz = p.dir[2] * p.speedMS + GVEC[2];
      // The return vent furthest downstream bends the flow toward itself (converging: soot gathers there).
      if (target) {
        const tx = target[0] - x, ty = target[1] - y, tz = target[2] - z, d = Math.max(Math.hypot(tx, ty, tz), 1e-3);
        const pull = 0.6 * p.speedMS * Math.exp(-d / VENT_PULL_RANGE) / d;
        ux += tx * pull; uy += ty * pull; uz += tz * pull;
      }
      // Thermal expansion of the burning gas (low-Mach divergence): a radial outflow ~ 1/r^2.
      if (p.emitting) {
        const r = Math.max(Math.hypot(x, y, z), 0.05);
        const ur = Math.min(EXPANSION_MAX, EXPANSION_Q / (4 * Math.PI * r * r)) / r;
        ux += x * ur; uy += y * ur; uz += z * ur;
      }
      this.ux[m] = ux; this.uy[m] = uy; this.uz[m] = uz;
      this.uMax = Math.max(this.uMax, Math.abs(ux) / this.dx + Math.abs(uy) / this.dy + Math.abs(uz) / this.dz);
      let s = 0;
      if (fans) for (const v of p.vents) if (Math.hypot(v[0] - x, v[1] - y, v[2] - z) < VENT_SINK_RADIUS) s = VENT_SINK_RATE;
      this.sink[m] = s;
    }
  }

  /** Advances dt simulated seconds in stable substeps. */
  step(dt: number, p: FieldSettings): void {
    this.prepare(p);
    const h2 = Math.min(this.dx, this.dy, this.dz) ** 2;
    const dtMax = 0.4 * Math.min(this.uMax > 0 ? 1 / this.uMax : Infinity, h2 / (6 * this.diff));
    let left = Math.max(0, dt);
    while (left > 1e-9) {
      const h = Math.min(left, dtMax);
      this.substep(h, p);
      left -= h;
    }
  }

  private substep(h: number, p: FieldSettings): void {
    const { nx, ny, nz, c, next, ux, uy, uz } = this;
    const sx = nx, sy = nx * ny;
    const D = this.diff;
    const src = p.emitting ? p.source : 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const m = i + nx * (j + ny * k);
      const cm = c[m];
      let flux = 0;
      // Upwind advective flux and diffusive flux through each face; walls (domain edges) pass nothing.
      if (i < nx - 1) { const n = m + 1, uf = 0.5 * (ux[m] + ux[n]); flux -= (uf > 0 ? uf * cm : uf * c[n]) / this.dx; flux += D * (c[n] - cm) / (this.dx * this.dx); }
      if (i > 0) { const n = m - 1, uf = 0.5 * (ux[m] + ux[n]); flux += (uf > 0 ? uf * c[n] : uf * cm) / this.dx; flux += D * (c[n] - cm) / (this.dx * this.dx); }
      if (j < ny - 1) { const n = m + sx, uf = 0.5 * (uy[m] + uy[n]); flux -= (uf > 0 ? uf * cm : uf * c[n]) / this.dy; flux += D * (c[n] - cm) / (this.dy * this.dy); }
      if (j > 0) { const n = m - sx, uf = 0.5 * (uy[m] + uy[n]); flux += (uf > 0 ? uf * c[n] : uf * cm) / this.dy; flux += D * (c[n] - cm) / (this.dy * this.dy); }
      if (k < nz - 1) { const n = m + sy, uf = 0.5 * (uz[m] + uz[n]); flux -= (uf > 0 ? uf * cm : uf * c[n]) / this.dz; flux += D * (c[n] - cm) / (this.dz * this.dz); }
      if (k > 0) { const n = m - sy, uf = 0.5 * (uz[m] + uz[n]); flux += (uf > 0 ? uf * c[n] : uf * cm) / this.dz; flux += D * (c[n] - cm) / (this.dz * this.dz); }
      const v = cm + h * (flux + src * this.src[m] - this.sink[m] * cm);
      next[m] = v > 0 ? v : 0;
    }
    c.set(next);
  }
}
