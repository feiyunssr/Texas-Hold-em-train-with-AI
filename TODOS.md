# TODOs

## Open

### 2026-05-04: Execute GGpoker-style table enhancement plan

- **Plan:** [GGpoker 对标牌局增强开发计划](docs/plan/ggpoker-style-feature-development-plan-2026-05-04.md)
- **Remaining scope:** Hero preflop strategy automation, opponent strategy, HUD, PokerCraft-style history, Rush/Fast-Fold training, and advanced training loops.
- **Next milestone:** M8 Hero preflop strategy automation MVP.

## Completed

### 2026-05-04: Resolve M7 display pot review findings

- **Result:** Live snapshots no longer derive side pots from unequal in-progress commitments, and fold settlements now show the awarded winner and per-pot share on every settled display pot.
- **Closed by:** Changed `displayPots` to show a single live main pot until the poker engine has settled real pots, and expanded fold total-pot awards across settled contribution-level pots in [`src/server/training-runtime`](src/server/training-runtime).
- **Validation:** `npm test -- src/server/training-runtime/index.test.ts`, `npm run typecheck`, and targeted Prettier check.

### 2026-05-04: Complete M7 table information density and action UX

- **Result:** Runtime snapshots and the live training table now expose and render table pressure, action history, display pots, seat commitments, recent actions, and richer bet sizing controls.
- **Closed by:** Added `toCall`, `minRaiseTo`, `maxBetAmount`, `effectiveStack`, `lastAction`, `streetActionSummary`, `displayPots`, and per-seat `lastAction` to [`src/server/training-runtime`](src/server/training-runtime), updated [`src/components/training-entry.tsx`](src/components/training-entry.tsx) and [`src/components/training-entry.css`](src/components/training-entry.css), and advanced the training milestone marker to M7.
- **Validation:** `npm run typecheck`, `npm test -- src/server/training-runtime/index.test.ts`, `npm run lint`, and targeted Prettier write.

### 2026-05-04: Fix auto-continue default and scheduling

- **Result:** Auto-continue starts enabled by default and advances to the next hand after a completed hand without requiring the manual "start next hand" button.
- **Closed by:** Kept the continue toggle enabled on initial render and new table creation, and moved the auto-continue hand de-duplication marker into the delayed execution path so React effect cleanup does not cancel the only scheduled advance.
- **Validation:** Targeted Prettier check, `npm run typecheck`, and `npm run lint`.

### 2026-05-04: Resolve continuous training review findings

- **Result:** Ended training snapshots no longer expose stale legal actions after the user quits mid-hand, and generated Next.js type reference drift was removed.
- **Closed by:** Suppressed legal action exposure whenever a runtime session is `training_ended`, added regression coverage for quitting while Hero is facing a decision, and restored `next-env.d.ts` to the production build route type import.
- **Validation:** `npm test -- src/server/training-runtime/index.test.ts` and targeted Prettier check.

### 2026-05-04: Add continuous training controls and end conditions

- **Result:** Training tables can continue across hands, pause after a completed hand, auto-continue when enabled, and end only when the player exits or Hero is eliminated.
- **Closed by:** Added `training_ended` runtime snapshots, Hero elimination detection, `POST /api/training/tables/:tableId/quit`, UI continue/exit controls, and documentation for the continuous training behavior.
- **Validation:** `npm run typecheck`, `npm test -- src/server/training-runtime/index.test.ts`, `npm test`, `npm run lint`, targeted Prettier check, `npm run build`, `curl http://localhost:3001/health`, and `POST /api/training/tables/:tableId/quit` smoke test on port 3001.

### 2026-05-04: Place player state around the poker table

- **Result:** Player state tokens now render around the felt table at their visual seat positions instead of as a top rail above the table.
- **Closed by:** Moved seat tokens into the table surface in [`src/components/training-entry.tsx`](src/components/training-entry.tsx), added Hero-relative ring positioning, and updated [`src/components/training-entry.css`](src/components/training-entry.css) for desktop and mobile compressed table layouts.
- **Validation:** `npm run typecheck`, `npm run lint`, `npx prettier --check src/components/training-entry.tsx src/components/training-entry.css`, `npm run build`, and `curl http://localhost:3000/health`.

### 2026-05-04: Fix LAN dev origin blocking client interactivity

- **Result:** Buttons are no longer blocked when the dev server is opened through the advertised network URL `http://192.168.1.242:3000`.
- **Closed by:** Added `192.168.1.242` to Next.js `allowedDevOrigins` in [`next.config.ts`](next.config.ts) and documented the LAN run note in [`README.md`](README.md).
- **Validation:** Restarted `npm run dev`, confirmed `/health` and `POST /api/training/tables` still work on port 3000, confirmed the previous Next.js "Blocked cross-origin request to Next.js dev resource" log no longer appears, and ran `npm run typecheck`, `npm run lint`, and `npm run build`.

### 2026-05-04: Verify current runtime readiness

- **Result:** Project can build and start the Next.js dev server at `http://localhost:3000`, and the in-memory training table flow is reachable.
- **Validation:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `curl http://localhost:3000/health`, homepage HTTP smoke check, and `POST /api/training/tables` smoke check.
- **Runtime note:** Full history, replay, review, and charged AI persistence paths are not fully runnable in the current shell because no local `.env` exists and `DATABASE_URL` is unset; `GET /api/training/history` returns `DATABASE_URL must be set before creating PrismaClient.`

### 2026-04-29: Complete M6 review, history, and replay foundation

- **Result:** Completed in [`src/server/hand-review`](src/server/hand-review), [`src/ai/hand-review.ts`](src/ai/hand-review.ts), [`src/app/api/training/history`](src/app/api/training/history), [`src/app/api/training/tables/[tableId]/review`](src/app/api/training/tables/[tableId]/review), and [`src/components/training-entry.tsx`](src/components/training-entry.tsx).
- **Closed by:** Added completed-hand `review-view`, charged hand review artifact persistence, runtime hand event persistence for review, history list filters, single-hand replay with AI artifact/tag context, and UI entry points for hand review plus history replay.
- **Validation:** `npm run typecheck`, `npm run format:write`, `npm test`, `npm run lint`, and `npm run build`.

### 2026-04-29: Resolve M5 UI review findings

- **Result:** Completed in [`src/components/training-entry.tsx`](src/components/training-entry.tsx).
- **Closed by:** Disabled and guarded side-rail AI coach requests while an action submission is in flight, and changed initial SSE subscription handling so the first hand replays public events into the action summary without storing the synthetic runtime snapshot.
- **Validation:** `npm run typecheck`, `npm test -- src/app/api/training/tables/[tableId]/events/route.test.ts src/server/training-runtime/index.test.ts`, `npm run lint`, `npx prettier --check src/components/training-entry.tsx`, `npm test`, and `npm run build`.

### 2026-04-29: Complete M5 v1 UI main flow

- **Result:** Completed in [`src/components/training-entry.tsx`](src/components/training-entry.tsx), [`src/components/training-entry.css`](src/components/training-entry.css), and [`src/domain/training/index.ts`](src/domain/training/index.ts).
- **Closed by:** Replaced the placeholder entry with a live training table UI for table creation, public table state, legal-action controls, bet sizing, AI coach request states, hand summary, next-hand entry, and mobile 12-seat compression.
- **Validation:** `npm run typecheck`, `npm run format:write`, `npm run lint`, `npm test`, `npm run build`, `/health` curl check, and homepage M5 HTML smoke check.
- **Note:** Automated browser screenshots were not run because gstack browse requires one-time setup in this environment; an existing Next dev server on port 3000 served the updated M5 page for HTTP smoke validation.

### 2026-04-28: Resolve M4 coach API review findings

- **Result:** Completed in [`src/app/api/training/tables/[tableId]/coach`](src/app/api/training/tables/[tableId]/coach), [`src/server/hero-coach`](src/server/hero-coach), [`src/ai/hero-coach.ts`](src/ai/hero-coach.ts), and [`src/server/training-runtime`](src/server/training-runtime).
- **Closed by:** Persisted runtime table/seat/hand rows before Prisma coach artifacts, released decision locks when no artifact was saved, normalized duplicate `requestId` advice replay shape, and validated suggested amounts against the matching legal action.
- **Validation:** `npm test -- src/server/hero-coach/index.test.ts src/ai/hero-coach.test.ts` and `npm run typecheck`.

### 2026-04-28: Complete M4 action-time AI coach advice

- **Result:** Completed in [`src/server/hero-coach`](src/server/hero-coach), [`src/ai/hero-coach.ts`](src/ai/hero-coach.ts), [`src/server/training-runtime`](src/server/training-runtime), and [`src/app/api/training/tables/[tableId]/coach`](src/app/api/training/tables/[tableId]/coach).
- **Closed by:** Added `hero-coach-view`, stable `decisionPointId`, decision-point request locking, provider adapter orchestration, timeout/retry handling, structured schema validation, one-formal-request enforcement, partial output handling, failed-not-charged persistence, and saved-charged wallet ledger linkage.
- **Validation:** `npm test -- src/server/hero-coach/index.test.ts src/server/training-runtime/index.test.ts`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run format`, and `npm run build`.

### 2026-04-28: Resolve M3 runtime API review findings

- **Result:** Completed in [`src/server/training-runtime`](src/server/training-runtime) and [`src/app/api/training/tables/[tableId]/events`](src/app/api/training/tables/[tableId]/events).
- **Closed by:** Replaced enumerable training table IDs with non-guessable crypto-random route identifiers and made SSE replay honor the browser `Last-Event-ID` reconnect header before falling back to `?after=`.
- **Validation:** `npm test -- src/server/training-runtime/index.test.ts src/app/api/training/tables/[tableId]/events/route.test.ts`, `npm run typecheck`, `npm run lint`, and `npm run format`.

### 2026-04-28: Complete M3 single-table training runtime

- **Result:** Completed in [`src/server/training-runtime`](src/server/training-runtime), [`src/app/api/training/tables`](src/app/api/training/tables), and [`next.config.ts`](next.config.ts).
- **Closed by:** Added in-memory training table sessions, 4/6/9/12-seat creation, user action validation against rule-engine legal actions, bot-only visible state, deterministic mock bot strategy, public snapshots, SSE event streaming, and next-hand preparation.
- **Validation:** `npm test -- src/server/training-runtime/index.test.ts`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, and `npm run build`.
- **Note:** `poker-evaluator` is marked in `serverExternalPackages` so its `HandRanks.dat` data file loads correctly during Next production builds.

### 2026-04-28: Resolve charged wallet persistence review findings

- **Result:** Completed in [`src/server/persistence/training-assets.ts`](src/server/persistence/training-assets.ts), [`src/server/persistence/prisma-training-assets.ts`](src/server/persistence/prisma-training-assets.ts), and [`src/server/persistence/types.ts`](src/server/persistence/types.ts).
- **Closed by:** Replaced read/absolute-write wallet debits with a conditional atomic decrement, made concurrent `request_id` retries re-read and return the committed charged artifact, and rejected non-positive or fractional charge amounts before persistence.
- **Validation:** `npm test -- src/server/persistence/training-assets.test.ts`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run format`.

### 2026-04-28: Complete M2 training assets and persistence

- **Result:** Completed in [`prisma/schema.prisma`](prisma/schema.prisma), [`src/server/persistence/training-assets.ts`](src/server/persistence/training-assets.ts), and [`src/server/persistence/prisma-training-assets.ts`](src/server/persistence/prisma-training-assets.ts).
- **Closed by:** Added PostgreSQL Prisma models, initial migration, demo seed data, event/snapshot/artifact/wallet persistence services, read model queries, request idempotency, and transaction-backed AI artifact plus wallet ledger charging.
- **Validation:** `npm run db:generate`, `npm run db:format`, `DATABASE_URL='postgresql://user:pass@localhost:5432/texas_holdem_train?schema=public' npx prisma validate`, `npm test`, `DATABASE_URL='postgresql://user:pass@localhost:5432/texas_holdem_train?schema=public' npm run typecheck`, `npm run lint`, `npm run format`, and `npm run build`.
- **Note:** `npm run db:migrate` was not run because no local PostgreSQL instance is configured in this environment. `npm audit --audit-level=moderate` currently fails on a Prisma 7.8.0 dev dependency advisory; the offered force fix downgrades Prisma to 6.19.3, so it was not applied.

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
