// FE-03: control panel rules (tested range lookup, shading, outside-range flags, Ignite gating).
import { describe, expect, it } from "vitest";
import type { MetaOut, Vec3 } from "../api/types";
import { smokeSettings } from "../scene/smokeLogic";
import { DEFAULT_SCENARIO } from "../api/types";
import {
  FLOW_DIRS, bandPercent, flowDirLabel, clampToLimits, igniteBlocker, isOutside, outsideKeys, outsideReasons, parseTyped,
  testedRange, testedScope,
} from "./controlPanel.logic";

const meta = (ranges: MetaOut["ranges"]): MetaOut => ({
  materials: [{ name: "Nomex", fuel_type: "solid", n_tests: 12 }], ranges, ranges_by_fuel_type: {}, investigations: [],
});

describe("testedRange", () => {
  it("reads O2 and pressure by their contract names", () => {
    const m = meta({ o2_pct: { min: 15, max: 25 }, pressure_kpa: { min: 50, max: 101.3 } });
    expect(testedRange(m, "o2_pct")).toEqual({ min: 15, max: 25 });
    expect(testedRange(m, "pressure_kpa")).toEqual({ min: 50, max: 101.3 });
  });
  it("accepts the model's flow_cm_s name for the flow slider", () => {
    expect(testedRange(meta({ flow_cm_s: { min: 0, max: 20 } }), "flow_speed_cm_s")).toEqual({ min: 0, max: 20 });
  });
  it("returns null with no API data or a malformed range", () => {
    expect(testedRange(null, "o2_pct")).toBeNull();
    expect(testedRange(meta({ o2_pct: { min: 30, max: 20 } }), "o2_pct")).toBeNull();
  });
});

// The real numbers from ml/artifacts/feature_ranges.json: droplets stretch the overall O2 range.
const byFuel: MetaOut = {
  materials: [
    { name: "Black rod", fuel_type: "solid", n_tests: 37 },
    { name: "Heptane", fuel_type: "droplet", n_tests: 40 },
  ],
  ranges: { o2_pct: { min: 12, max: 34 }, pressure_kpa: { min: 70.17, max: 309.27 }, flow_cm_s: { min: 0, max: 28 } },
  ranges_by_fuel_type: {
    solid: { o2_pct: { min: 14.2, max: 22.2 }, pressure_kpa: { min: 101.3, max: 101.3 }, flow_cm_s: { min: 0, max: 28 } },
    droplet: { o2_pct: { min: 12, max: 34 }, pressure_kpa: { min: 70.17, max: 309.27 }, flow_cm_s: { min: 0, max: 0 } },
  },
  investigations: [],
};
const blackRod = { ...DEFAULT_SCENARIO, material: "Black rod", flow_speed_cm_s: 16 };

describe("tested range per fuel type", () => {
  it("shades the material's own fuel type, the range the model checks", () => {
    expect(testedRange(byFuel, "o2_pct", "Black rod")).toEqual({ min: 14.2, max: 22.2 });
    expect(testedRange(byFuel, "o2_pct", "Heptane")).toEqual({ min: 12, max: 34 });
    expect(testedScope(byFuel, "Black rod")).toBe("solid fuels");
  });
  it("falls back to every test when the material or its fuel ranges are unknown", () => {
    expect(testedRange(byFuel, "o2_pct", "")).toEqual({ min: 12, max: 34 });
    expect(testedRange({ ...byFuel, ranges_by_fuel_type: {} }, "o2_pct", "Black rod")).toEqual({ min: 12, max: 34 });
    expect(testedScope(byFuel, "")).toBe("all fuels");
  });
  it("flags 26 % O2 for a solid, which the overall 12-34 % band hid", () => {
    expect(outsideKeys({ ...blackRod, o2_pct: 26 }, byFuel)).toEqual(["o2_pct"]);
    expect(outsideKeys({ ...blackRod, o2_pct: 22 }, byFuel)).toEqual([]);
  });
  it("says which input is outside and by how much", () => {
    expect(outsideReasons({ ...blackRod, o2_pct: 26 }, byFuel)).toEqual([
      "oxygen 26 % is above the highest tested for solid fuels (22.2 %)",
    ]);
    expect(outsideReasons({ ...blackRod, o2_pct: 21, pressure_kpa: 70 }, byFuel)).toEqual([
      "cabin pressure 70 kPa is below the lowest tested for solid fuels (101.3 kPa)",
    ]);
    expect(outsideReasons(blackRod, byFuel)).toEqual([]);
  });
});

describe("outside the tested range", () => {
  it("flags a Moon-habitat oxygen level the data never reached", () => {
    const m = meta({ o2_pct: { min: 15, max: 25 } });
    expect(isOutside(34, testedRange(m, "o2_pct"))).toBe(true);
    expect(outsideKeys({ ...DEFAULT_SCENARIO, o2_pct: 34 }, m)).toEqual(["o2_pct"]);
    expect(outsideKeys(DEFAULT_SCENARIO, m)).toEqual([]);
  });
  it("never flags anything when ranges are unknown", () => {
    expect(outsideKeys({ ...DEFAULT_SCENARIO, o2_pct: 40 }, null)).toEqual([]);
  });
});

describe("bandPercent", () => {
  it("places the shaded band on the 10-40 % oxygen slider", () => {
    expect(bandPercent({ min: 16, max: 25 }, "o2_pct")).toEqual({ left: 20, right: 50 });
  });
  it("clips a band that runs past the slider", () => {
    expect(bandPercent({ min: 5, max: 50 }, "o2_pct")).toEqual({ left: 0, right: 0 });
  });
});

describe("number inputs", () => {
  it("keep typed values inside each slider's limits", () => {
    expect(clampToLimits("o2_pct", 90)).toBe(40);
    expect(clampToLimits("flow_speed_cm_s", -5)).toBe(0);
    expect(parseTyped("o2_pct", "23.5")).toBe(23.5);
    expect(parseTyped("o2_pct", "23,5")).toBe(23.5);
    expect(parseTyped("pressure_kpa", "500")).toBe(110);
  });
  it("accept any value to two decimals", () => {
    expect(parseTyped("o2_pct", "10.37")).toBe(10.37);
    expect(parseTyped("flow_speed_cm_s", "12.5")).toBe(12.5);
    expect(parseTyped("o2_pct", "10.376")).toBe(10.38);
    expect(parseTyped("o2_pct", "10.00")).toBe(10);
  });
  it("wait while the text isn't a number yet", () => {
    expect(parseTyped("o2_pct", "")).toBeNull();
    expect(parseTyped("o2_pct", "-")).toBeNull();
    expect(parseTyped("o2_pct", "abc")).toBeNull();
  });
});

describe("Ignite", () => {
  it("waits for /meta, then for a material, and not while running", () => {
    expect(igniteBlocker(DEFAULT_SCENARIO, null, false)).toMatch(/API/);
    expect(igniteBlocker(DEFAULT_SCENARIO, meta({}), false)).toBe("Choose a material.");
    expect(igniteBlocker({ ...DEFAULT_SCENARIO, material: "Nomex" }, meta({}), false)).toBeNull();
    expect(igniteBlocker({ ...DEFAULT_SCENARIO, material: "Nomex" }, meta({}), true)).toBe("Running…");
  });
  it("offers all six axis directions as unit vectors", () => {
    expect(FLOW_DIRS).toHaveLength(6);
    for (const d of FLOW_DIRS) expect(d.dir.reduce((s, v) => s + v * v, 0)).toBe(1);
  });
  it("labels Z as vertical and Y as lateral, while sending contract-frame vectors (+y up, +z port)", () => {
    const byLabel = Object.fromEntries(FLOW_DIRS.map(d => [`${d.label} ${d.hint}`, d.dir]));
    expect(byLabel).toEqual({
      "+X fore": [1, 0, 0], "−X aft": [-1, 0, 0],
      "+Y port": [0, 0, 1], "−Y starboard": [0, 0, -1],
      "+Z overhead": [0, 1, 0], "−Z deck": [0, -1, 0], // three.js and the backend detector: +y is up
    });
  });
  it("names directions the way the buttons do, for reports and the timeline", () => {
    expect(flowDirLabel([0, 1, 0])).toBe("+Z overhead");
    expect(flowDirLabel([0, 0, -1])).toBe("−Y starboard");
    expect(flowDirLabel([1, 0, 0])).toBe("+X fore");
    expect(flowDirLabel([0.6, 0.8, 0])).toBe("[0.6, 0.8, 0]");
  });
  it("drifts smoke toward the wall each button names (three.js frame: +y overhead, +z port)", () => {
    const smokeDir = (dir: Vec3) => smokeSettings({
      scenario_id: "t", state: "burning", burn_probability: 0.9, spread_rate_mm_s: null, trust: "strong",
      extrapolated: false, nearest_tests: [], explanation: "", inputs: { ...DEFAULT_SCENARIO, flow_dir: dir },
    }).dir;
    const button = (hint: string) => FLOW_DIRS.find(d => d.hint === hint)!.dir;
    expect(smokeDir(button("overhead"))[1]).toBe(1); // up, toward the ceiling vents
    expect(smokeDir(button("deck"))[1]).toBe(-1);
    expect(smokeDir(button("port"))[2]).toBe(1);
    expect(smokeDir(button("starboard"))[2]).toBe(-1);
  });
});
