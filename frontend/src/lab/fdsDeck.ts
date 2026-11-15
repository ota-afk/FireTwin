/* EXPERIMENT: a NIST FDS (Fire Dynamics Simulator, FDS 6) input deck for the current controls, so
   the same scenario can be run offline in FDS and viewed in Smokeview (or replayed in the 3D scene
   through scene/fdsSlice.ts).

   Coordinates: FDS treats Z as "up" for Smokeview, so the deck maps the contract frame
   (x fore, y overhead, z port) to FDS (X = x, Y = z, Z = y). The domain is the cabin aisle between
   the rack faces: 8.5 m x 2.76 m x 2.76 m; the racks themselves are the inert mesh walls.
   Gravity is off: &MISC GVEC=0.,0.,0.
   Forced airflow: a SUPPLY vent covering the upstream wall and an EXHAUST vent on the opposite wall,
   both at the slider speed (FDS: negative VEL blows into the domain). Fans off: a closed box.
   The fire: a 10 cm burner cube at the origin with simple-chemistry combustion of the material. */
import type { ScenarioIn, Vec3 } from "../api/types";
import { MODULE, VENTS } from "./config.js";

const M_O2 = 31.998, M_N2 = 28.014;

/** O2 volume % (what the slider sets) to the mass fraction FDS's Y_O2_INFTY expects (balance N2). */
export function o2MassFraction(o2Pct: number): number {
  const x = Math.min(100, Math.max(0, o2Pct)) / 100;
  return (x * M_O2) / (x * M_O2 + (1 - x) * M_N2);
}

/** Contract point (x, y overhead, z port) -> FDS point (X, Y, Z up). */
export const toFds = ([x, y, z]: Vec3): Vec3 => [x, z, y];

interface Fuel { name: string; c: number; h: number; o: number; soot: number; hoc: number } // hoc kJ/kg
// Simple-chemistry stand-ins (FDS: one lumped fuel). Unknown materials fall back to PMMA.
const FUELS: Record<string, Fuel> = {
  pmma: { name: "PMMA", c: 5, h: 8, o: 2, soot: 0.022, hoc: 24900 },
  heptane: { name: "N-HEPTANE", c: 7, h: 16, o: 0, soot: 0.037, hoc: 44600 },
  ethanol: { name: "ETHANOL", c: 2, h: 6, o: 1, soot: 0.008, hoc: 26800 },
  methanol: { name: "METHANOL", c: 1, h: 4, o: 1, soot: 0.001, hoc: 19900 },
  cotton: { name: "CELLULOSE", c: 6, h: 10, o: 5, soot: 0.015, hoc: 16100 },
};
export function fuelFor(material: string): Fuel {
  const m = material.toLowerCase();
  const key = Object.keys(FUELS).find(k => m.includes(k));
  return key ? FUELS[key] : FUELS.pmma;
}

export interface DeckOptions {
  tEnd?: number; // s
  cell?: number; // m (grid spacing)
  hrrKw?: number; // fire size
  chid?: string;
}

const f = (v: number, d = 3) => {
  const s = v.toFixed(d).replace(/0+$/, "");
  return s.endsWith(".") ? `${s}0` : s;
};
const xb = (a: number[]) => a.map(v => f(v)).join(",");

export function fdsDeck(inputs: ScenarioIn, opts: DeckOptions = {}): string {
  const { tEnd = 120, cell = 0.125, hrrKw = 1, chid = "firetwin_iss" } = opts;
  const L = MODULE.length / 2, A = MODULE.aisle;
  const ijk = [Math.round((2 * L) / cell), Math.round((2 * A) / cell), Math.round((2 * A) / cell)];
  const fuel = fuelFor(inputs.material);
  const len = Math.hypot(...inputs.flow_dir);
  const speed = len > 0 ? Math.max(0, inputs.flow_speed_cm_s) / 100 : 0; // m/s
  const dirFds = toFds(len > 0 ? (inputs.flow_dir.map(v => v / len) as Vec3) : [1, 0, 0]);
  const burner = 0.05, hrrpua = (hrrKw / (6 * (2 * burner) ** 2)); // kW/m^2 over the cube's 6 faces
  const bounds: [number, number][] = [[-L, L], [-A, A], [-A, A]]; // FDS X, Y, Z

  const lines = [
    `&HEAD CHID='${chid}', TITLE='FireTwin ISS lab module, microgravity: ${inputs.material}, ${f(inputs.o2_pct, 2)}% O2, ${f(inputs.flow_speed_cm_s, 2)} cm/s' /`,
    `&TIME T_END=${f(tEnd, 1)} /`,
    `&MESH IJK=${ijk.join(",")}, XB=${xb([-L, L, -A, A, -A, A])} /`,
    `&MISC GVEC=0.0,0.0,0.0, Y_O2_INFTY=${f(o2MassFraction(inputs.o2_pct), 4)}, P_INF=${f(inputs.pressure_kpa * 1000, 1)} /`,
    `&REAC FUEL='${fuel.name}', C=${fuel.c}, H=${fuel.h}, O=${fuel.o}, SOOT_YIELD=${fuel.soot}, HEAT_OF_COMBUSTION=${fuel.hoc}. /`,
    `&SURF ID='FIRE', HRRPUA=${f(hrrpua, 1)}, COLOR='ORANGE' /`,
    `&OBST XB=${xb([-burner, burner, -burner, burner, -burner, burner])}, SURF_ID='FIRE' / 10 cm burner at the module centre`,
  ];
  if (speed > 0) {
    const axis = dirFds.findIndex(v => Math.abs(v) > 0.5);
    const sign = Math.sign(dirFds[axis]);
    lines.push(`&SURF ID='SUPPLY', VEL=${f(-speed, 4)}, COLOR='BLUE' /`, `&SURF ID='EXHAUST', VEL=${f(speed, 4)}, COLOR='GRAY' /`);
    const wall = (end: number) => {
      const b = bounds.map(r => [...r]);
      b[axis] = [end, end];
      return xb(b.flat());
    };
    lines.push(
      `&VENT XB=${wall(sign > 0 ? bounds[axis][0] : bounds[axis][1])}, SURF_ID='SUPPLY' / cabin fans (upstream wall)`,
      `&VENT XB=${wall(sign > 0 ? bounds[axis][1] : bounds[axis][0])}, SURF_ID='EXHAUST' / return (downstream wall)`,
    );
  }
  for (const v of VENTS as { id: string; pos: number[] }[]) {
    const p = toFds([v.pos[0], v.pos[1], v.pos[2]]);
    const inside = p.map((c, i) => Math.min(bounds[i][1] - 0.005, Math.max(bounds[i][0] + 0.005, c))); // inside the mesh
    lines.push(`&DEVC ID='${v.id}', XYZ=${xb(inside)}, QUANTITY='SOOT DENSITY' /`);
  }
  lines.push(
    "&SLCF PBY=0.0, QUANTITY='SOOT DENSITY' / mid-plane through the fire (replayable in FireTwin)",
    "&SLCF PBY=0.0, QUANTITY='TEMPERATURE' /",
    "&SLCF PBY=0.0, QUANTITY='VELOCITY', VECTOR=.TRUE. /",
    "&TAIL /",
  );
  return lines.join("\n") + "\n";
}
