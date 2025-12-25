# requirements.md
# Requirements — Structured Questions + Generation Chat → Facts → Current State → Items → Canonical Items (End-to-End)

## 0) Current situation and what is already implemented
Already implemented:
- **Structured Questions screen** per stage (ideation / planning / solutioning):
  - Up to 5 questions per turn.
  - Each question has its own UI slot.
  - Answer controls: Yes / No / I don’t know / Irrelevant + free-text.
- **Generation chat** per stage:
  - Normal chat window for idea generation / planning content / solutioning advice.

Not implemented (this document covers):
1) **Facts extraction** pipeline that runs **once per turn** (one GPT-5-mini call) and stores evidence-anchored facts.
2) **Smart updater** for “current state” that does not rewrite whole text; it only patches stable blocks.
3) **Persistent Project Items** materialized from accepted facts + manual overrides, with cross-scope consistency.
4) **Canonical items** linking and price-memory integration.
5) **Item-level blocks** and a unified “truth store” so changes in project chat reflect in item chat and vice versa.
6) Observability, idempotency, backfill, and failure recovery.

## 1) Goals (what success looks like)
### 1.1 Truthfulness & traceability
- Every structured field stored (facts, item fields, constraints) must be **traceable to evidence**:
  - exact quote + start/end character offsets in an immutable turn bundle.
- No silent overwriting of truth:
  - conflicting facts are stored and surfaced; user resolves them.

### 1.2 One parser call per turn
- Facts extraction uses **exactly one** LLM call (GPT-5-mini) per turn.
- The parser reads the **entire turn bundle** once; no per-question or per-field LLM calls.

### 1.3 No “rewrite entire current knowledge”
- The updater must not rewrite the entire project knowledge each turn.
- Updates are done by patching stable knowledge blocks (add/replace/remove small parts).

### 1.4 Cross-scope consistency
- If the user changes item info at project level, the item-level state updates automatically.
- If the user edits item info at item level, project-level summary updates automatically.

### 1.5 Items drive the app
- The persistent **Item entity** is the main entity for planning, tasks, accounting, quote generation.
- Materialization from facts must be:
  - faithful, conservative, reviewable,
  - and avoid “AI inventing structured data”.

## 2) Core concepts and definitions
### 2.1 Turn
A “turn” is a user interaction cycle that ends with either:
- Structured Q submission, and/or
- Free chat message submission, and/or
- A generation response that completes.

A turn is the unit for:
- creating a TurnBundle,
- running exactly one fact-parser job,
- applying patches to current state.

### 2.2 TurnBundle (immutable)
A single text blob created per turn, containing:
- Turn metadata (stage, scope, selected items),
- Structured questions and answers (if present),
- User free chat (if present),
- Agent output generated in that turn (if present).

Stored immutably so evidence offsets are stable forever.

### 2.3 Fact
An atomic statement stored with:
- scope (project or item),
- key (canonical path),
- typed value,
- evidence (quote + offsets into TurnBundle),
- provenance (run id, confidence),
- status (proposed / accepted / rejected / conflict).

### 2.4 Current State / Knowledge Blocks
“Current state” is not one big text.
It is a set of stable blocks with deterministic structure (JSON + derived markdown), for example:
- Project blocks: summary, constraints, decisions, openQuestions, timeline, budget.
- Item blocks: summary, dimensions, materials, logistics, constraints, decisions, openQuestions, tasks-intent.

### 2.5 Item entity vs Canonical item
- **Project Item**: a real entity inside this project (Backdrop, Floor, Transport, Installation Day).
- **Canonical item**: normalized catalog item for pricing memory (“Dibond 3mm per sqm”, “Vinyl print per sqm”).

Project Items can reference canonical items via their material/work lines.

## 3) User flows & UX requirements

### 3.1 Structured clarification flow (existing UI + new backend)
**Flow**
1) User enters stage (ideation/planning/solutioning).
2) Agent proposes up to 5 questions.
3) User answers quickly + optional free text.
4) User clicks “Submit”.
5) System performs:
   - create TurnBundle
   - run fact parser once
   - patch current state blocks
   - update item projections
6) Agent generates the next questions.

**Requirements**
- The user never needs to scroll up in the chat to answer questions.
- After submission, user sees:
  - Updated “Current State” panel (project + relevant items)
  - A “Facts extracted” indicator (counts + conflicts/needs-review)

### 3.2 Free chat mode (existing UI + new behavior)
**Flow**
- User asks: “what do you know?” / “change backdrop to 6m” / “add instruction: no drilling”.

**Requirements**
- Free chat also creates a TurnBundle and triggers one parser run.
- Free chat can update:
  - project facts
  - item facts (if item is referenced or selected)
- Must support an “Inspect” mode:
  - show current facts, current blocks, and “what changed last turn”.

### 3.3 Switching scope: project vs item vs multi-item
**Requirements**
- At any moment, user can set scope to:
  - Project level
  - Single item level
  - Multi-item selection
- All turns include scope metadata so extraction and updates are applied correctly.

### 3.4 Switching stage: ideation vs planning vs solutioning
**Requirements**
- User can switch stages any time.
- Facts store is stage-agnostic, but:
  - block rendering and question-generation logic are stage-specific.
- Optional: unified single screen with stage toggle (recommended), but stage still affects:
  - which blocks are prominent,
  - which keys are considered high-risk,
  - which question templates are used.

## 4) Facts extraction requirements (one call per turn)

### 4.1 Trigger policy
- Trigger once when a turn is complete:
  - Structured Q submitted OR free chat submitted OR generation completed.
- If structured Q + generation occur in the same UI turn, bundle them into one TurnBundle and still run once.

### 4.2 Parser behavior (GPT-5-mini)
- The parser returns **FactOps**, not “rewritten knowledge”.
- It must:
  - extract only supported facts with evidence quotes + offsets,
  - mark ambiguous content as NOTE,
  - treat agent output as “proposed” unless user confirmed.

### 4.3 Evidence rules (hard)
- Every structured fact must include:
  - exact quote (substring of TurnBundle)
  - startChar/endChar offsets that match exactly.
- Backend must verify offsets and quote.
- If verification fails, the fact cannot be auto-accepted.

### 4.4 Status lifecycle
- proposed → accepted/rejected
- accepted + incompatible accepted value arrives → conflict
- conflict requires user resolution (or explicit “keep both” if allowed).

### 4.5 Auto-accept policy
Auto-accept only if all are true:
- evidence verified
- confidence above threshold
- not high-risk key
- quote originates from USER sections (structured answers or free chat), not agent output
Otherwise: proposed + needsReview.

### 4.6 Key whitelist / ontology
Facts keys must be controlled; no random keys.
Minimum categories:
- project.summary.*
- project.constraints.*
- project.logistics.*
- project.timeline.*
- project.budget.*
- item.summary.*
- item.dimensions.*
- item.materials.*
- item.production.*
- item.installation.*
- item.logistics.*
- item.constraints.*
- item.decisions.*
- item.openQuestions.*

High-risk keys (always needsReview unless explicit confirmation):
- any budget/cost/price
- dates/deadlines
- safety constraints
- client approvals/decisions

## 5) Smart updater requirements (no whole-text rewrites)

### 5.1 Block-based state
- System must store current state as stable blocks:
  - One row per (projectId, scopeType, itemId?, blockKey)
- Block content is structured JSON with a derived markdown view.

### 5.2 Patch semantics
Updates must be minimal:
- set a field value
- append a bullet
- remove a bullet
- mark an open question resolved
- add a decision with provenance
No rewriting entire narrative paragraphs.

### 5.3 Deterministic rendering
- The markdown view is rendered from JSON.
- This prevents “LLM paraphrasing” from losing info.

## 6) Item entity requirements

### 6.1 Materialization
- Item fields are computed from:
  1) manual overrides
  2) accepted facts
  3) defaults/empty
- The system must expose “why this field has this value”:
  - show active fact + evidence.

### 6.2 Manual edits and overrides
- Users can manually edit item fields.
- Manual edits must not destroy history; they are stored as manualOverrides.
- Optionally: manual edit creates a new fact with evidence “manual input” (no quote offsets, but allowed as special evidence type).

### 6.3 Item hierarchy & blocks
- Items are hierarchical.
- Each item has its own blocks (summary, dimensions, materials, etc.).

## 7) Canonical items integration requirements

### 7.1 Linking
- Each material/work line can optionally link to:
  - canonicalItemId
- System provides suggestions using normalization map and history.
- User can accept/override.

### 7.2 Price memory
- When canonicalItemId exists, UI shows:
  - recent price observations
  - vendor history
  - suggested range
- This must not mutate facts; it enriches planning/accounting.

## 8) Cross-scope consistency requirements

### 8.1 Unified truth store
- Facts + blocks + items are truth.
- Chats are views.

### 8.2 Item referencing from project chat
- Must support reliable item targeting:
  - recommended: @item mention picker
  - fallback: name matching
- Without item targeting, facts should default to project scope or be flagged needsReview.

## 9) Observability & operational requirements
- Track parse runs (queued/running/succeeded/failed) with stats per run.
- Provide UI surface for:
  - last parse status
  - errors
  - retry button
- Rate limit parsing similarly to existing agent calls.
- Backfill tool for existing projects (creates synthetic bundles, marks facts proposed first).

## 10) Acceptance criteria (end-to-end)
1) After each structured Q submission, exactly one parser run occurs and facts appear with evidence.
2) Current state updates by block patches only (no full rewrite events).
3) Accepted facts update item projections, visible in item view immediately.
4) Project-level edits to an item update item-level view; item-level edits update project-level summary.
5) Agent suggestions become “proposed” until confirmed.
6) Conflicts are visible and resolvable.
7) Canonical linking works and drives price memory UI.
