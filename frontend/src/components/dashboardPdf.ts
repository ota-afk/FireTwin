import type { jsPDF } from "jspdf";
import type { ScenarioIn } from "../api/types";
import type { Session } from "../store/useScenario";
import { flowDirLabel } from "./controlPanel.logic";
import {
  buildResearchReport, evidenceIds, reportInputs, reportPercent, reportTimestamp,
  type ReportSession, type ResearchReport,
} from "./sessionReport";

const INK = "#17202B", MUTED = "#626B76", LINE = "#D3D8DF";
const ACCENT = "#CE476F", PINK = "#FBE5EC", BLUE = "#527BA9", PALE = "#F5F7FA";
const M = 10, W = 277, BOTTOM = 192, BODY = 7.5, LEADING = 3.1;
const clean = (text: string) => text.replace(/₂/g, "2").replace(/→/g, " to ")
  .replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const timestamp = (at: number | null) => reportTimestamp(at).replace(" UTC", "");
const number = (value: number | null) => value === null ? "Not recorded" : String(value);
const conditions = (i: ScenarioIn) => `O2 ${i.o2_pct}% | ${i.pressure_kpa} kPa | ${i.flow_speed_cm_s} cm/s | dir ${flowDirLabel(i.flow_dir)} | ${i.module}`;

/** Changes are lossless relative to the full assessment snapshot printed above each table. */
function changes(before: ScenarioIn | null, after: ScenarioIn): string {
  if (!before) return reportInputs(after);
  const out: string[] = [];
  if (before.material !== after.material) out.push(`Material: ${after.material}`);
  if (before.module !== after.module) out.push(`Module: ${after.module}`);
  if (before.o2_pct !== after.o2_pct) out.push(`O2 ${before.o2_pct}% to ${after.o2_pct}%`);
  if (before.pressure_kpa !== after.pressure_kpa) out.push(`Pressure ${after.pressure_kpa} kPa`);
  if (before.flow_speed_cm_s !== after.flow_speed_cm_s) out.push(`Flow ${before.flow_speed_cm_s} to ${after.flow_speed_cm_s} cm/s`);
  if (before.flow_dir.some((v, j) => v !== after.flow_dir[j])) out.push(`Direction ${flowDirLabel(after.flow_dir)}`);
  return out.join("; ") || "No model-input change";
}

class DashboardPages {
  y = 25;
  private label = "";
  private page = 0;
  constructor(readonly pdf: jsPDF, private report: ResearchReport) {}
  get pageNumber() { return this.page; }

  newPage(label = this.label) {
    this.label = label;
    const p = this.pdf;
    if (this.page++) p.addPage();
    p.setFillColor("#FFFFFF"); p.rect(0, 0, 297, 210, "F");
    p.setFillColor(ACCENT); p.rect(M, 9, 2, 10, "F");
    this.print(`FIRETWIN / ${label}`, M + 5, 15, 14, true);
    this.print("SESSION ANALYTICS  |  NASA Space Apps 2026", 287, 14, 7, false, MUTED, "right");
    p.setDrawColor(LINE); p.setLineWidth(0.25); p.line(M, 21, 287, 21);
    this.y = 25;
  }

  print(text: string, x: number, y: number, size = BODY, bold = false, color = INK, align: "left" | "right" = "left") {
    this.pdf.setFont("helvetica", bold ? "bold" : "normal"); this.pdf.setFontSize(size);
    this.pdf.setTextColor(color); this.pdf.text(clean(text), x, y, { align });
  }

  lines(text: string, width: number, size = BODY): string[] {
    this.pdf.setFont("helvetica", "normal"); this.pdf.setFontSize(size);
    return this.pdf.splitTextToSize(clean(text), width) as string[];
  }

  text(text: string, width = W, size = BODY, bold = false) {
    for (const line of this.lines(text, width, size)) {
      if (this.y + LEADING > BOTTOM) this.newPage();
      this.print(line, M, this.y + 2.5, size, bold);
      this.y += LEADING;
    }
    this.y += 1;
  }

  heading(text: string, width = W) {
    if (this.y + 14 > BOTTOM) this.newPage();
    this.pdf.setFillColor(PINK); this.pdf.rect(M, this.y, width, 5.6, "F");
    this.print(text, M + 2, this.y + 4, 8, true); this.y += 7;
  }

  /** Repeats headers and splits unusually long rows across pages without truncation. */
  table(headers: string[], rows: string[][], widths: number[], links?: (row: number, col: number) => string | undefined) {
    const width = widths.reduce((sum, value) => sum + value, 0);
    const header = () => {
      this.pdf.setFillColor("#E9EDF2"); this.pdf.rect(M, this.y, width, 5.5, "F");
      let x = M;
      headers.forEach((title, i) => { this.print(title, x + 1.4, this.y + 4, 6.7, true); x += widths[i]; });
      this.y += 5.5;
    };
    if (this.y + 12 > BOTTOM) this.newPage();
    header();
    rows.forEach((row, rowIndex) => {
      const cells = row.map((cell, col) => this.lines(cell, widths[col] - 2.8));
      const max = Math.max(1, ...cells.map(cell => cell.length));
      let offset = 0;
      while (offset < max) {
        let fit = Math.floor((BOTTOM - this.y - 1.3) / LEADING);
        const capacity = Math.floor((BOTTOM - 30.5 - 1.3) / LEADING);
        if (fit < 1 || (offset === 0 && max > fit && max <= capacity)) {
          this.newPage(); header(); fit = Math.floor((BOTTOM - this.y - 1.3) / LEADING);
        }
        const count = Math.min(max - offset, fit), h = count * LEADING + 1.3;
        if (rowIndex % 2 === 0) { this.pdf.setFillColor(PALE); this.pdf.rect(M, this.y, width, h, "F"); }
        let x = M;
        cells.forEach((cell, col) => {
          const visible = col === 0 && offset > 0 ? cell.slice(0, count) : cell.slice(offset, offset + count);
          visible.forEach((line, j) => {
            this.print(line, x + 1.4, this.y + 2.7 + j * LEADING);
            const url = links?.(rowIndex, col);
            if (url) this.pdf.link(x + 1, this.y + j * LEADING, widths[col] - 2, LEADING, { url });
          });
          x += widths[col];
        });
        this.pdf.setDrawColor(LINE); this.pdf.setLineWidth(0.15);
        this.pdf.line(M, this.y + h, M + width, this.y + h);
        this.y += h; offset += count;
      }
    });
    this.y += 2;
  }

  metrics(session: ReportSession) {
    const delta = (session.final.burn_probability - session.initial.burn_probability) * 100;
    const tiles = [
      ["IGNITION BURN (MODEL)", reportPercent(session.initial.burn_probability)],
      ["FINAL BURN (MODEL)", reportPercent(session.final.burn_probability)],
      ["CHANGE / PERCENTAGE POINTS", `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp`],
      ["FINAL RECORDED VERDICT", session.final.state.toUpperCase()],
    ];
    const width = (W - 9) / 4;
    tiles.forEach(([label, value], i) => {
      const x = M + i * (width + 3);
      this.pdf.setFillColor(PINK); this.pdf.rect(x, this.y, width, 5, "F");
      this.print(label, x + 2, this.y + 3.6, 7, true);
      this.print(value, x + 2, this.y + 13.5, i === 3 ? 13 : 17, true, ACCENT);
      this.pdf.setDrawColor(LINE); this.pdf.line(x, this.y + 16, x + width, this.y + 16);
    });
    this.y += 19;
  }

  sidebar(session: ReportSession, top: number): number {
    const p = this.pdf, x = 226, width = 61;
    p.setDrawColor(LINE); p.rect(x, top, width, 39, "S");
    this.print("BURN PROBABILITY / MODEL", x + 3, top + 5, 7.5, true);
    [["Ignition", session.initial.burn_probability], ["Final", session.final.burn_probability]].forEach(([label, value], i) => {
      const y = top + 11 + i * 12;
      this.print(String(label), x + 3, y, 7.5);
      this.print(reportPercent(Number(value)), x + width - 3, y, 7.5, true, INK, "right");
      p.setFillColor("#E9EDF2"); p.rect(x + 3, y + 2, width - 6, 4, "F");
      p.setFillColor(i === 0 ? ACCENT : BLUE); p.rect(x + 3, y + 2, (width - 6) * Math.max(0, Math.min(1, Number(value))), 4, "F");
    });
    this.print("0%", x + 3, top + 36, 6, false, MUTED);
    this.print("100%", x + width - 3, top + 36, 6, false, MUTED, "right");
    const detection = [...session.steps].reverse().find(step => step.detection)?.detection;
    const lines = [
      `Trust: ${session.initial.trust} to ${session.final.trust}`,
      `Initial range: ${session.initial.extrapolated ? "OUTSIDE TESTED RANGE" : "Within model ranges"}`,
      `Final range: ${session.final.extrapolated ? "OUTSIDE TESTED RANGE" : "Within model ranges"}`,
      `Alarm: ${!detection ? "Not recorded" : !detection.detected ? "Not detected" : `${number(detection.time_to_detect_s)} s (model)`}`,
      `Applied actions: ${session.steps.filter(step => step.kind === "apply").length}`,
      `Supporting references: ${session.evidence.length}`,
      `Synthetic references: ${session.evidence.filter(ref => ref.is_synthetic).length}`,
      "Evidence: shared appendix",
    ];
    const wrapped = lines.flatMap(line => this.lines(line, width - 6, 7.2));
    const y = top + 43, h = 10 + wrapped.length * LEADING;
    p.setDrawColor(LINE); p.rect(x, y, width, h, "S");
    this.print("TRACE & STATUS", x + 3, y + 5, 7.5, true);
    wrapped.forEach((line, i) => this.print(line, x + 3, y + 10 + i * LEADING, 7.2));
    return y + h + 3;
  }

  finish() {
    const p = this.pdf, count = p.getNumberOfPages();
    for (let i = 1; i <= count; i++) {
      p.setPage(i); p.setDrawColor(LINE); p.line(M, 196, 287, 196);
      this.print("Probabilities are model estimates; crew risk is assumed. Sources are measured unless marked SYNTHETIC. Times: app responses, UTC.", M, 200, 6.5, false, MUTED);
      this.print(`Exported ${reportTimestamp(this.report.generatedAt)}`, M, 205, 6.5, false, MUTED);
      this.print(`Flame is illustrative; verdicts come from NASA PSI data.   ${i} / ${count}`, 287, 205, 6.5, false, MUTED, "right");
    }
  }
}

function drawSession(pages: DashboardPages, session: ReportSession) {
  pages.newPage(`SESSION ${session.id}`);
  pages.text(`Started ${reportTimestamp(session.startedAt)} | Scenario ${session.initial.scenario_id}${session.synthetic ? " | SYNTHETIC DATA PRESENT" : ""}`, W, 7.5, true);
  pages.metrics(session);
  pages.text(`IGNITION: ${reportInputs(session.initial.inputs)}`, W, 7.5);
  pages.text(`FINAL: ${reportInputs(session.final.inputs)}`, W, 7.5);
  const firstPage = pages.pageNumber, sidebarBottom = pages.sidebar(session, pages.y);
  pages.heading("SUPPRESSION ASSESSMENTS / SAVED RESPONSES", 211);
  if (!session.rankings.length) pages.text("No ranking recorded; no alternative probabilities were computed for export.", 211);
  session.rankings.forEach((ranking, i) => {
    pages.text(`A${i + 1} | ${timestamp(ranking.at)} UTC | Recommended: ${ranking.result.recommended}`, 211, 7.5, true);
    pages.text(ranking.inputs ? `Input snapshot: ${reportInputs(ranking.inputs)}` : "Assessment inputs not recorded; complete proposed values shown below.", 211, 7);
    pages.table(["Method", "Ext. %", "Risk idx", "Score", "Support", "Proposed changes from input snapshot", "Evidence"],
      ranking.result.actions.map(action => [
        `${action.label}${action.action === ranking.result.recommended ? " *" : ""}`,
        reportPercent(action.extinction_probability), action.crew_risk.toFixed(3), action.score.toFixed(4),
        action.data_support, changes(ranking.inputs, action.new_inputs), evidenceIds(session, action.sources),
      ]), [35, 16, 14, 16, 18, 80, 32]);
  });
  if (pages.pageNumber === firstPage) pages.y = Math.max(pages.y, sidebarBottom);
  pages.heading("TIMESTAMPED RESULTS / RECORDED OUTCOMES");
  pages.table(["Step / action", "Recorded at (UTC)", "Material", "Conditions used", "Result / model burn / spread", "Trust / range", "Evidence"],
    session.steps.map(step => {
      const r = step.prediction, d = step.detection;
      return [step.kind === "apply" ? `Apply: ${step.action ?? "Not recorded"}` : step.kind.toUpperCase(), timestamp(step.at),
        r?.inputs.material ?? "Not recorded", r ? conditions(r.inputs) : "Detector input snapshot not recorded",
        r ? `${r.state.toUpperCase()} / ${reportPercent(r.burn_probability)} / spread ${r.spread_rate_mm_s === null ? "Not modeled" : `${r.spread_rate_mm_s} mm/s`}`
          : d ? `${d.detected ? `${d.detector_id ?? "Detector not recorded"}: ${number(d.time_to_detect_s)} s (model)` : "Not detected"}. ${d.note}` : "Not recorded",
        r ? `${r.trust} / ${r.extrapolated ? "OUTSIDE TESTED RANGE" : "Within model ranges"}` : "Illustrative detector model",
        r ? evidenceIds(session, r.nearest_tests) : "Not recorded",
      ];
    }), [24, 37, 32, 71, 43, 28, 42]);
}

function safeUrl(url: string): string | undefined {
  try { return ["http:", "https:"].includes(new URL(url).protocol) ? url : undefined; } catch { return undefined; }
}

function drawEvidence(pages: DashboardPages, report: ResearchReport) {
  pages.newPage("EVIDENCE REGISTER");
  pages.text("Recorded supporting test rows. Reference numbers [E1], [E2], etc. are scoped to each session. Not recorded is missing data, not zero.");
  const sources = [...new Set(report.sessions.flatMap(session => session.evidence.map(ref => ref.source_url)).filter(Boolean))];
  const rows = report.sessions.flatMap(session => session.evidence.map((ref, i) => [
    String(session.id), `[E${i + 1}]`, ref.test_id, ref.investigation, ref.fuel_type, number(ref.o2_pct),
    number(ref.pressure_kpa), number(ref.flow_cm_s), ref.outcome, ref.is_synthetic ? "SYNTHETIC" : "Measured",
    ref.source_url ? `S${sources.indexOf(ref.source_url) + 1}` : "Not recorded",
  ]));
  pages.heading("NASA TEST DATA / SAVED REFERENCES");
  if (rows.length) pages.table(["Session", "Ref.", "Test ID", "Investigation", "Fuel", "O2 (%)", "P (kPa)", "Flow (cm/s)", "Outcome", "Provenance", "Source"],
    rows, [13, 15, 45, 35, 20, 19, 24, 24, 25, 30, 27]);
  report.sessions.filter(session => !session.evidence.length).forEach(session => pages.text(`Session ${session.id}: no supporting test references recorded.`));
  pages.heading("SOURCE LINKS / DEDUPLICATED URLS");
  if (sources.length) pages.table(["ID", "Source URL"], sources.map((url, i) => [`S${i + 1}`, url]), [13, 264],
    (row, col) => col === 1 ? safeUrl(sources[row]) : undefined);
  else pages.text("No source URLs recorded.");
  pages.text("* Recommended at that saved assessment. Ext. % = model extinction probability; risk idx = assumed crew-risk index. Proposed changes apply to that assessment's full input snapshot. No stored probabilities or recommendations are recomputed during export.", W, 7);
}

/** Compact vector/text dashboards with a shared measured-data appendix. */
export async function createResearchPdf(report: ResearchReport): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  pdf.setProperties({ title: "FireTwin - Session analytics report", subject: "Recorded session values, suppression probabilities and supporting evidence", creator: "FireTwin" });
  const pages = new DashboardPages(pdf, report);
  report.sessions.forEach(session => drawSession(pages, session));
  drawEvidence(pages, report); pages.finish();
  return pdf;
}

export async function downloadDashboardPdf(sessions: readonly Session[]) {
  const report = buildResearchReport(sessions);
  const pdf = await createResearchPdf(report);
  pdf.save(`firetwin-research-${new Date(report.generatedAt).toISOString().slice(0, 10)}.pdf`);
}
