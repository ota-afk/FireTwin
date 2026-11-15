/* EXPERIMENT: load pre-computed FDS slice data (e.g. the &SLCF PBY=0 soot plane from lab/fdsDeck.ts,
   run offline in FDS and exported with fds2ascii) so it can be replayed in the 3D scene.

   JSON  { "format": "firetwin-fds-slice/1", "quantity": "SOOT DENSITY", "units": "mg/m3",
           "coords": "fds" | "scene", "times": [t0, t1, ...], "points": [[X, Y, Z], ...],
           "values": [[v per point] per time], "source": "..." }
   CSV   header t,x,y,z,value (any header names in that order), one row per point per time,
         FDS coordinates (Z up).
   FDS coordinates (X, Y, Z up) become scene coordinates (x, y overhead, z port) as (X, Z, Y). */

export interface SliceData {
  quantity: string;
  units: string;
  source: string;
  times: number[];
  positions: Float32Array; // scene coordinates, xyz per point
  frames: Float32Array[]; // one value per point, per time
  min: number;
  max: number;
}

const fromFds = (p: number[]): [number, number, number] => [p[0], p[2], p[1]];

function finish(quantity: string, units: string, source: string, times: number[], pts: [number, number, number][], frames: number[][]): SliceData {
  if (!times.length || !pts.length) throw new Error("FDS slice has no data");
  if (frames.some(f => f.length !== pts.length)) throw new Error("FDS slice: every time needs one value per point");
  let min = Infinity, max = -Infinity;
  for (const f of frames) for (const v of f) { if (v < min) min = v; if (v > max) max = v; }
  return {
    quantity, units, source, times,
    positions: Float32Array.from(pts.flat()),
    frames: frames.map(f => Float32Array.from(f)),
    min, max,
  };
}

export function parseSliceJson(text: string): SliceData {
  const d = JSON.parse(text);
  if (!d || !Array.isArray(d.times) || !Array.isArray(d.points) || !Array.isArray(d.values)) {
    throw new Error("FDS slice JSON needs times, points and values");
  }
  const toScene = d.coords === "scene" ? (p: number[]) => [p[0], p[1], p[2]] as [number, number, number] : fromFds;
  return finish(String(d.quantity ?? "value"), String(d.units ?? ""), String(d.source ?? ""), d.times.map(Number),
    d.points.map((p: number[]) => toScene(p.map(Number))), d.values.map((row: number[]) => row.map(Number)));
}

export function parseSliceCsv(text: string): SliceData {
  const rows = text.trim().split(/\r?\n/);
  const header = rows.shift()?.split(",").map(s => s.trim()) ?? [];
  if (header.length < 5) throw new Error("FDS slice CSV needs columns t,x,y,z,value");
  const byTime = new Map<number, Map<string, number>>();
  const pts = new Map<string, [number, number, number]>();
  for (const line of rows) {
    if (!line.trim()) continue;
    const [t, x, y, z, v] = line.split(",").map(Number);
    if (![t, x, y, z, v].every(Number.isFinite)) throw new Error(`FDS slice CSV: bad row "${line}"`);
    const key = `${x},${y},${z}`;
    if (!pts.has(key)) pts.set(key, fromFds([x, y, z]));
    if (!byTime.has(t)) byTime.set(t, new Map());
    byTime.get(t)!.set(key, v);
  }
  const keys = [...pts.keys()];
  const times = [...byTime.keys()].sort((a, b) => a - b);
  return finish(header[4], "", "csv", times, keys.map(k => pts.get(k)!), times.map(t => keys.map(k => byTime.get(t)!.get(k) ?? 0)));
}

export const parseSlice = (text: string, name = ""): SliceData =>
  name.toLowerCase().endsWith(".csv") || !text.trimStart().startsWith("{") ? parseSliceCsv(text) : parseSliceJson(text);

/** The frame to show at a replay time (looping over the run). */
export function frameAt(times: number[], t: number): number {
  const span = times[times.length - 1] - times[0];
  const tt = span > 0 ? times[0] + (((t - times[0]) % span) + span) % span : times[0];
  let i = 0;
  while (i < times.length - 1 && times[i + 1] <= tt) i++;
  return i;
}

/** Smokeview's default "rainbow" colormap: blue, cyan, green, yellow, red for 0..1. */
export function rainbow(v: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, v)) * 4;
  const seg = Math.min(3, Math.floor(x)), f = x - seg;
  const stops: [number, number, number][] = [[0, 0, 1], [0, 1, 1], [0, 1, 0], [1, 1, 0], [1, 0, 0]];
  const a = stops[seg], b = stops[seg + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
