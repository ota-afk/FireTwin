// EXPERIMENT: FDS slice loader (JSON and fds2ascii-style CSV).
import { describe, expect, it } from "vitest";
import { frameAt, parseSlice, parseSliceCsv, parseSliceJson, rainbow } from "./fdsSlice";

describe("FDS slice loader", () => {
  it("reads the JSON format and converts FDS (Z up) to scene coordinates", () => {
    const s = parseSliceJson(JSON.stringify({
      format: "firetwin-fds-slice/1", quantity: "SOOT DENSITY", units: "mg/m3",
      times: [0, 5], points: [[1, 2, 3], [4, 5, 6]], values: [[0, 1], [2, 3]],
    }));
    expect(s.quantity).toBe("SOOT DENSITY");
    expect(Array.from(s.positions)).toEqual([1, 3, 2, 4, 6, 5]);
    expect(s.frames.map(f => Array.from(f))).toEqual([[0, 1], [2, 3]]);
    expect([s.min, s.max]).toEqual([0, 3]);
  });

  it("keeps scene coordinates when the file says so", () => {
    const s = parseSliceJson(JSON.stringify({ coords: "scene", times: [0], points: [[1, 2, 3]], values: [[1]] }));
    expect(Array.from(s.positions)).toEqual([1, 2, 3]);
  });

  it("reads CSV rows (t,x,y,z,value) grouped by time", () => {
    const s = parseSliceCsv("t,X,Y,Z,SOOT DENSITY\n0,0,0,0,1\n0,1,0,0,2\n10,0,0,0,3\n10,1,0,0,4\n");
    expect(s.quantity).toBe("SOOT DENSITY");
    expect(s.times).toEqual([0, 10]);
    expect(s.frames.map(f => Array.from(f))).toEqual([[1, 2], [3, 4]]);
    expect(parseSlice("t,x,y,z,v\n0,0,0,0,1", "run.csv").times).toEqual([0]);
  });

  it("rejects malformed data", () => {
    expect(() => parseSliceJson(JSON.stringify({ times: [0], points: [[0, 0, 0]], values: [[1, 2]] }))).toThrow();
    expect(() => parseSliceCsv("t,x,y,z,v\n0,a,0,0,1")).toThrow();
  });

  it("loops frames over the run and maps values to Smokeview's rainbow", () => {
    expect(frameAt([0, 10, 20], 0)).toBe(0);
    expect(frameAt([0, 10, 20], 15)).toBe(1);
    expect(frameAt([0, 10, 20], 25)).toBe(0); // looped
    expect(rainbow(0)).toEqual([0, 0, 1]);
    expect(rainbow(1)).toEqual([1, 0, 0]);
  });
});
