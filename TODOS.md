# TODOs

## Open

No open documentation TODOs.

## Completed

### 2026-04-27: Fix M1 NLHE rule review findings

- **Result:** Completed in [`src/domain/poker/index.ts`](src/domain/poker/index.ts) with regression coverage in [`src/domain/poker/index.test.ts`](src/domain/poker/index.test.ts).
- **Closed by:** Auto-runout now waits until the only covering player has completed the current betting round, incomplete all-in raises no longer reopen raising to prior actors, and straddled hands use the straddle size as the preflop minimum raise increment.
- **Validation:** `npm test`, `npm run typecheck`, `npm run lint`, and `npm run format`.

### 2026-04-27: Complete M1 NLHE rule engine

- **Result:** Completed in [`src/domain/poker/index.ts`](src/domain/poker/index.ts) with coverage in [`src/domain/poker/index.test.ts`](src/domain/poker/index.test.ts).
- **Closed by:** Implemented a pure TypeScript NLHE cash-game state machine for 4-12 players, deterministic dealing, legal actions, action rotation, street advancement, append-only events, all-in runouts, showdown evaluation via `poker-evaluator`, and main/side pot awards.
- **Validation:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, and `npm audit --audit-level=moderate`.

### 2026-04-27: Resolve training milestone type review finding

- **Result:** Completed in [`src/domain/training/index.ts`](src/domain/training/index.ts).
- **Closed by:** Extended `TrainingMilestone` to include the documented M6 review/history/replay phase and M7 QA/release-readiness phase while keeping `CURRENT_TRAINING_MILESTONE` at M0.
- **Validation:** `npm run typecheck` and `npm test`.

### 2026-04-27: Complete M0 engineering skeleton

- **Result:** Completed in the Next.js + TypeScript project skeleton rooted at [`src/`](src/) with scripts in [`package.json`](package.json).
- **Closed by:** Added npm lockfile, App Router entry, health route, AI coach env config reader, domain/server/AI/component/style boundaries, independent `src/domain/poker` Vitest harness and README runbook.
- **Validation:** `npm run typecheck`, `npm test`, `npm run lint`, `npm run format`, `npm audit --audit-level=moderate`, `/health` curl check and homepage content check all passed.

### 2026-04-27: Resolve execution plan review findings before implementation

- **Result:** Completed in [`docs/plan/development-execution-plan-2026-04-27.md`](docs/plan/development-execution-plan-2026-04-27.md).
- **Closed by:** Integrated rule-engine-first sequencing, `SSE + POST` realtime transport, AI artifact + wallet transaction boundaries, one-request failure semantics, minimal user/wallet model, AI provider testability, partial-output billing policy and M0 README update requirements into the standalone execution plan.

### 2026-04-27: Create Codex-oriented development execution plan

- **Result:** Completed in [`docs/plan/development-execution-plan-2026-04-27.md`](docs/plan/development-execution-plan-2026-04-27.md).
- **Closed by:** Converted the PRD, design system and engineering reviews into milestone-based implementation work for Codex, including task boundaries, validation gates, AI visibility rules, billing invariants and QA requirements.
- **Related cleanup:** README plan links now point to the `docs/plan/` location and include the new execution plan.

### 2026-04-24: Create `DESIGN.md` before UI implementation

- **Result:** Completed in [`DESIGN.md`](DESIGN.md).
- **Closed by:** Formal design system now defines visual direction, color tokens, type scale, spacing, components, card treatment, seat states, action controls, AI coach panel, history rows, tags, state copy and error states.
- **Review:** Confirmed in [`docs/plan-design-review-followup-2026-04-24.md`](docs/plan-design-review-followup-2026-04-24.md).

### 2026-04-24: Prototype and verify mobile layout for 12-person tables

- **Result:** Converted from open design debt into an accepted v1 mobile prototype specification in [`DESIGN.md`](DESIGN.md) and [`docs/PRD.md`](docs/PRD.md).
- **Closed by:** Locked viewport targets, mobile information order, compressed seat rules, AI coach bottom sheet behavior and minimum acceptance criteria.
- **Remaining implementation check:** Once a runnable frontend exists, visual QA must verify the 12-person mobile table at `360 x 740`, `390 x 844` and `430 x 932`.
