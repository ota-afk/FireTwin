// EXPERIMENT: the FDS input deck for the current controls.
import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO, type ScenarioIn } from "../api/types";
import { fdsDeck, fuelFor, o2MassFraction, toFds } from "./fdsDeck";

const inputs = (patch: Partial<ScenarioIn> = {}): ScenarioIn => ({
  ...DEFAULT_SCENARIO, material: "PMMA", o2_pct: 21, flow_speed_cm_s: 10, flow_dir: [1, 0, 0], pressure_kpa: 101.3, ...patch,
});

describe("fdsDeck", () => {
  it("turns gravity off and sizes the mesh to the 8.5 m cabin aisle", () => {
    const deck = fdsDeck(inputs());
    expect(deck).toContain("&MISC GVEC=0.0,0.0,0.0,");
    expect(deck).toContain("&MESH IJK=68,22,22, XB=-4.25,4.25,-1.38,1.38,-1.38,1.38 /");
    expect(deck.trim().endsWith("&TAIL /")).toBe(true);
    for (const line of deck.trim().split("\n")) expect(line).toMatch(/^&[A-Z]+ .*\/( .*)?$/);
  });

  it("converts O2 volume % to the mass fraction FDS expects, and kPa to Pa", () => {
    expect(o2MassFraction(21)).toBeCloseTo(0.233, 3);
    const deck = fdsDeck(inputs({ o2_pct: 30, pressure_kpa: 70.3 }));
    expect(deck).toContain(`Y_O2_INFTY=${o2MassFraction(30).toFixed(4)}`);
    expect(deck).toContain("P_INF=70300.0");
  });

  it("blows the supply in from the upstream wall at the slider speed", () => {
    const fore = fdsDeck(inputs({ flow_dir: [1, 0, 0], flow_speed_cm_s: 12.5 }));
    expect(fore).toContain("&SURF ID='SUPPLY', VEL=-0.125");
    expect(fore).toContain("&VENT XB=-4.25,-4.25,-1.38,1.38,-1.38,1.38, SURF_ID='SUPPLY'");
    expect(fore).toContain("&VENT XB=4.25,4.25,-1.38,1.38,-1.38,1.38, SURF_ID='EXHAUST'");
    // overhead (+y) is FDS +Z: supply on the deck (Z min), exhaust overhead (Z max)
    const up = fdsDeck(inputs({ flow_dir: [0, 1, 0] }));
    expect(up).toContain("&VENT XB=-4.25,4.25,-1.38,1.38,-1.38,-1.38, SURF_ID='SUPPLY'");
    expect(up).toContain("&VENT XB=-4.25,4.25,-1.38,1.38,1.38,1.38, SURF_ID='EXHAUST'");
  });

  it("is a closed box with the fans off", () => {
    expect(fdsDeck(inputs({ flow_speed_cm_s: 0 }))).not.toContain("SURF_ID='SUPPLY'");
  });

  it("puts a soot device at every vent, in FDS coordinates", () => {
    const deck = fdsDeck(inputs());
    expect(deck).toContain("&DEVC ID='vent_fwd', XYZ=4.0,0.0,1.37, QUANTITY='SOOT DENSITY' /");
    expect(deck).toContain("&DEVC ID='vent_aft', XYZ=-4.0,0.0,1.37,");
    expect(toFds([1, 2, 3])).toEqual([1, 3, 2]);
  });

  it("picks a simple-chemistry fuel for the material", () => {
    expect(fuelFor("heptane droplet").name).toBe("N-HEPTANE");
    expect(fuelFor("PMMA rod").c).toBe(5);
    expect(fuelFor("cable insulation").name).toBe("PMMA");
  });
});
