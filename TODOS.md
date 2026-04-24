# TODOs

## Design Debt

### 1. Create `DESIGN.md` before UI implementation

- **What:** Define the formal visual system for the poker training UI, including color tokens, type scale, spacing, components, card treatment, seat states, action controls, AI coach panel, history rows, tags and error states.
- **Why:** The PRD now contains temporary design constraints, but implementation still needs a stable source of truth so the table, coach panel, history list and replay views feel like one product.
- **Pros:** Reduces visual drift, speeds frontend implementation, makes QA objective and gives later design reviews concrete standards.
- **Cons:** Requires one focused design pass before UI coding; premature over-detail could slow the first prototype if it tries to solve every future screen.
- **Context:** The 2026-04-24 design review found no existing `DESIGN.md`, no frontend components and no visual tokens. The PRD now says formal UI implementation should not rely only on ad hoc choices.
- **Depends on / blocked by:** Product owner should accept the training-tool visual direction from `docs/PRD.md`.

### 2. Prototype and verify mobile layout for 12-person tables

- **What:** Build a low-fidelity or clickable prototype for the densest mobile case: 12 seats, user decision point, public cards, pot, current action, legal actions and AI coach bottom sheet.
- **Why:** A 12-person poker table cannot be safely designed by scaling desktop layout down to a phone screen.
- **Pros:** Catches cramped controls, unreadable chip counts, hidden action buttons and coach-panel overlap before production implementation.
- **Cons:** Adds a small prototype step before frontend build; may force simplifying mobile seat detail.
- **Context:** The design review set a v1 default of compressing non-critical seats on mobile while preserving the user seat, public cards, current actor and action controls. That assumption needs validation.
- **Depends on / blocked by:** Basic UI wireframe or component scaffold for the training table.
