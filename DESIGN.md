# Design System

## Purpose

This document is the source of truth for the v1 UI of the AI Texas Hold'em training platform. It replaces the temporary design constraints in the PRD and should be used before implementing table, coach, history, replay, billing-state and mobile layouts.

The product is a training tool, not a casino skin, solver dashboard or generic AI chat product. The interface must help the user understand the current poker decision, request one structured AI coach suggestion when useful, act, and preserve the hand as a learning asset.

## Product Feel

- Focused: the table, current action and legal choices are always more important than decoration.
- Calm: the UI should reduce pressure during decisions rather than add visual noise.
- Precise: chip counts, legal actions, point-charge states and AI request states must be explicit.
- Training-oriented: AI output is framed as guidance and diagnosis, not entertainment or absolute truth.
- Dense but legible: poker tables carry many facts, so hierarchy, grouping and compression matter more than large marketing-style surfaces.

Do not use a marketing hero, casino neon, decorative gradients, generic dashboard card grids, or a chat window as the core product shape.

## Visual Direction

The main table may use a deep felt color, but the whole product must not become one-note green. Operational surfaces such as action controls, coach output, history, replay and billing states use neutral panels with clear semantic accents.

Recommended color tokens:

| Token | Value | Usage |
| --- | --- | --- |
| `color.table.felt` | `#0F5132` | Primary table surface |
| `color.table.rail` | `#17382B` | Table edge, seat ring, active-seat contrast |
| `color.surface.base` | `#F7F8F6` | App background outside the table |
| `color.surface.panel` | `#FFFFFF` | Coach panel, action tray, lists |
| `color.surface.subtle` | `#EEF1ED` | Secondary rows, inactive controls |
| `color.text.primary` | `#17201B` | Main text on light surfaces |
| `color.text.secondary` | `#5C675F` | Secondary facts and helper text |
| `color.text.inverse` | `#F8FAF7` | Text on table surfaces |
| `color.border.default` | `#D7DDD5` | Panel and row borders |
| `color.action.primary` | `#D97706` | Main legal action such as Bet/Raise/Call |
| `color.action.primaryHover` | `#B45309` | Hover or pressed state |
| `color.coach.accent` | `#2563EB` | AI coach markers, not primary action buttons |
| `color.success` | `#15803D` | Saved, charged, complete |
| `color.warning` | `#B45309` | Partial result, timeout warning |
| `color.danger` | `#B91C1C` | Fold/destructive action and failures |
| `color.info` | `#2563EB` | System and coach information |

Accessibility requirements:

- Body text and key numbers must meet WCAG AA contrast.
- Cards must not rely on red/black color alone; always show suit symbols or text.
- AI coach accent must not compete with the primary legal action.
- Point-charge states must use text plus color or icon treatment.

## Typography

Use system UI fonts by default:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
font-variant-numeric: tabular-nums;
```

Type scale:

| Token | Size / Line | Usage |
| --- | --- | --- |
| `text.xs` | `12 / 16` | Tags, seat metadata, audit details |
| `text.sm` | `14 / 20` | Secondary UI text, history rows |
| `text.md` | `16 / 24` | Default body and controls |
| `text.lg` | `18 / 28` | Panel headings, hand summary |
| `text.xl` | `22 / 30` | Main screen title or active decision summary |
| `text.number` | `16 / 20` | Chips, pot and bet values with tabular numbers |

Do not scale typography by viewport width. On compact surfaces, reduce content before shrinking text below `12px`.

## Spacing, Radius and Elevation

Use a 4px spacing base.

| Token | Value | Usage |
| --- | --- | --- |
| `space.1` | `4px` | Tight gaps inside labels |
| `space.2` | `8px` | Button icon gaps, compact row spacing |
| `space.3` | `12px` | Seat internals, tag groups |
| `space.4` | `16px` | Panel padding, action tray groups |
| `space.6` | `24px` | Screen section rhythm |
| `space.8` | `32px` | Desktop layout gutters |

Radius:

- Controls, list rows and repeated cards: `6px`.
- Panels and bottom sheets: `8px`.
- Poker table oval or racetrack: shape follows table geometry, not generic card radius.

Elevation should be restrained:

- Use borders and contrast first.
- Use shadow only for overlays, bottom sheets and active floating action trays.
- Do not put UI cards inside other cards.

## Layout System

Desktop:

- Main surface uses a two-zone layout: table area plus right-side coach/action rail.
- The table stays visually centered and must not be squeezed by history or debug panels.
- History action log may be a collapsible side panel or secondary rail.
- User action controls stay close to the user seat and are also reachable from the right rail when a coach panel is open.

Tablet:

- Preserve the full table.
- Use a bottom or side drawer for AI coach output.
- Action controls remain fixed near the lower edge or user seat.

Mobile:

- Do not scale the desktop table down.
- Prioritize user seat, public cards, pot, current actor, legal actions and the coach bottom sheet.
- Compress non-critical seats to small status tokens.
- Detailed seat information opens on demand.

## Poker Table Components

### Table Center

Required facts:

- Public cards
- Main pot and side pots
- Latest effective bet
- Current street
- Current actor

The center area must remain readable while the AI coach panel is loading, open or failed.

### Seat

Each seat has these states:

- Empty or inactive
- Waiting
- Thinking
- Current actor
- Folded
- All-in
- Showdown
- Winner
- User seat

Seat content:

- Avatar or initials
- Stack
- Current street contribution
- Status
- AI style tag for AI seats
- Dealer, blind, ante and straddle markers when relevant

User seat treatment:

- Stronger border and clearer stack/action facts than other seats.
- Never obscures community cards or action controls.
- Shows hero cards only for the user.

Compressed mobile seat treatment:

- Avatar or initials
- Stack abbreviation
- State dot or short label
- Current actor ring when active
- Tap target at least `44px`

## Action Controls

Only current legal actions appear as primary controls. Do not show disabled main action buttons for illegal actions.

Required controls at a user decision point:

- Fold when legal
- Check or Call when legal
- Bet or Raise when legal
- Request AI Coach when the decision point has not used its single formal request

Bet sizing must support:

- Slider for broad adjustment
- Quick sizes such as `1/3 pot`, `1/2 pot`, `2/3 pot`, `pot`, `all-in` when legal
- Exact numeric input

States:

- Idle
- Submitting user action
- Waiting for AI opponent
- Coach request in progress, decision point frozen
- Coach success, decision point still awaiting user action
- Coach failed or timed out, not charged, user can continue
- Decision point already used its single formal coach request

Touch targets must be at least `44px`. The action tray must not be covered by coach output on mobile.

## AI Coach Panel

The panel title must include `AI 教练视角`.

The AI coach is not a chat surface in v1. It is a structured recommendation panel tied to one decision snapshot.

Successful result order:

1. Main recommended action
2. Suggested sizing
3. Acceptable alternative action
4. Up to 3 key factors
5. Risk or uncertainty note
6. Save and point-charge state

Panel states:

- Available: explains that one formal request is available for the current decision point.
- Loading: decision point is frozen, one request is in progress, no duplicate trigger.
- Success saved and charged: show recommendation plus saved/charged confirmation.
- Success pending persistence: show result cautiously and do not mark charged until saved.
- Partial result: show available fields, mark incomplete, do not imply full confidence.
- Timeout, model error, network error, parse error or storage error: state that no points were charged and the user can continue.
- Already requested: show the prior result or failure state; do not offer a second formal request for the same decision point.

Forbidden wording:

- `正确答案`
- `最佳答案`
- `solver 标准答案`
- Any claim that implies the AI output is definitive.

Preferred wording:

- `AI 教练视角`
- `主推荐`
- `可接受替代`
- `关键判断因素`
- `本次建议未完成，未扣点`
- `建议已保存，点数已扣除`

## History, Replay and Tags

History list rows show:

- Time
- Table size
- Hero position
- Result
- Whether real-time coach advice exists
- Whether full review exists
- Key tags or problem types

Filters:

- Table size
- Position
- Street
- Result
- Tag
- Problem type
- Opponent style

Replay:

- Street-based timeline is the primary structure.
- Coach artifacts and tags attach to the exact decision point they came from.
- Request snapshots and billing references are audit details, not first-layer display.

Tags:

- Product-maintained problem types use stable vocabulary.
- User tags are visually distinct from AI-generated problem types.
- Keep tag labels short and scan-friendly.

## State Copy Rules

State copy must explain the user impact, not the internal mechanism.

Examples:

| State | Copy pattern |
| --- | --- |
| Coach loading | `AI 教练正在分析，本决策点暂时冻结` |
| Coach timeout | `本次建议未完成，未扣点。你可以继续行动` |
| Coach storage failure | `建议未保存，未扣点。你可以继续行动` |
| Coach success | `建议已保存，点数已扣除` |
| Point shortage | `点数不足，无法请求本次 AI 建议` |
| Hand saved | `本手牌已保存，可在历史中复盘` |
| Empty history | `完成第一手训练后，这里会沉淀复盘和问题标签` |

Do not use vague AI SaaS wording such as `智能洞察生成中` when the product can state the exact operation.

## 12-Seat Mobile Table Specification

This is the accepted v1 mobile prototype specification for the densest supported case: 12 seats, user decision point, public cards, pot, current actor, legal actions and AI coach bottom sheet.

Target viewports:

- Narrow mobile: `360 x 740`
- Standard mobile: `390 x 844`
- Large mobile: `430 x 932`

Default vertical order:

1. Top status bar: hand id or street, pot, current actor
2. Opponent rail: compressed non-critical seats in two rows or a horizontally scrollable strip
3. Table center: public cards, latest bet, side-pot indicator
4. User zone: hero cards, hero stack, position, current decision pressure
5. Action tray: legal actions, bet sizing controls, coach request
6. AI coach bottom sheet: collapsed by default, opens over secondary content, not over primary action buttons

Compression rules:

- Current actor, button/blinds, all-in seats and winner seats receive expanded labels.
- Folded non-current seats collapse to avatar, stack abbreviation and state dot.
- AI style tags are hidden in the default compressed view and available in seat details.
- Chip values may abbreviate on seats but must be exact in pot, call amount and bet input.
- The user seat is always expanded.

Coach bottom sheet:

- Collapsed height shows availability or result headline.
- Half-open height shows main recommendation, sizing and charge state.
- Full-open height shows alternative action, key factors and risk note.
- Action buttons remain visible or immediately reachable while the sheet is half-open.

Minimum acceptance:

- Every interactive target is at least `44px`.
- The user can identify pot, call amount, public cards and current actor without opening another view.
- The user can act without closing a successful coach result.
- Failure states clearly show `未扣点`.
- The bottom sheet never hides the only visible legal action controls.
- A screen reader can announce the current actor, coach status and legal actions in a stable order.

## Implementation Guardrails

- Use stable dimensions for cards, seats, buttons and action trays so state changes do not shift the layout.
- Treat point-charge and persistence as first-class UI states.
- Keep debug, audit and raw event details behind secondary affordances.
- Prefer icons plus accessible labels for settings, history, save and filter controls.
- Do not use nested cards for page sections.
- Do not create a landing page as the product entry once a user is inside the app.

## Review Checklist

Before UI implementation is considered ready for visual QA:

- Table, action tray and coach panel use these tokens or documented equivalents.
- All coach request states are implemented.
- The 12-seat mobile layout has been checked at the three target mobile viewports.
- Action controls remain visible with the coach bottom sheet open.
- The history list and replay attach AI outputs to hand context instead of detached cards.
- Copy avoids absolute solver language.
- Contrast, touch targets and keyboard order meet the requirements above.
