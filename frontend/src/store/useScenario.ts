/* FE-02: the one store every tab reads. One action per API endpoint, plus the scenario state
   machine from the Project Overview: idle -> burning -> detected -> suppressing -> out | still burning.
   The model (API) decides every state; the 3D scene only illustrates it. */
import { create } from "zustand";
import { api } from "../api/client";
import type {
  ActionName, ChatOut, DetectOut, MetaOut, ResultsOut, ScenarioIn, SimulateOut, SuppressOut,
} from "../api/types";
import { DEFAULT_SCENARIO } from "../api/types";
import { alarmAfterS } from "../scene/alarmLogic";
import { flowDirLabel } from "../components/controlPanel.logic";
import { loadSavedInputs, saveInputs } from "./savedInputs";

export type Phase = "idle" | "burning" | "detected" | "suppressing" | "out" | "still_burning";

export type PhaseEvent =
  | { type: "simulated"; state: SimulateOut["state"] }
  | { type: "detected"; detected: boolean }
  | { type: "suppress_ranked" }
  | { type: "applied"; state: SimulateOut["state"] }
  | { type: "reset" };

// Pure, so the demo's state flow is predictable and unit-tested.
export function nextPhase(phase: Phase, ev: PhaseEvent): Phase {
  switch (ev.type) {
    case "reset":
      return "idle";
    case "simulated":
      return ev.state === "burning" ? "burning" : "out";
    case "detected":
      // A fire the vents never see (e.g. fans off) keeps burning undetected.
      return phase === "burning" && ev.detected ? "detected" : phase;
    case "suppress_ranked":
      return phase === "burning" || phase === "detected" || phase === "still_burning" ? "suppressing" : phase;
    case "applied":
      return ev.state === "extinguished" ? "out" : "still_burning";
  }
}

// Replay: seconds between the alarm (or ignition) and each applied action, and between actions.
export const REPLAY_STEP_MS = 2500;

/** The phase a session showed at an earlier step of its replay. */
export function replayPhase(session: Session, step: number): Phase {
  if (step === 0) return session.detect?.detected ? "detected" : "burning";
  return session.history[step].state === "extinguished" ? "out" : "still_burning";
}

export type Step = "meta" | "simulate" | "detect" | "suppress" | "apply" | "results" | "chat";
export interface ChatTurn { question: string; reply: ChatOut }
export interface TimelineEvent {
  at: number;
  variable: string;
  action: "used" | "modified" | "removed";
  from: string | null;
  value: string | null;
  context: string;
}

// Browser response timestamps and exact saved payloads for the session research report.
// They describe when the app recorded a step, not when a NASA experiment took place.
export type SessionEvent =
  | { kind: "simulate"; at: number; result: SimulateOut }
  | { kind: "detect"; at: number; result: DetectOut }
  | { kind: "suppress"; at: number; inputs: ScenarioIn; result: SuppressOut }
  | { kind: "apply"; at: number; action: ActionName; result: SimulateOut };

const TRACKED_INPUTS = ["material", "o2_pct", "pressure_kpa", "flow_speed_cm_s", "flow_dir"] as const;
type TrackedInput = typeof TRACKED_INPUTS[number];
const INPUT_LABELS: Record<TrackedInput, string> = {
  material: "Material", o2_pct: "Oxygen", pressure_kpa: "Cabin pressure",
  flow_speed_cm_s: "Airflow speed", flow_dir: "Airflow direction",
};
const inputValue = (key: TrackedInput, value: unknown) =>
  key === "flow_dir" && Array.isArray(value) ? flowDirLabel(value) : String(value);
const recordInputs = (inputs: ScenarioIn, action: TimelineEvent["action"], context: string, at = Date.now()) =>
  TRACKED_INPUTS.map(key => ({
    at, variable: INPUT_LABELS[key], action, from: null,
    value: inputValue(key, inputs[key]), context,
  }));

/* FE-09 sessions: every Ignite starts a session, a snapshot of everything that scenario showed.
   Later steps (detect, rank, apply, results) update their own session even while another one is on
   screen. Past sessions are read-only: selecting one shows its saved results, sets the controls to
   its values and replays it in 3D; Ignite starts a new session from those values. Kept while the
   tab is open (Render forgets scenarios when it sleeps, so replays never call the API). */
export interface Session {
  id: number; // the Ignite number (sessionCount), so ids only grow and never skip
  startedAt: number; // Date.now() when its /simulate returned
  inputs: ScenarioIn; // the values it was ignited with
  history: SimulateOut[]; // every prediction, in order (simulate, then each apply)
  detect: DetectOut | null;
  suppress: SuppressOut | null;
  results: ResultsOut | null;
  phase: Phase;
  curve: [number, number][] | null; // burn probability across O2 at its inputs; null = not fetched
  events?: SessionEvent[]; // older in-memory snapshots may not have response timestamps
}

interface ScenarioData {
  inputs: ScenarioIn;
  meta: MetaOut | null;
  simulate: SimulateOut | null; // latest prediction (from /simulate or /apply)
  detect: DetectOut | null;
  suppress: SuppressOut | null;
  results: ResultsOut | null;
  history: SimulateOut[]; // every prediction in this scenario, in order
  timeline: TimelineEvent[]; // variable edits and uses across this browser session
  chat: ChatTurn[];
  phase: Phase;
  // Frontend ignition counter: +1 on every successful /simulate (not /apply). The 3D scene restarts its
  // smoke and demo clock when it changes, even if the backend reuses a scenario_id (the BE-06 mock does).
  ignitions: number;
  // FE-06: set once per ignition and shared by every 3D view, so switching to Compare and back
  // neither restarts the demo clock nor fires the alarm again.
  ignitedAt: number | null; // Date.now() when this ignition's /simulate returned
  alarmId: string | null; // the detector that tripped, once the demo clock reached time_to_detect_s
  // FE-09: +1 on every successful Ignite, and only then; it numbers the sessions. Separate from
  // `ignitions`, which replays also bump (to restart the 3D smoke), so session numbers don't skip.
  sessionCount: number;
  sessions: Session[];
  liveSession: number | null; // the session the backend is still running; null before Ignite / after Reset
  viewing: number | null; // a past session shown read-only; null = the live one
  loading: Record<Step, boolean>;
  error: string | null;
}

interface ScenarioActions {
  setInputs: (patch: Partial<ScenarioIn>) => void;
  clearError: () => void;
  loadMeta: () => Promise<void>; // GET /meta
  runSimulate: () => Promise<SimulateOut | null>; // POST /simulate
  runDetect: () => Promise<DetectOut | null>; // POST /detect
  runSuppress: () => Promise<SuppressOut | null>; // POST /suppress
  runApply: (action: ActionName) => Promise<SimulateOut | null>; // POST /apply
  loadResults: () => Promise<ResultsOut | null>; // GET /results/{id}
  ask: (message: string) => Promise<ChatOut | null>; // POST /chat
  ignite: () => Promise<void>; // FE-03: /simulate, then /detect if the fire keeps burning
  reset: () => void; // ends the live fire; saved sessions stay
  viewSession: (id: number) => void; // show a session read-only and replay it
  viewLive: () => void; // back to the live session
  clearHistory: () => void; // drop every past session (the live one stays)
  setSessionCurve: (id: number, curve: [number, number][]) => void;
}

export type ScenarioStore = ScenarioData & ScenarioActions;

const IDLE_LOADING: Record<Step, boolean> = {
  meta: false, simulate: false, detect: false, suppress: false, apply: false, results: false, chat: false,
};

export const initialScenario: ScenarioData = {
  inputs: DEFAULT_SCENARIO,
  meta: null,
  simulate: null,
  detect: null,
  suppress: null,
  results: null,
  history: [],
  timeline: [],
  chat: [],
  phase: "idle",
  ignitions: 0,
  ignitedAt: null,
  alarmId: null,
  sessionCount: 0,
  sessions: [],
  liveSession: null,
  viewing: null,
  loading: IDLE_LOADING,
  error: null,
};

export const useScenario = create<ScenarioStore>()((set, get) => {
  // Late replies (review fix): every scenario call notes the epoch before it is sent and drops the
  // reply if the epoch has moved. Reset and each new ignition move it, so a /detect, /suppress,
  // /apply or /results reply that arrives after Reset (or after the next Ignite) never lands. resets
  // moves only on Reset: a /simulate reply is dropped if Reset came while it was in flight.
  let epoch = 0;
  let resets = 0;

  // Shared wrapper: sets the step's loading flag, records the error message, never throws.
  // A request that is no longer current (isCurrent() false) doesn't report its error either.
  async function run<T>(step: Step, call: () => Promise<T>, isCurrent: () => boolean = () => true): Promise<T | null> {
    set(s => ({ loading: { ...s.loading, [step]: true }, error: null }));
    try {
      return await call();
    } catch (err) {
      if (isCurrent()) set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    } finally {
      set(s => ({ loading: { ...s.loading, [step]: false } }));
    }
  }
  // Runs a call for the current ignition; returns null (ignored) if the epoch moved meanwhile.
  // FE-09: like runCurrent, but a successful reply is always returned with `current` saying whether
  // the screen may still use it. Its session's saved copy takes it either way (review FE09-001):
  // a new Ignite or Reset moves the epoch, but session 1's late /results still belongs to session 1.
  async function runArchived<T>(step: Step, call: () => Promise<T>): Promise<{ res: T | null; current: boolean }> {
    const sent = epoch;
    const res = await run(step, call, () => epoch === sent);
    return { res, current: epoch === sent };
  }
  async function runCurrent<T>(step: Step, call: () => Promise<T>): Promise<T | null> {
    const sent = epoch;
    const res = await run(step, call, () => epoch === sent);
    return epoch === sent ? res : null;
  }
  // Scenario calls act on the live session only; a past session on screen is read-only.
  const scenarioId = () => (get().viewing === null ? get().simulate?.scenario_id ?? null : null);
  const viewingLive = () => get().viewing === null;
  const updateSession = (id: number | null, patch: (session: Session) => Partial<Session>) => {
    if (id === null) return;
    set(s => ({ sessions: s.sessions.map(x => (x.id === id ? { ...x, ...patch(x) } : x)) }));
  };
  // What the screen shows for a session at one of its steps (0 = ignition).
  const shown = (session: Session, step: number) => ({
    simulate: session.history[step],
    history: session.history.slice(0, step + 1),
    detect: session.detect,
    suppress: session.suppress,
    results: session.results,
    phase: step === session.history.length - 1 ? session.phase : replayPhase(session, step),
  });
  // Replay: after the ignition (and the alarm, if it tripped), each applied action follows.
  let replayTimers: ReturnType<typeof setTimeout>[] = [];
  const clearReplay = () => {
    replayTimers.forEach(clearTimeout);
    replayTimers = [];
  };
  const scheduleReplay = (session: Session) => {
    clearReplay();
    let at = (alarmAfterS(session.detect) ?? 0) * 1000 + REPLAY_STEP_MS;
    for (let step = 1; step < session.history.length; step++, at += REPLAY_STEP_MS) {
      const k = step;
      replayTimers.push(setTimeout(() => {
        if (get().viewing === session.id) set(shown(session, k));
      }, at));
    }
  };

  // FE-06 alarm: one timer per /detect result, owned by the store (not a component), so it survives
  // views mounting and unmounting. It fires at time_to_detect_s on the 10x demo clock, counted from
  // ignitedAt, and only if the same ignition is still current.
  let alarmTimer: ReturnType<typeof setTimeout> | null = null;
  const clearAlarm = () => {
    if (alarmTimer !== null) clearTimeout(alarmTimer);
    alarmTimer = null;
  };
  const scheduleAlarm = (detect: DetectOut) => {
    clearAlarm();
    const at = alarmAfterS(detect);
    const id = detect.detector_id;
    if (at == null || !id) return;
    const { ignitedAt } = get();
    const scheduledIn = epoch;
    const elapsed = ignitedAt == null ? 0 : (Date.now() - ignitedAt) / 1000;
    alarmTimer = setTimeout(() => {
      alarmTimer = null;
      if (epoch === scheduledIn) set({ alarmId: id });
    }, Math.max(0, at - elapsed) * 1000);
  };
  const needScenario = () => {
    set({ error: "Ignite a scenario first." });
    return null;
  };

  return {
    ...initialScenario,
    inputs: loadSavedInputs(), // the setup from the last visit, if this browser saved one

    setInputs: patch => {
      set(s => {
        const inputs = { ...s.inputs, ...patch };
        const at = Date.now();
        const changes = TRACKED_INPUTS.filter(key => patch[key] !== undefined && !Object.is(s.inputs[key], inputs[key]));
        const timeline = changes.map(key => ({
          at, variable: INPUT_LABELS[key], action: inputs[key] == null || inputs[key] === "" ? "removed" as const : "modified" as const,
          from: inputValue(key, s.inputs[key]), value: inputs[key] == null || inputs[key] === "" ? null : inputValue(key, inputs[key]),
          context: "Control panel",
        }));
        return { inputs, timeline: [...s.timeline, ...timeline] };
      });
      saveInputs(get().inputs); // the user's own setup: kept for the next page load
    },
    clearError: () => set({ error: null }),

    loadMeta: async () => {
      const meta = await run("meta", api.meta);
      if (!meta) return;
      set(s => ({
        meta,
        // Pick the first material when none is chosen yet, or when the saved one is no longer listed
        // (e.g. renamed in the data), so Ignite works straight away.
        inputs: meta.materials.some(m => m.name === s.inputs.material) || !meta.materials.length
          ? s.inputs : { ...s.inputs, material: meta.materials[0].name },
      }));
    },

    runSimulate: async () => {
      const resetsAtSend = resets;
      const inputs = get().inputs;
      const previousInputs = get().simulate?.inputs ?? null;
      const usedAt = Date.now();
      const res = await run("simulate", () => api.simulate(inputs), () => resets === resetsAtSend);
      if (!res || resets !== resetsAtSend) return null; // Reset while in flight: drop the late reply
      saveInputs(inputs); // Ignite on a replayed session's values makes them the setup to keep
      // A new scenario: earlier detection, actions and results no longer apply.
      epoch++;
      clearAlarm();
      const recordedAt = Date.now();
      set(s => ({
        simulate: res, detect: null, suppress: null, results: null, history: [res], ignitions: s.ignitions + 1,
        timeline: [
          ...s.timeline,
          ...(previousInputs ? recordInputs(previousInputs, "removed", "Previous scenario replaced by Ignite", usedAt) : []),
          ...recordInputs(inputs, "used", "Ignite", usedAt),
        ],
        ignitedAt: recordedAt, alarmId: null,
        phase: nextPhase(s.phase, { type: "simulated", state: res.state }),
        viewing: null, liveSession: s.sessionCount + 1, sessionCount: s.sessionCount + 1,
        sessions: [...s.sessions, {
          id: s.sessionCount + 1, startedAt: recordedAt, inputs, history: [res], detect: null, suppress: null,
          results: null, phase: nextPhase("idle", { type: "simulated", state: res.state }), curve: null,
          events: [{ kind: "simulate", at: recordedAt, result: res }],
        }],
      }));
      clearReplay();
      return res;
    },

    runDetect: async () => {
      if (!viewingLive()) return null; // a saved session is read-only: nothing to do, no error
      const id = scenarioId();
      if (!id) return needScenario();
      const sid = get().liveSession;
      const { res, current } = await runArchived("detect", () => api.detect(id));
      if (res) {
        const recordedAt = Date.now();
        updateSession(sid, x => ({
          detect: res, phase: nextPhase(x.phase, { type: "detected", detected: res.detected }),
          events: [...(x.events ?? []), { kind: "detect", at: recordedAt, result: res }],
        }));
        if (current && viewingLive()) {
          set(s => ({ detect: res, alarmId: null, phase: nextPhase(s.phase, { type: "detected", detected: res.detected }) }));
          scheduleAlarm(res);
        }
      }
      return current ? res : null;
    },

    runSuppress: async () => {
      if (!viewingLive()) return null; // a saved session is read-only: nothing to do, no error
      const id = scenarioId();
      if (!id) return needScenario();
      const sent = epoch;
      const sid = get().liveSession;
      const rankedInputs = get().simulate!.inputs;
      // Save the ranking inside the call, before run() clears loading.suppress. Saving it after
      // left a moment of "alarm, no ranking, not loading", and SuppressionPanel's auto-rank effect
      // then sent a second /suppress for the same alarm.
      const { res, current } = await runArchived("suppress", async () => {
        const ranking = await api.suppress(id);
        const recordedAt = Date.now();
        updateSession(sid, x => ({
          suppress: ranking, phase: nextPhase(x.phase, { type: "suppress_ranked" }),
          events: [...(x.events ?? []), { kind: "suppress", at: recordedAt, inputs: rankedInputs, result: ranking }],
        }));
        if (epoch === sent && viewingLive()) {
          set(s => ({ suppress: ranking, phase: nextPhase(s.phase, { type: "suppress_ranked" }) }));
        }
        return ranking;
      });
      return current ? res : null;
    },

    runApply: async action => {
      if (!viewingLive()) return null; // a saved session is read-only: nothing to do, no error
      const id = scenarioId();
      if (!id) return needScenario();
      const previousInputs = get().simulate?.inputs ?? null;
      const sid = get().liveSession;
      const { res, current } = await runArchived("apply", () => api.apply(id, action));
      if (res) {
        const recordedAt = Date.now();
        updateSession(sid, x => ({
          history: [...x.history, res], phase: nextPhase(x.phase, { type: "applied", state: res.state }),
          events: [...(x.events ?? []), { kind: "apply", at: recordedAt, action, result: res }],
        }));
      }
      if (res && current && viewingLive()) {
        set(s => ({
          // The controls take the applied settings (e.g. fans off + CO2: flow 0, O2 15 %), so they
          // match the recorded scenario and the live 3D preview doesn't treat the action as an edit.
          simulate: res, history: [...s.history, res], inputs: res.inputs,
          timeline: [
            ...s.timeline,
            ...(previousInputs ? TRACKED_INPUTS.filter(key => !Object.is(previousInputs[key], res.inputs[key])).map(key => ({
              at: Date.now(), variable: INPUT_LABELS[key], action: "modified" as const,
              from: inputValue(key, previousInputs[key]), value: inputValue(key, res.inputs[key]), context: `Apply ${action}`,
            })) : []),
            ...recordInputs(res.inputs, "used", `Apply ${action}`),
          ],
          phase: nextPhase(s.phase, { type: "applied", state: res.state }),
        }));
      }
      return current ? res : null;
    },

    loadResults: async () => {
      if (!viewingLive()) return null; // a saved session is read-only: nothing to do, no error
      const id = scenarioId();
      if (!id) return needScenario();
      const sid = get().liveSession;
      const { res, current } = await runArchived("results", () => api.results(id));
      if (res) {
        updateSession(sid, () => ({ results: res }));
        if (current && viewingLive()) set({ results: res });
      }
      return current ? res : null;
    },

    ask: async message => {
      const res = await run("chat", () => api.chat(message, scenarioId() ?? undefined));
      if (res) set(s => ({ chat: [...s.chat, { question: message, reply: res }] }));
      return res;
    },

    ignite: async () => {
      const sim = await get().runSimulate();
      if (sim?.state === "burning") await get().runDetect();
    },

    // Keeps the chosen inputs and the loaded /meta, so the user can rerun the loop at once.
    // ignitions and sessionCount keep counting, so the next Ignite after a Reset is always a new
    // ignition and a new session number.
    reset: () => {
      const activeInputs = get().simulate?.inputs ?? null;
      epoch++; // in-flight scenario replies are now stale
      resets++;
      clearAlarm();
      clearReplay();
      set(s => ({
        ...initialScenario, inputs: s.inputs, meta: s.meta, chat: s.chat, ignitions: s.ignitions,
        sessionCount: s.sessionCount, sessions: s.sessions, liveSession: null, viewing: null,
        timeline: [...s.timeline, ...(activeInputs ? recordInputs(activeInputs, "removed", "Scenario reset; removed from active run", Date.now()) : [])],
      }));
    },

    viewSession: id => {
      const session = get().sessions.find(x => x.id === id);
      if (!session) return;
      if (id === get().liveSession) return get().viewLive();
      clearReplay();
      clearAlarm();
      // A fresh visual ignition replays it from the start; the controls take its values.
      set(s => ({
        viewing: id, inputs: session.inputs, ...shown(session, 0),
        ignitions: s.ignitions + 1, ignitedAt: Date.now(), alarmId: null,
      }));
      if (session.detect) scheduleAlarm(session.detect);
      scheduleReplay(session);
    },

    viewLive: () => {
      if (get().viewing === null) return;
      clearReplay();
      clearAlarm();
      const live = get().sessions.find(x => x.id === get().liveSession);
      if (!live) {
        set(s => ({ ...initialScenario, inputs: s.inputs, meta: s.meta, chat: s.chat, timeline: s.timeline,
          ignitions: s.ignitions, sessionCount: s.sessionCount, sessions: s.sessions, liveSession: null, viewing: null }));
        return;
      }
      const last = live.history.length - 1;
      // Back to the live fire as it is now: its own ignition time, so the alarm and smoke catch up.
      set(s => ({
        viewing: null, inputs: live.history[last].inputs, ...shown(live, last),
        ignitions: s.ignitions + 1, ignitedAt: live.startedAt, alarmId: null,
      }));
      if (live.detect) scheduleAlarm(live.detect);
    },

    clearHistory: () => {
      if (get().viewing !== null) get().viewLive();
      set(s => ({ sessions: s.sessions.filter(x => x.id === s.liveSession) }));
    },

    setSessionCurve: (id, curve) => updateSession(id, () => ({ curve })),
  };
});
