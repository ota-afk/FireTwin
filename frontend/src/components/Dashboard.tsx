/* FE-09: the results dashboard under the 3D view. Rows come from GET /results (reloaded after every
   simulate, detect and apply), with the whiteboard's columns: variable changed, result, date & time,
   plus detection, sources. The chart shows burn probability across O2 at the current flow (one
   /simulate per point, outside the store so the live scenario is untouched), with the nearest
   tested NASA points overlaid. Export PDF downloads /export/{id}.pdf. */
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { TestRef } from "../api/types";
import { useScenario } from "../store/useScenario";
import { fdsDeck } from "../lab/fdsDeck";
import { downloadDashboardPdf } from "./dashboardPdf";
import { changeText, o2Sweep, resultText, sourceId, stampRows } from "./dashboard.logic";

function O2Chart() {
  const simulate = useScenario(s => s.simulate);
  const [curve, setCurve] = useState<[number, number][]>([]);
  const inputs = simulate?.inputs;
  const key = inputs ? JSON.stringify(inputs) : "";

  useEffect(() => {
    if (!inputs) {
      setCurve([]);
      return;
    }
    let live = true;
    Promise.all(o2Sweep().map(o2 => api.simulate({ ...inputs, o2_pct: o2 }).then(r => [o2, r.burn_probability] as [number, number])))
      .then(points => live && setCurve(points))
      .catch(() => live && setCurve([]));
    return () => { live = false; };
  }, [key]); // inputs change exactly when key does

  if (!simulate || !curve.length) return null;
  const W = 360, H = 140, x = (o2: number) => 30 + ((o2 - 10) / 30) * (W - 40), y = (p: number) => H - 20 - p * (H - 30);
  const tested: TestRef[] = simulate.nearest_tests.filter(t => t.o2_pct != null);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="o2-chart" role="img" aria-label="Burn probability across oxygen">
        <line x1={30} y1={H - 20} x2={W - 10} y2={H - 20} className="axis" />
        <line x1={30} y1={10} x2={30} y2={H - 20} className="axis" />
        <polyline points={curve.map(([o, p]) => `${x(o)},${y(p)}`).join(" ")} className="curve" />
        {tested.map((t, i) => (
          <circle key={i} cx={x(t.o2_pct!)} cy={y(t.outcome === "burned" ? 1 : 0)} r={4}
            className={t.outcome === "burned" ? "pt-burned" : "pt-out"}><title>{`${t.test_id}: ${t.outcome}`}</title></circle>
        ))}
        <text x={30} y={H - 4} className="tick">10% O₂</text>
        <text x={W - 50} y={H - 4} className="tick">40% O₂</text>
        <text x={34} y={16} className="tick">p = 1</text>
      </svg>
      <figcaption className="note">
        Burn probability across O₂ at {simulate.inputs.flow_speed_cm_s} cm/s ({simulate.inputs.material}). Dots: nearest tested points (top = burned, bottom = extinguished).
      </figcaption>
    </figure>
  );
}

export function Dashboard() {
  const dashboardRef = useRef<HTMLElement>(null);
  const scenarioId = useScenario(s => s.simulate?.scenario_id ?? null);
  const historyLen = useScenario(s => s.history.length);
  const detect = useScenario(s => s.detect);
  const results = useScenario(s => s.results);
  const loadingResults = useScenario(s => s.loading.results);
  const loadResults = useScenario(s => s.loadResults);
  const timeline = useScenario(s => s.timeline);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const stamps = useRef<string[]>([]);

  useEffect(() => {
    if (scenarioId) void loadResults();
    else stamps.current = [];
  }, [scenarioId, historyLen, detect, loadResults]);

  const rows = results?.scenario_id === scenarioId ? results?.rows ?? [] : [];
  stamps.current = stampRows(stamps.current, rows.length, new Date().toLocaleString());

  return (
    <section ref={dashboardRef} className="area-dash glass panel" aria-label="Results dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="panel-title">Dashboard</h2>
        <div className="export-menu" role="group" aria-label="Export">
          <button
            type="button" className="btn-ghost" disabled={exporting}
            onClick={async () => {
              if (!dashboardRef.current) return;
              setExporting(true);
              setExportError(null);
              try { await downloadDashboardPdf(dashboardRef.current, timeline); }
              catch { setExportError("Could not export the dashboard PDF."); }
              finally { setExporting(false); }
            }}
          >
            {exporting ? "Creating PDF…" : "Export to PDF"}
          </button>
          {/* EXPERIMENT: the current controls as a NIST FDS input deck, to run offline in FDS/Smokeview. */}
          <button
            type="button" className="btn-ghost" title="NIST FDS input file for the current controls (g = 0)"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([fdsDeck(useScenario.getState().inputs)], { type: "text/plain" }));
              const a = document.createElement("a");
              a.href = url; a.download = "firetwin_iss.fds"; a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            FDS deck
          </button>
        </div>
      </div>
      {exportError && <p className="error" role="alert">{exportError}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Step</th><th>Variable changed</th><th>Result</th><th>Sources</th><th>Date &amp; time</th></tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r, i) => (
              <tr key={i}>
                <td className="mono">{i + 1}. {r.step}</td>
                <td>{changeText(r)}</td>
                <td>{resultText(r)}</td>
                <td className="mono">{r.sources.map(sourceId).join(", ") || "—"}</td>
                <td className="mono">{stamps.current[i]}</td>
              </tr>
            )) : loadingResults ? (
              <tr><td colSpan={5} className="na">Loading results...</td></tr>
            ) : (
              <tr><td colSpan={5} className="na">Every result will be recorded here with its date and time.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <O2Chart />
    </section>
  );
}
