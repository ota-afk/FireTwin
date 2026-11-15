/* Saved browser data only: exporting never calls the API or recomputes a recommendation. */
import type { DetectOut, ScenarioIn, SimulateOut, SuppressOut, TestRef } from "../api/types";
import type { Session, SessionEvent } from "../store/useScenario";
import { flowDirLabel } from "./controlPanel.logic";

export interface ReportStep {
  kind: "simulate" | "detect" | "apply";
  at: number | null;
  action: string | null;
  prediction: SimulateOut | null;
  detection: DetectOut | null;
}

export interface ReportRanking {
  at: number | null;
  inputs: ScenarioIn | null;
  result: SuppressOut;
}

export interface ReportSession {
  id: number;
  startedAt: number;
  initial: SimulateOut;
  final: SimulateOut;
  steps: ReportStep[];
  rankings: ReportRanking[];
  evidence: TestRef[];
  synthetic: boolean;
}

export interface ResearchReport {
  generatedAt: number;
  sessions: ReportSession[];
}

export function evidenceKey(ref: TestRef): string {
  return JSON.stringify([
    ref.test_id, ref.investigation, ref.fuel_type, ref.o2_pct, ref.pressure_kpa,
    ref.flow_cm_s, ref.outcome, ref.source_url, ref.is_synthetic,
  ]);
}

export function evidenceIds(session: ReportSession, refs: TestRef[]): string {
  return refs.map(ref => `[E${session.evidence.findIndex(r => evidenceKey(r) === evidenceKey(ref)) + 1}]`).join(" ") || "None recorded";
}

export function reportTimestamp(at: number | null): string {
  return at === null || !Number.isFinite(at) ? "Timestamp not recorded" : new Date(at).toISOString().replace("T", " ").replace("Z", " UTC");
}

export function reportPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function reportInputs(inputs: ScenarioIn): string {
  return `${inputs.material} | O2 ${inputs.o2_pct}% | ${inputs.pressure_kpa} kPa | ` +
    `airflow ${inputs.flow_speed_cm_s} cm/s | direction ${flowDirLabel(inputs.flow_dir)} | ${inputs.module}`;
}

function predictionStep(kind: "simulate" | "apply", prediction: SimulateOut, at: number | null, action: string | null = null): ReportStep {
  return { kind, prediction, at, action, detection: null };
}

function normalizeSession(session: Session): ReportSession {
  if (!session.history.length) throw new Error(`Session ${session.id} has no saved prediction.`);
  const events = session.events ?? [];
  const rankings: ReportRanking[] = events
    .filter((event): event is Extract<SessionEvent, { kind: "suppress" }> => event.kind === "suppress")
    .map(event => ({ at: event.at, inputs: event.inputs, result: event.result }));
  if (!rankings.length && session.suppress) {
    rankings.push({ at: null, inputs: null, result: session.suppress });
  }
  const steps: ReportStep[] = [];
  if (events.some(event => event.kind === "simulate")) {
    for (const event of events) {
      if (event.kind === "simulate" || event.kind === "apply") {
        steps.push(predictionStep(event.kind, event.result, event.at, event.kind === "apply" ? event.action : null));
      } else if (event.kind === "detect") {
        steps.push({ kind: "detect", at: event.at, action: null, prediction: null, detection: event.result });
      }
    }
  } else {
    // Sessions made before event capture keep their data; missing times are never invented.
    const appliedRows = session.results?.rows.filter(row => row.step === "apply") ?? [];
    steps.push(predictionStep("simulate", session.history[0], session.startedAt));
    if (session.detect) steps.push({ kind: "detect", at: null, action: null, prediction: null, detection: session.detect });
    session.history.slice(1).forEach((result, i) => {
      steps.push(predictionStep("apply", result, null, appliedRows[i]?.action ?? null));
    });
  }
  const evidence = new Map<string, TestRef>();
  const add = (ref: TestRef) => evidence.set(evidenceKey(ref), ref);
  session.history.forEach(result => result.nearest_tests.forEach(add));
  rankings.forEach(ranking => ranking.result.actions.forEach(action => action.sources.forEach(add)));
  const refs = [...evidence.values()];
  return {
    id: session.id, startedAt: session.startedAt, initial: session.history[0],
    final: session.history[session.history.length - 1], steps, rankings, evidence: refs,
    synthetic: refs.some(ref => ref.is_synthetic),
  };
}

export function buildResearchReport(sessions: readonly Session[], generatedAt = Date.now()): ResearchReport {
  if (!sessions.length) throw new Error("Ignite a session before exporting a report.");
  // Freeze the export at click time, including every session rather than the replay on screen.
  const snapshot = structuredClone(sessions) as Session[];
  return { generatedAt, sessions: snapshot.map(normalizeSession) };
}
