/* FE-03: the control panel's rules, kept free of React so they're unit-tested. */
import type { MetaOut, ScenarioIn, Vec3 } from "../api/types";

// Slider limits from the contract (ScenarioIn: O2 10-40 %, flow 0-40 cm/s). The plan gives no
// pressure range; 30-110 kPa spans habitat ideas (10.2 psi = 70.3 kPa) up to ISS sea-level air.
export const LIMITS = {
  o2_pct: { min: 10, max: 40, step: 0.5, unit: "%" },
  flow_speed_cm_s: { min: 0, max: 40, step: 1, unit: "cm/s" },
  pressure_kpa: { min: 30, max: 110, step: 0.1, unit: "kPa" },
} as const;
export type SliderKey = keyof typeof LIMITS;

// Airflow direction buttons. The labels follow the ISS/aerospace convention the team asked for:
// Z is vertical (overhead/deck) and Y is lateral (port/starboard). `dir` is NOT relabelled: it stays
// in the API contract's frame (docs/contract.md, the same as three.js and the backend detector:
// +x fore, +y overhead, +z port), so "+Z overhead" sends [0, 1, 0] and smoke still drifts up.
export const FLOW_DIRS: { label: string; hint: string; dir: Vec3 }[] = [
  { label: "+X", hint: "fore", dir: [1, 0, 0] },
  { label: "−X", hint: "aft", dir: [-1, 0, 0] },
  { label: "+Y", hint: "port", dir: [0, 0, 1] },
  { label: "−Y", hint: "starboard", dir: [0, 0, -1] },
  { label: "+Z", hint: "overhead", dir: [0, 1, 0] },
  { label: "−Z", hint: "deck", dir: [0, -1, 0] },
];

/** A direction as the buttons name it ("+Z overhead"), or the raw vector if it isn't one of them.
    Reports and the timeline use this, so they never show a contract-frame vector that contradicts
    the button labels. */
export function flowDirLabel(dir: readonly number[]): string {
  const d = FLOW_DIRS.find(f => f.dir.length === dir.length && f.dir.every((v, i) => v === dir[i]));
  return d ? `${d.label} ${d.hint}` : `[${dir.join(", ")}]`;
}
// Number inputs next to each slider: what someone types becomes a valid value, or null while the
// text isn't a number yet (e.g. empty, or "-"). Out-of-range numbers snap to the slider's ends.
export function clampToLimits(key: SliderKey, value: number): number {
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, value));
}
// Typed values keep up to two decimals (e.g. 10.37 %); the number boxes use step 0.01 to match.
export const TYPED_STEP = 0.01;
export function parseTyped(key: SliderKey, text: string): number | null {
  const value = parseFloat(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(value) ? null : Math.round(clampToLimits(key, value) * 100) / 100;
}

export const sameDir = (a: Vec3, b: Vec3) => a.every((v, i) => v === b[i]);

// MetaOut ranges hold min/max per feature in the training data. The model's flow feature is
// flow_cm_s (ML-01) while ScenarioIn calls it flow_speed_cm_s, so accept either key.
const RANGE_KEYS: Record<SliderKey, string[]> = {
  o2_pct: ["o2_pct"],
  flow_speed_cm_s: ["flow_cm_s", "flow_speed_cm_s"],
  pressure_kpa: ["pressure_kpa"],
};
export interface Range { min: number; max: number }
type Ranges = Record<string, { min: number; max: number }>;

const SLIDER_LABELS: Record<SliderKey, string> = {
  o2_pct: "Oxygen", flow_speed_cm_s: "Airflow speed", pressure_kpa: "Cabin pressure",
};

/** The chosen material's fuel type ("solid", "droplet"), or null if /meta doesn't list it. */
export function fuelTypeOf(meta: MetaOut | null, material: string): string | null {
  return meta?.materials.find(m => m.name === material)?.fuel_type ?? null;
}

// The min/max for one slider in one ranges object; null if missing or malformed.
function readRange(ranges: Ranges | undefined, key: SliderKey): Range | null {
  if (!ranges) return null;
  for (const k of RANGE_KEYS[key]) {
    const r = ranges[k];
    if (r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max >= r.min) return { min: r.min, max: r.max };
  }
  return null;
}

// The ranges the model checks this material against: its own fuel type's (the predictor flags
// `extrapolated` that way: solids were tested at 14.2-22.2 % O2, droplets at 12-34 %).
// undefined = fall back to the overall ranges (no material chosen yet, or an older API without them).
function fuelRanges(meta: MetaOut | null, material: string): Ranges | undefined {
  const fuel = fuelTypeOf(meta, material);
  return fuel ? meta?.ranges_by_fuel_type?.[fuel] : undefined;
}

/** The tested range shaded on a slider: the material's fuel type if known, else every test. */
export function testedRange(meta: MetaOut | null, key: SliderKey, material = ""): Range | null {
  if (!meta) return null;
  return readRange(fuelRanges(meta, material), key) ?? readRange(meta.ranges, key);
}

/** Who the shaded range covers, for the slider note: "solid fuels", or "all fuels" as fallback. */
export function testedScope(meta: MetaOut | null, material: string): string {
  const fuel = fuelTypeOf(meta, material);
  return fuel && readRange(fuelRanges(meta, material), "o2_pct") ? `${fuel} fuels` : "all fuels";
}

export const isOutside = (value: number, range: Range | null) => !!range && (value < range.min || value > range.max);

// Left/right offsets (in % of the slider) for the shaded tested band, clipped to the slider.
export function bandPercent(range: Range, key: SliderKey) {
  const { min, max } = LIMITS[key];
  const pct = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
  return { left: pct(range.min), right: 100 - pct(range.max) };
}

// Inputs outside the tested range for the current material's data, by slider.
export function outsideKeys(inputs: ScenarioIn, meta: MetaOut | null): SliderKey[] {
  return (Object.keys(LIMITS) as SliderKey[]).filter(k => isOutside(inputs[k], testedRange(meta, k, inputs.material)));
}

/** Why the inputs are outside the NASA data, one phrase per input, e.g. "oxygen 26 % is above
    the highest tested for solid fuels (22.2 %)". Empty when nothing is outside (or no /meta). */
export function outsideReasons(inputs: ScenarioIn, meta: MetaOut | null): string[] {
  const scope = testedScope(meta, inputs.material);
  return outsideKeys(inputs, meta).map(k => {
    const range = testedRange(meta, k, inputs.material)!; // outsideKeys only returns keys with a range
    const { unit } = LIMITS[k];
    const above = inputs[k] > range.max;
    const bound = above ? range.max : range.min;
    return `${SLIDER_LABELS[k].toLowerCase()} ${inputs[k]} ${unit} is ${above ? "above the highest" : "below the lowest"} tested for ${scope} (${bound} ${unit})`;
  });
}

export function igniteBlocker(inputs: ScenarioIn, meta: MetaOut | null, busy: boolean): string | null {
  if (busy) return "Running…";
  if (!meta) return "Waiting for the API to list materials.";
  if (!inputs.material) return "Choose a material.";
  return null;
}
