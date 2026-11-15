# FireTwin

**A fire-safety digital twin of an ISS lab module, built on NASA microgravity combustion data.**
NASA Space Apps 2026 · challenge *Flame in Freefall*

You set the cabin conditions (material, oxygen, airflow, pressure) and ignite a fire. FireTwin
predicts whether the fire keeps burning, when the smoke alarm trips, and which suppression action
to take. Every number comes from a model trained on NASA test results and links back to the tests
it rests on.

> **Honesty rule.** The 3D flame and smoke only illustrate the result. Every verdict comes from
> the model trained on NASA [Physical Sciences Informatics (PSI)](https://psi.nasa.gov/) data.
> Inputs outside the tested range are flagged "no direct NASA data", and any synthetic row
> shows a *synthetic* badge.

---

## What it does

1. **Simulate.** It predicts *P(fire keeps burning)* for your inputs, with a trust level
   (strong / medium / weak) and the 3 nearest NASA tests as evidence.
2. **Detect.** In microgravity smoke doesn't rise; it drifts with the airflow. FireTwin
   estimates which vent detector trips, and when.
3. **Suppress.** It scores each action (fans off, CO2, fans off + CO2, cut power, water mist)
   by re-running the model on the changed conditions, then recommends the best action that
   NASA data supports.
4. **Apply.** It applies the action and predicts again ("extinguished, 13%").
5. **Review.** A dashboard shows every session, a burn-probability-versus-O2 chart with the
   nearest tests, a PDF export, and a chat that answers from the NASA reports with citations.

Example: a PMMA rod at 21% O2 and 10 cm/s airflow is predicted to burn at 96% with medium trust.
The alarm trips at the forward vent after about 40 s, and turning the fans off is recommended.
After fans off the prediction drops to 13% (extinguished). The catch is that with no airflow,
smoke no longer reaches the detectors.

## How it works

```
NASA PSI tables ─► data/pipeline ─► data/processed/tests.parquet ─┐
NASA reports    ─► ml/ingest_rag ─► Chroma store (optional)  ─────┤
                                                                  ▼
                 ml/train.py ─► ml/artifacts/ (model, ranges, metrics, trust calibration)
                                                                  │
React app ──REST──► FastAPI routers ──► services ──► ml/pipeline  ▼
(3D twin,           (thin)              predictor, detector, suppressor,
 dashboard,                             rag (LLM + grounding), cache, store, pdf
 chat)
```

The design principle is that **tools compute and the LLM only writes words**:

- All numbers come from deterministic Python: the model, trust check, detector and planner.
- The LLM (Gemini by default) writes the explanations, the chat answers and, in the agent
  pipeline, the report summary.
- Every LLM answer is checked by `ml/pipeline/grounding.py`. If it contains a number, test ID
  or investigation name that wasn't in its input, the answer is discarded and a template
  sentence is used instead.
- With no API key, everything still works offline.

### The model

- **Per-fuel logistic regressions** with physics-shaped features:
  - **Solid fuels:** O2, `ln(u + 0.5)` and `ln(u + 0.5)²`. The squared term captures the
    U-shaped microgravity boundary: flames die at low airflow (no oxygen supply) *and* at high
    airflow (blow-off).
  - **Droplet fuels:** O2 and pressure.
  - Each material with at least 8 tests gets its own term.
  - A pooled model covers unknown fuel types.
- **Skill check.** A fuel model counts only if, in cross-validation, it beats always guessing
  the majority outcome: AUC ≥ 0.65 and at least 2% lower log loss.
- **Trust.** Weak if an input is outside the tested range or the fuel model shows no skill.
  Otherwise, trust depends on how many same-fuel tests with known outcomes lie within
  distances measured by `ml/calibrate_trust.py`. "Strong" is given only if, at some distance,
  a vote of 3 nearby tests predicted the outcome correctly at least 90% of the time. With the
  current data no distance qualifies, so trust is at most "medium".
- **Labels.** Every outcome label cites the table cell it came from
  (`data/pipeline/label_outcomes.csv`).
  - Labels read from gas sensors are marked **INFERRED**.
  - Extinction airspeeds that had to be filled in are marked **IMPUTED**.

Current training data: **349 labelled tests** from BASS-II, FLEX, Saffire-I and Saffire-II.
Both fuel models pass the skill check:

| Fuel | Tests | AUC (stratified CV) | Accuracy | Majority-guess accuracy |
|---|---|---|---|---|
| solid | 136 | 0.82 | 0.88 | 0.81 |
| droplet | 213 | 0.78 | 0.88 | 0.87 |

The full metrics are in `ml/artifacts/metrics.json`, and the data audit in
`docs/data_quality.md`.

### The multi-agent pipeline (Python only)

`ml/agents/team.py` runs four agents in order: **Experiment Analyst**, **Suppression
Strategist**, **Safety & Evidence Critic** (if it rejects the plan, the Strategist tries again,
up to 2 times) and **Report Writer**.

- Each agent can call only its own tools from `ml/pipeline/tools.py`, and every call is logged.
- The approval decision comes from the `critique` tool's rule checks, never from the LLM.
- Without a key, or on any error, it falls back to the deterministic pipeline.
- `ml/pipeline/fire_sim.py` adds a time-based simulation: flame growth, gradual action effects,
  and smoke puffs tripping a detector.

Neither the agents nor `fire_sim` is exposed through the API yet.

## Quick start

Requirements: Python 3.11, [uv](https://docs.astral.sh/uv/), Node 22 with npm, `make`, and
optionally Docker.
On Windows, use **Docker Desktop or WSL**; native `make dev` stops early (see
`docs/OPS_NOTES.md`).

```bash
make setup          # uv sync + npm ci
make data           # NASA tables -> data/processed/tests.parquet (already committed)
make train          # -> ml/artifacts/ (already committed)
cp .env.example .env   # optional: add GEMINI_API_KEY, set MOCK_MODE=0 for real predictions
make dev            # backend :8000, frontend :5173
```

Or with Docker:

```bash
docker compose up --build    # frontend http://localhost:5173, API http://localhost:8000
```

See `docker/README.md` for hosting (Render backend + Vercel frontend with an `/api` rewrite).

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MOCK_MODE` | `1` | `1` = fixed synthetic responses (no data needed); `0` = real model |
| `GEMINI_API_KEY` | empty | Enables LLM explanations, chat and agents. Takes precedence over OpenAI. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model ID |
| `GEMINI_REASONING_EFFORT` | `medium` | Gemini thinking level (thinking tokens are billed as output); empty = the model's default |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | empty / `gpt-4o-mini` | Alternative provider |
| `CORS_ORIGINS` | localhost:5173 | Allowed browser origins (full `https://` origins) |
| `VITE_API_URL` | `http://localhost:8000` | API base URL for the frontend |

Check that your key works: `uv run python -m ml.agents.llm`. Never commit `.env`.

## API

Source of truth: `backend/app/schemas.py`, documented in `docs/contract.md`.

| Endpoint | What it does |
|---|---|
| `GET /meta` | Materials, input ranges, investigations |
| `POST /simulate` | Ignite a scenario: probability, trust, nearest tests, explanation |
| `POST /preview` | The same verdict without creating a scenario (live sliders, O2 chart) |
| `POST /detect` | Which detector trips, and when |
| `POST /suppress` | Ranked suppression actions plus a recommendation |
| `POST /apply` | Apply one action and predict again |
| `GET /results/{id}` | The scenario's step history |
| `GET /export/{id}.pdf` | PDF report |
| `POST /chat` | Answers from the NASA reports, with citations |
| `GET /health` | Liveness check |

Scenarios and the prediction cache are kept in memory: they're lost when the server restarts.

## Repository layout

```
data/psi_tables/     raw NASA PSI tables (committed)
data/pipeline/       cleaners, outcome labels, table builder, data-quality report
data/processed/      tests.parquet, investigations.json, data_quality.json
data/docs/           NASA report text used by RAG
ml/pipeline/         model, physics features, detector, planner/critic, tools, grounding, fire_sim
ml/agents/           shared LLM client and the multi-agent orchestrator
ml/prompts/          versioned prompts
ml/artifacts/        trained model, ranges, metrics, trust calibration
backend/app/         FastAPI app: routers (thin), services, mocks, schemas
frontend/src/        React + Vite + TS: 3D scene (React Three Fiber), Zustand store, dashboard
docker/              Dockerfiles, Compose notes, hosting guide
docs/                plan summary, contract, changelog, decisions, data card, ops notes
tests/               repo-wide, Docker/CI and end-to-end checks
```

## Testing

```bash
make test    # pytest: data, ml, backend, repo-wide
make lint    # ruff check + ruff format --check
make e2e     # full demo loop against a running real-mode API
cd frontend && npm test
```

## Known limitations

- **Small data.** Only 4 investigations have both conditions and outcomes. Pressure never
  varies for solids, and airflow never varies for droplets.
- **Doesn't transfer between investigations.** When a whole investigation is held out, the
  model does much worse than it does within one investigation (see `metrics.json`).
- **Placeholder numbers.** Crew-risk values, detector geometry, smoke diffusion and
  `fire_sim` time constants are engineering placeholders, not NASA measurements.
- **No data behind some actions.** Water mist and cut power have no PSI test data, so they
  are always ranked last.
- **No spread-rate model.** Only 2 tests report a spread rate, so spread is not predicted.

## Team

Nergis (data labels, model, AI layer, core services) · Ryan (backend shell, RAG plumbing, ops,
CI) · Nathan (frontend, data download and cleaning, docs).

The project plan is summarized in `docs/plan/SUMMARY.md`; decisions beyond the plan are in
`docs/OPS_NOTES.md` and `docs/DECISIONS.md`.
