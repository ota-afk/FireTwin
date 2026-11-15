# Changelog

One entry per task. API contract changes (rule 3) must always be noted here.

## 2026-11-15

- **OPS-02**: `frontend/vercel.json` forwards `/api/*` to the Render backend
  (`https://firetwin.onrender.com`), so the deployed frontend reaches the API same-origin, with
  no CORS setting. No API contract change.

- **OPS-02**: copy the tracked `data/processed/`, `data/docs/` and `ml/artifacts/` files into the
  backend image, so it runs real mode on a Docker host (Render) with no bind mounts. Compose
  mounts are unchanged and still take precedence. No API contract change.

- **OPS-02**: prepare and SHA-256-verify local MiniLM/index bundles, with an optional
  read-only Compose mount and non-root writable index copy. Runtime local queries need
  no weight download; default/missing-bundle keyword fallback remains. Document preparation,
  cache reuse, integrity errors, recreation, generation cleanup and no-network verification.

- **OPS-01**: ignore prepared local RAG bundles and temporary bundle builds; guard the
  generated paths while leaving model artifacts and processed demo inputs publishable.

- **ML-08**: publish complete isolated index generations with an atomic current pointer;
  preserve the previous index on failed rebuilds. Validate completion/count/provider/model
  and default/custom corpus provenance. Use one ONNX identity for build/query, explicit
  providers (local by default), configurable model caches and cache-only local queries.
  Expected resource failures return keyword fallback with a bounded warning; add real
  Chroma failure/custom-corpus/production-EF regressions. Bundle integration follows below.
- **OPS-01 documentation reconciliation**: distinguish current implementation from dated
  integration records; repair stale results, vent, retrieval and mount descriptions. Add
  `docs/DECISIONS.md` with owners, pending scope/contract choices and a proposed validation
  matrix; publish the Ryan handoff plan with merged PR #26/#27 status. No API or runtime
  behavior changes, contract approval claims or generated-type changes.

- **OPS-02**: narrow read-only backend data mounts to processed metadata/table and cited
  text corpus, retaining model artifacts. Document real/mock/automatic startup commands,
  precedence and missing-file/directory behavior; add real Compose rendering checks.
- **BE-05**: announce the captured effective API mode on startup for native and Docker
  runs, with lifecycle tests confirming default/explicit modes and no key disclosure.
- **OPS-01**: untrack private root plan PDFs and raw investigation uploads after preserving
  local copies; ignore their paths and staging folders. Add index/ignore/large-blob guards
  while retaining processed demo data, NASA text corpus and committed model artifacts.
  Historical commits and remote branches are unchanged; cleanup limits are in OPS_NOTES.

- **OPS-01**: refuse native Windows dev startup before launching partial stacks;
  retain POSIX supervision and document Docker Desktop/WSL as supported Windows routes.
- **OPS-02**: refuse native Windows entrypoint execution; test exact dispatch, PID,
  signal and exit-status preservation on POSIX. Bound readiness waiting in the signal test.
- **OPS-03**: add Windows Python 3.11 startup checks without Make, retaining current
  required check names. Native Windows startup tests passed with the locked Python 3.11 CI environment.

- **OPS-01**: documentation follow-up. Record that `demo-v1` exists on `8f281d9` (the next
  release is `demo-v2`), the open owner decision about private PDFs in that tag, and the
  verified package 4 findings; put the Windows notes in date order. Docs only.

## 2026-11-14

- **OPS-01**: repo structure (one folder per layer, `.gitkeep` in empty folders), `Makefile`
  (`setup`, `data`, `train`, `dev`, `test`, `lint`; each skips with a message while its layer is
  empty), `.env.example`, `.gitignore`, `pyproject.toml` + `uv.lock` (Python 3.11, ruff, pytest,
  httpx), `tests/test_repo_structure.py`, and a placeholder `docker-compose.yml` (filled in by OPS-02).
  Also `CLAUDE.md` + an identical `AGENTS.md` (agent rules), `docs/plan/SUMMARY.md`, and
  `docs/OPS_NOTES.md` (decisions beyond the plan, for whoever owns OPS next).
  Review fixes: shared exclusion for private plan PDFs; `scripts/dev.py` supervises server process
  groups, propagates failures, and waits for bounded shutdown; `tests/test_dev.py` checks failures,
  signals, and descendant cleanup using local stand-ins. Second review round: `make dev` skips
  without calling uv, a deliberate second Ctrl+C force-stops (uv's echoed copy is ignored), `.env`
  reaching only the backend is tested, and the dev tests skip on non-POSIX systems. Reasons and
  lifecycle choices are recorded in `docs/OPS_NOTES.md`.
- **BE-05** (API contract added): `backend/app/schemas.py` with every model from the plan's
  "Shared API contract", field for field. Also added named models for the request/response bodies
  the plan's endpoint table writes inline: `ScenarioRef` `{scenario_id}` (/detect, /suppress),
  `ApplyIn` `{scenario_id, action}`, `ChatIn` `{message, scenario_id?}`, `HealthOut` `{status}`,
  plus the alias `ActionName` for the five actions. `TestRef.__test__ = False` only stops pytest
  mistaking it for a test class; the JSON schema is unchanged. FastAPI app with CORS for the Vite dev
  server (`backend/app/main.py`, `config.py`) and `GET /health`. Frontend types: nothing to
  regenerate yet (FE-01 not started).
  Review fixes (no API contract changes): validate configured CORS origins before app construction;
  make root data/ML packages importable under pytest, with `tests/test_python_imports.py` as a guard;
  expand contract tests to cover types, required nullable fields, defaults, enums, and vector shape.
  Second review round: CORS errors name the bad entry and reject host names browsers never send;
  ruff `src` includes the repo root; import rule (`app...`, never `backend.app...`) in OPS_NOTES.
- **BE-06**: `MOCK_MODE` configuration (default `1`, strict `0`/`1` flag) and conditional mock-router
  mounting. Every planned endpoint returns fixed, explicitly synthetic fixtures from
  `backend/app/mocks/`, including all five suppression actions, a fixed results table, chat
  citations, and a valid static PDF. Existing request validation and the shared contract remain
  unchanged; OpenAPI now exposes all request/response schemas. Added mock/config acceptance tests,
  frontend handoff notes in `backend/app/mocks/README.md`, and decisions in `docs/OPS_NOTES.md`.
  With `MOCK_MODE=0`, health remains available and mock feature routes are absent pending real tasks.
  Review fixes: `/results` mock rows match the BE-01 store shape (plan's 8 keys, numbered steps);
  keys of all free-form dict fields documented in `docs/contract.md`; `/health` defined once in
  `main.py`. No change to `schemas.py`.
- **OPS-03**: GitHub Actions CI (`.github/workflows/ci.yml`) on every pull request and every push
  to `main`. Job "Python (ruff + pytest)": `uv sync --locked --dev`, `make lint`, `make test`.
  Job "Frontend (tsc + vitest + build)": `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
  `tests/test_ci_workflow.py` fails if a planned check is removed from the workflow.
- **FE-04** (contract change, rule 3): `frontend/src/scene/` ISS module scene: the glTF from
  `/models/iss_lab-transformed.glb` loads in `Suspense`, with the coded 8.5 m × 4.2 m module as the
  fallback (also used when the file is missing), plus OrbitControls and detector markers at the
  `DetectOut.detectors` positions. `docs/contract.md` gains a "3D coordinate system" section shared
  by the frontend and BE-03:
  - **Axes:** origin at the module centre, `+x` = fore (the default `flow_dir`), `+y` = overhead,
    `+z` = port.
  - **Fire:** always at `(0, 0, 0)`.
  - **Vents:** BE-03's detector positions moved onto the overhead rack face (y = 1.37), so the
    markers are visible. They are `vent_fwd` `[4.0, 1.37, 0]`, `vent_aft` `[-4.0, 1.37, 0]` and
    `vent_mid` `[0, 1.37, 0]`; with `+x` = fore, the two end names swap.

  **Pending (Nergis, BE-03):** `ml/pipeline/config.py` must be updated to these positions and
  names. No change to `schemas.py`, so no frontend types to regenerate. The frontend's
  `src/lab/config.js` now matches the contract, and the old Concepts prototype is removed.
- **OPS-05**: `tests/test_demo_build.py` keeps the demo artifacts committed, non-empty and loadable,
  and checks a real prediction works with no API keys. `docs/OPS_NOTES.md` has the `demo-v1`
  tagging steps (#14 and #16 are merged; not tagged yet).
- **BE-07**: `GET /meta` from real data. `backend/app/services/meta.py` builds materials (with
  `n_tests`) from the unified table, ranges from the `"overall"` section of `feature_ranges.json`
  (the predictor's own file), and investigations from `investigations.json` once DAT-06 exists.
  `backend/app/routers/meta.py` is a thin router; missing data gives 503. Keys documented in
  `docs/contract.md`. No change to `schemas.py`. The router is not mounted in `main.py` yet.
- **BE-06 (integration)**: `main.py` mounts the real routers when `MOCK_MODE=0` (`/simulate`,
  `/apply`, `/meta`); mock mode is unchanged. `backend/tests/test_app_wiring.py` checks both modes.
- **BE-05 follow-up (Nergis's request)**: `Settings` gains `openai_api_key` (`None` when unset or
  blank; hidden from `repr`) and `openai_model` (default `gpt-4o-mini`, env `OPENAI_MODEL`), so
  `rag.py` can read them through `get_settings()` instead of `os.getenv`. `rag.py` itself unchanged.
- **BE-06 follow-up**: mock `/results` rows now match Nergis's real store exactly (`step` names,
  `sources` as `test_id` strings); a test feeds each mock row through `store.append()` and requires
  identical JSON. Open rule 5 question (badging id-only sources) recorded in `docs/contract.md`.
- **OPS-01 fix**: `make dev` could not start the real backend (`No module named 'ml'`):
  `--app-dir backend` exposes only `backend/`, but `/simulate` and `/meta` import `ml.pipeline`
  from the repo root. `scripts/dev.py` now puts the repo root first on the backend's
  `PYTHONPATH` (Docker already sets `/app/backend:/app`). Found by starting the real server.
- **OPS-01 follow-up**: pytest ignores Starlette's "use httpx2" deprecation warning (that exact
  message and class only), so `make test` reports no warnings. The plan's httpx stays.

- **BE-08**: `GET /results/{scenario_id}` serves `store.history(scenario_id)` through `ResultsOut`
  and maps Nergis's `ScenarioNotFound` to 404. Rebased onto `origin/feature/BE-integration`
  (PR #9) and mounted only in the real-mode `else:` branch. Updated built/unbuilt route lists,
  added results and app-wiring regressions, and documented the endpoint. Mock rows already match
  the real store; no schema, store, frontend or OPS-02 changes.

- **BE-09**: real-mode `GET /export/{scenario_id}.pdf` and ReportLab service render the same saved
  history as `/results`, with timestamp, inputs, all eight table columns, an explicitly export-time
  recommended action, source URLs/synthetic labels and the plan's honesty line. Unknown scenarios
  return 404; missing model/source data is labeled without losing saved rows. Added PDF content,
  history-parity, pagination, error and mode-isolation tests; updated wiring and contract notes.
  Mock export and shared schemas remain unchanged; ReportLab was already a runtime dependency.
- **BE-03 router (gap fix)**: `POST /detect` (`backend/app/routers/detect.py`), mounted in real mode.
  Runs the detector service at the scenario's current inputs and appends the `"detect"` history row
  (`detection_s`, plus the current verdict's source ids). Unknown scenario -> 404. No task in the
  plan created this router; OPS-04's e2e loop stopped here.
- **BE-04 router (gap fix)**: `POST /suppress` (`backend/app/routers/suppress.py`), mounted in real
  mode. Runs the suppressor service at the scenario's current inputs; adds no history row (ranking
  changes nothing). Unknown scenario -> 404.
- **Real mode, end to end**: `feature/BE-real-mode` combines the real-mode wiring, `/detect`,
  `/suppress`, `/results` (BE-08) and `/export` (BE-09) on top of `main`. A real-mode server
  (`MOCK_MODE=0`, no API keys) passes OPS-04's `make e2e` in all 8 steps.
- **OPS-04**: `tests/e2e_loop.py` walks health -> meta -> simulate -> detect -> suppress -> apply ->
  results -> export against a running API, checks each response against `schemas.py` and the links
  between steps, and stops at the first failing step (`make e2e`, `E2E_BASE_URL` for another server).
  Refuses a mock-mode API unless `--allow-mock`. `tests/test_e2e_loop.py` runs the same loop
  in-process against the mock app, so CI keeps the checks themselves tested.

- **BE-10**: real-mode `POST /chat` delegates to the existing `rag.answer()` and passes a detached
  snapshot of current inputs/history when `scenario_id` is supplied. Unknown IDs return 404;
  unexpected service errors return a generic 500. Chat leaves scenario state unchanged and keeps
  the service's citations/offline fallback. Added endpoint and real/mock wiring tests and contract
  notes. No shared schema, frontend, RAG/store service, prompt or dependency changes.

- **BE-11**: bounded in-memory prediction/explanation cache keyed by all normalized inputs and
  runtime LLM mode/model settings, with 60-second expiry, LRU eviction, concurrent miss sharing,
  deep-copy isolation and explicit clearing. With the user's ownership exception, `simulate.py`
  delegates predict/explain to the cache while preserving fresh scenario IDs and every history
  write. Added service/concurrency and endpoint regressions. Shared schemas, Nergis's services,
  ML/data/frontend files and dependencies are unchanged.

- **BE-10 / BE-11 integration**: resolved PR #19 against current main, retaining all real routers,
  Gemini/OpenAI support and upstream work. Chat and the input cache join the existing real-mode
  loop; removed obsolete unbuilt-route checks now that all planned endpoints are implemented.
- **OPS-02**: two-service Docker Compose stack (backend 8000, Vite frontend 5173) with locked
  image dependencies, health-based startup, non-root services, init/signal handling and read-only
  data/artifact mounts. Added root-owned Dockerfiles, a secret/cache-safe build context, automatic
  synthetic mock fallback when required files are missing, startup regression tests and
  `docker/README.md`. Optional host-port overrides keep browser API URL/CORS aligned. The native
  API contract and mode parsing remain unchanged; container settings need no `.env` or API key.
- **BE-12**: `backend/tests/test_endpoints.py` tests every endpoint over HTTP in mock and real mode
  (status + `schemas.py` shape, PDF for export), fails if a mode serves a route the matrix doesn't
  list, checks unknown scenarios give 404 in real mode, and checks `fans_off` ranks above
  `water_mist` through `/suppress` on the default data. All 9 endpoints, both modes.
  Fix: `backend/tests/conftest.py` now also clears `OPENAI_API_KEY`, so a key in a developer's
  shell can no longer make real, billed API calls during tests (a guard test proves it).
- **Contract text (rule 3), `SuppressOut.actions` order**: documented as the suppressor actually
  ranks: data-backed actions by score, then no-data actions, `water_mist` last; `recommended` is the
  first data-backed action. Replaces "sorted by score", which real NASA data showed was wrong
  (`cut_power` can outscore data-backed actions). Comment-only change in `schemas.py`; no shape
  change, so no frontend type regeneration. The remaining duplicate BE-07 heading is
  removed by the documentation follow-up above.
- **OPS-04 follow-up**: `tests/e2e_loop.py` uses a burning real scenario by default (Heptane, 30 % O2,
  fans off; override with `--material/--o2/--flow`), fails if `/simulate` doesn't burn, and checks
  the documented suppress order. Three new tests in `tests/test_e2e_loop.py`. Real-mode `make e2e`
  passes on the real NASA data with 0 synthetic sources.
