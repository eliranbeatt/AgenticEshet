# Agnetic Workflow + Manual Mode (Agent Page) — Copilot Implementation Plan

Date: 2026-01-05

## 0) Source inputs (merged)

This plan merges:

1) Your “Skill Suggestions Bar” plan in `Specs/Agnetic workflow.txt` (Continue + 3–5 suggested skills; click-to-run; ChangeSet compatible; Hebrew agent responses; stable-ish suggestions; disabled-with-reason).
2) Repo reality + “planner insights” (existing Agent page + Convex controller + existing suggested-actions skill + existing right-panel patterns).
3) Your clarifications (Jan 5, 2026):
   - Use the **richer Agent page** only: `studio-console/app/projects/[id]/agent/page.tsx`.
   - **Do NOT delete** the Studio page yet.
   - Remove “agent activity” from the main agent window; it should not occupy main UI real-estate.
   - Move the **Inspector up** to replace that spot; use **Studio page design** (tabs: Overview / Elements / Tasks / Printing / Trello). **No Facts**.
   - Add top-bar toggle: **Manual (default)** and **Agnetic Workflow**.
   - Manual mode: user chats; agent suggests 3–5 skills; Continue continues the **current active skill** as long as the user keeps going.
   - Workflow mode: workflows are not implemented yet; we must plan and build them.
   - Suggestions: **hybrid** approach: heuristics pre-filter by stage/artifact gaps + optional LLM re-ranker.
   - UI labels can stay **English** for now; agent responses still follow Hebrew rule.
   - Keyboard: desktop Enter on empty input triggers Continue; Alt+1..5 triggers suggested skills.
   - Disabled reasons should cover rich prerequisites (approved elements, accounting, printing files, measurements, etc.).

## 1) Big picture goals

### 1.1 Goal
Make the Agent feel “guided and powerful” without autonomy:

- User chats normally.
- After every assistant run (chat or skill), UI offers:
  - Primary: **Continue** (default selected)
  - Alternatives: **3–5 suggested skills** relevant to current stage + context
- Clicking a suggestion runs a single skill (no multi-step autonomy) and returns:
  - Assistant message (Hebrew)
  - Optional artifacts + optional pending ChangeSet
  - Next suggestions
- Continue is meaningful:
  - If active Workflow run: Continue runs the next workflow step
  - Else (Manual): Continue repeats current active skill (or chooses and pins the best next skill if none active)

### 1.2 Non-goals (hard constraints)
- No automatic writing to canonical tables without explicit ChangeSet approval.
- No autonomous multi-step execution without user click.
- No UI lock until approval.
- No Facts panel on Agent page (remove Facts tab/rendering).

### 1.3 Success criteria
- Operator can run the project end-to-end with minimal typing:
  - Start by chatting
  - Click suggestions to produce drafts
  - Apply/discard ChangeSets
  - Continue iterating with draft-as-context
- Suggestions feel stable (not random) and are always present.
- Workflow mode can run a predefined template, step-by-step, with Continue.

---

## 2) Current implementation (repo reality)

### 2.1 Agent UI today
Primary page: `studio-console/app/projects/[id]/agent/page.tsx`

- Has stage/skill/channel pins persisted to `projectWorkspaces`.
- Has a “Continue (Auto)” / “Run Skill” button calling `api.agents.controller.continueRun`.
- Has “Suggested actions” area but it reads `controllerOutput.nextSuggestedActions` and currently this is always empty.
- Has an Inspector tab state: `overview | facts | elements | tasks | printing | trello | raw` and renders `FactsPanel` today.
- Has separate STOP UI sections for questions / suggestions / approval.

### 2.2 Convex controller today
`studio-console/convex/agents/controller.ts`

- Core loop: `runControllerStepLogic` calls `runSkill(skillKey: "controller.autonomousPlanner")`, then handles modes:
  - ask_questions → structured sessions
  - pending_changeset → returns STOP_APPROVAL
  - suggestions → writes `agentSuggestionSets` and returns STOP_SUGGESTIONS
  - run_skill → delegates to another skill and bubbles ChangeSet/suggestions
  - artifacts → updates workspace artifacts

- Public action used by Agent UI: `continueRun`.
- **Known gap**: `continueRun` maps controller result into `controllerOutput` but sets `nextSuggestedActions: []` always.

### 2.3 Right-panel patterns we should reuse
- Studio page contains a simple “ArtifactInspector” implementation:
  - `studio-console/app/projects/[id]/studio/page.tsx` defines `ArtifactInspector` with tabs.
- Flow workbench has a robust right sidebar tab pattern:
  - `studio-console/app/projects/[id]/_components/flow/FlowWorkbench.tsx` shows a right panel with tab strip and scrollable content.

We will reuse Studio’s *tab names + style* for the Agent page inspector, and Flow’s *panel structure* if needed.

### 2.4 Skills support for suggestions
- `ux.suggestedActionsTop3` exists in `studio-console/convex/skills/agentSkills.generated.json` and generated `skillsJson.ts`.
- Specs also define input schema: `stage`, `workspaceSummary`, `candidateSkills`.

We will adapt this to support 3–5 suggestions (either by:
- extending to `ux.suggestedActionsTop5`, or
- using Top3 and filling remaining with heuristic fallback).

---

## 3) Target UX spec (exact)

### 3.1 Single Agent page, two modes
Route: `/projects/[id]/agent` only.

- Top bar includes **Mode toggle**:
  - Manual (default)
  - Agnetic Workflow

### 3.2 Layout changes

**Remove** Agent activity from the main agent window. (We will not render `AgentActivityPanel` on this page.)

Side panel should be Studio-like:
- Inspector tabs: Overview / Elements / Tasks / Printing / Trello
- Suggestions panel: Continue + 3–5 skill chips
- No Facts. No Facts tab.

Where the suggestions appear:
- **In the side panel** (not under each assistant message), so the operator can always see it.

### 3.3 Continue semantics

Manual mode:
- Continue repeats **active skill** (the last skill run via suggestion click or explicit selection).
- If no active skill exists yet (fresh conversation), Continue should pick the best next suggestion and set it as active.

Workflow mode:
- If workflow run active: Continue runs the **next step**.
- If no workflow run active: Continue should be disabled with tooltip: “Start a workflow” (or default to Manual semantics only if you prefer; default: disabled).

### 3.4 Keyboard behavior
Desktop:
- If composer input is empty AND focus is not inside a text field OR the user is in the agent view: Enter triggers Continue.
- Alt+1..Alt+5 triggers alternatives.

Mobile:
- No Enter-to-Continue. Only tap/click.

### 3.5 Disabled suggestions (never hide)
Show disabled chips with a tooltip/reason.

Examples:
- Requires element selection
- Requires at least 1 approved element
- Requires printing files uploaded
- Blocked: missing measurements (run Questions first)
- Requires tasks exist
- Requires accounting lines exist
- Requires quote draft exists

---

## 4) System design (backend + contracts)

### 4.1 Key principle: suggestions are computed *as part of the run*
Non-functional requirement: suggestions render instantly with assistant output (no second request).

Implementation requirement:
- Every “run” action returns a `TurnResponse` containing message + suggestions.

### 4.2 Canonical TurnResponse contract
We will implement and persist this contract (JSON keys English; user-visible labels English for now; assistant message Hebrew):

```ts
type SuggestionIntentTag =
  | "next"
  | "critique"
  | "questions"
  | "visual"
  | "cost"
  | "tasks"
  | "risk"
  | "workflow";

type SuggestionAction = {
  kind: "CONTINUE" | "RUN_SKILL" | "START_WORKFLOW" | "RUN_WORKFLOW_STEP";
  skillKey?: string;
  workflowTemplateId?: string;
  workflowRunId?: string;
  stepId?: string;
  contextMode?: "CANONICAL" | "CANONICAL_PLUS_DRAFT";
};

type Suggestion = {
  id: string; // stable per suggestion, e.g. `continue`, `skill:<skillKey>`, `wf:<templateId>`
  label: string;
  reason?: string;
  intentTag?: SuggestionIntentTag;
  weight: number;
  disabled?: boolean;
  disabledReason?: string;
  action: SuggestionAction;
};

type SuggestionsPayload = {
  primary: Suggestion; // Continue
  alternatives: Suggestion[]; // 3–5
  defaultSelectedId: "continue";
};

type TurnResponse = {
  assistantMessage: string; // Hebrew text
  artifacts?: Record<string, unknown>;
  pendingChangeSet?: { summary?: string } | null;
  suggestions: SuggestionsPayload;
};
```

### 4.3 Suggestion engine (hybrid)

Two-step system (required):

**Step A — deterministic heuristics pre-filter** (fast, reliable, stable)
- Build candidate list from skills registry filtered by:
  - stage (pinned stage or inferred)
  - channel (if relevant)
  - allowed/enabled
- Score candidates using workspace gaps and prereqs.

**Step B — LLM re-ranker** (smart personalization)
- Feed Top ~10–20 candidates to `ux.suggestedActionsTop3` style skill and request 3–5.
- If LLM fails or returns invalid schema: fallback to deterministic top-N.

Stability rules:
- Not random each time.
- Avoid repeating the same alternative 5 turns in a row.
  - Add “cooldown” penalty based on `workspace.artifactsIndex.lastSuggestionsShown`.
- Diversity: not all 5 chips same intent.

### 4.4 Workspace snapshot for suggestions
Compute a `SuggestionContext` by reading canonical project state + UI pins:

- Stage: pinned or inferred
- Active skill (Manual)
- Workflow run state (Workflow)
- Selected element(s)
- Approved elements count
- Tasks exist / counts
- Accounting lines exist / counts
- Quote draft exists
- Printing parts + uploaded files exist
- Pending ChangeSet exists
- “Use draft as context” toggle

---

## 5) Data model / schema changes (Convex)

### 5.1 Extend `projectWorkspaces`
Where: `studio-console/convex/schema.ts` (or wherever `projectWorkspaces` table is defined).

Add fields:
- `agentMode: "manual" | "workflow"` (default: manual)
- `activeSkillKey: string | null` (Manual)
- `draftOverlayEnabled: boolean` (default true)
- `activeWorkflowRunId: Id<"workflowRuns"> | null`
- `lastSuggestionsState` (for cooldown, repetition avoidance)

Suggested structure:

```ts
lastSuggestionsState?: {
  shownSkillKeys: string[]; // recency ordered, e.g. last 10
  shownAt: number; // last computation timestamp
};
```

### 5.2 New workflow tables (Phase 3)

We plan workflows now; implement in Phase 3.

Tables:
- `workflowRuns`:
  - projectId, conversationId
  - templateId
  - status: "active" | "blocked" | "completed" | "abandoned"
  - currentStepIndex
  - createdAt/updatedAt

- `workflowRunSteps`:
  - runId
  - stepId
  - index
  - title
  - kind: "RUN_SKILL"
  - skillKey
  - status: "pending" | "running" | "done" | "blocked"
  - startedAt/finishedAt
  - error?

Templates:
- Start as a TypeScript registry file (no DB table needed initially), e.g.
  - `studio-console/convex/agents/workflows/templates.ts`

---

## 6) API surface (Convex functions)

### 6.1 Existing actions to adapt
`api.agents.controller.continueRun` currently takes pins + conversationId.

We will evolve it into a single “run entrypoint” for both manual and workflow semantics.

### 6.2 New/updated Convex actions and queries

**A) `agents.controller.getWorkspaceState`**
- Extend to return new fields: mode, activeSkillKey, draftOverlayEnabled, activeWorkflowRunId.

**B) `agents.controller.setMode`** (new mutation)
- Input: workspaceId, agentMode

**C) `agents.controller.setActiveSkillKey`** (new mutation)
- Input: workspaceId, activeSkillKey

**D) `agents.controller.toggleDraftOverlay`** (new mutation)
- Input: workspaceId, draftOverlayEnabled

**E) `agents.controller.getSuggestions`** (optional query; debug only)
- Not required for prod UI (since suggestions should come with each turn).

**F) `agents.controller.run`** (new action OR evolve `continueRun`)
- Inputs:
  - projectId, conversationId
  - userMessage? (optional)
  - agentMode
  - pins (stagePinned, channelPinned)
  - requestedAction:
    - CONTINUE
    - RUN_SKILL(skillKey)
    - START_WORKFLOW(templateId)
    - RUN_WORKFLOW_STEP(runId, stepId)
  - contextMode: CANONICAL or CANONICAL_PLUS_DRAFT
- Outputs: TurnResponse (includes suggestions)

**G) Workflow actions (Phase 3)**
- `workflows.startRun({ projectId, conversationId, templateId })`
- `workflows.continue({ projectId, conversationId, runId })`
- `workflows.cancel({ runId })`

---

## 7) UI implementation plan (Agent page)

### 7.1 Top bar changes (Agent page)
File: `studio-console/app/projects/[id]/agent/page.tsx`

- Add mode toggle (Manual / Workflow).
  - Persist to workspace via new mutation.
  - Default to Manual if unset.

- Update Continue button:
  - In Manual: label “Continue” (not “Continue (Auto)”).
  - In Workflow: label “Continue workflow”.

- Keep stage and channel pins. Skill pin becomes secondary:
  - Manual mode: skill pin should reflect `activeSkillKey` (and allow override).
  - Workflow mode: skill pin can be hidden or disabled (simplest: disabled).

### 7.2 Layout refactor: remove activity from main area
File: `studio-console/app/projects/[id]/agent/page.tsx`

- Remove import and rendering of `AgentActivityPanel`.
- Rebuild the right-side panel to contain:
  1) Suggestions panel (Continue + 3–5)
  2) Inspector tabs (Studio-style)

### 7.3 Inspector: reuse Studio design
Implement a shared component with the Studio tab strip style:

Option A (preferred): extract Studio’s `ArtifactInspector` into a reusable component:
- Create `studio-console/app/projects/[id]/_components/inspector/ArtifactInspector.tsx`
- Move the tab UI + panels into it.
- Update Studio page and Agent page to import it.

Option B (minimal): duplicate the Studio inspector inside Agent page.
- Acceptable short-term but creates drift.

Tabs required on Agent page:
- Overview
- Elements
- Tasks
- Printing
- Trello

Explicitly exclude:
- Facts

### 7.4 Suggestions panel UI
Create component:
- `studio-console/app/projects/[id]/_components/agent/SuggestionsBar.tsx` (or similar)

UI details:
- Primary button: Continue (visually primary)
- 3–5 chip buttons
- Disabled chips remain visible; show tooltip (`title=` is acceptable MVP)
- “Draft pending” badge when there’s pending ChangeSet
- Optional: show the stage and current mode

### 7.5 Keyboard shortcut wiring
File: `studio-console/app/projects/[id]/_components/chat/ChatComposer.tsx`

- Enter on empty triggers `onContinue` passed from Agent page (only in Agent route).
- Alt+1..5 triggers `onSuggestionClick(index)`.

Design constraints:
- Must not interfere with regular typing.
- Must check focus (if input is focused and not empty, do nothing).

### 7.6 ChangeSet integration + “draft as context” toggle
In Agent page approval stop section:
- Add toggle: “Use draft as context for next runs” (default ON)
- Store in `workspace.draftOverlayEnabled`
- Plumb into every run request as `contextMode: CANONICAL_PLUS_DRAFT` when enabled.

Important: Suggestions bar still works when a draft exists.

---

## 8) Backend wiring details (how to implement correctly)

### 8.1 Convert controller outputs into TurnResponse
In `studio-console/convex/agents/controller.ts`:

- Today: `continueRun` only persists `controllerOutput` and returns `{ success: true }`.

We will change it to return `TurnResponse` and also persist it under `workspace.artifactsIndex.lastTurnResponse` (or extend lastControllerOutput).

Plan:
1) After calling `runControllerStepLogic`, construct assistant message:
   - Use `result.thought` or ensure the run wrote a message to conversation messages.
2) Compute suggestions by calling new helper `computeSuggestions(ctx, workspace, runtimeContext)`.
3) Persist both controller output and suggestions state.

### 8.2 Where assistant messages live
Agent page reads from `projectConversations.listMessages`, so ensure each run also appends assistant message to conversation.

If controller currently does not append messages (check existing mutations), add it:
- mutation: `projectConversations.appendMessage({ conversationId, role, content })` (or existing equivalent)
- Ensure assistantSummary is written as assistant message.

### 8.3 Suggestion engine implementation files
Add:
- `studio-console/convex/agents/suggestions/types.ts` (Suggestion types)
- `studio-console/convex/agents/suggestions/context.ts` (build SuggestionContext)
- `studio-console/convex/agents/suggestions/heuristics.ts` (candidate selection + scoring)
- `studio-console/convex/agents/suggestions/rerank.ts` (LLM call to `ux.suggestedActionsTop3` or new Top5)
- `studio-console/convex/agents/suggestions/index.ts` (computeSuggestions entrypoint)

### 8.4 Heuristics: what to score (v1)
Deterministic scoring signals (extendable):

Artifacts / gaps:
- No elements → boost ideation + questions
- Elements exist but none approved → boost “approve/review elements”
- Approved elements exist but tasks missing → boost “break into tasks”
- Tasks exist but accounting missing → boost accounting
- Accounting exists but quote missing → boost quote draft
- Printing stage or files present → boost print spec + print QA
- Trello enabled but not synced → boost Trello sync

Prerequisites (disabled reasons):
- requiresElementSelection
- requiresApprovedElements
- requiresTasks
- requiresAccounting
- requiresQuoteDraft
- requiresPrintingFiles
- blockedMissingMeasurements
- blockedPendingDecision (open questions session exists)

Stability:
- Penalize skills shown recently.
- Avoid repeating same suggestions 5 turns in row.
- Enforce diversity across intentTag.

### 8.5 LLM re-ranker rules
Using existing `ux.suggestedActionsTop3` skill:
- Provide:
  - `stage`
  - `workspaceSummary` (computed)
  - `candidateSkills` (top N with metadata)
  - include a note about pending ChangeSet + draft overlay

If we keep Top3 schema:
- Use reranker for top 3, fill rest from heuristics.

If we add Top5:
- Create `ux.suggestedActionsTop5` prompt + schema in skills generator pipeline.

---

## 9) Workflows (Agnetic Workflow mode)

### 9.1 Concept
Workflow = predefined step list. User explicitly starts it. Continue advances one step at a time.

Properties:
- A workflow run is scoped to project + conversation.
- Each step typically runs a skill.
- Workflow can be blocked by:
  - pending ChangeSet approval
  - missing prerequisites

### 9.2 Templates (initial set)
We will define templates in code first.

Recommended templates aligned to StudioOps lifecycle:

1) **Clarify → Plan → Tasks → Cost → Quote**
   - questionsPack (blocking)
   - element plan
   - tasks breakdown
   - accounting estimate
   - quote draft

2) **Printing QA workflow**
   - extract print parts/spec
   - validate files
   - vendor questions / proof checklist

3) **Procurement workflow**
   - identify vendors
   - build purchase list
   - schedule pickups/deliveries

(You can add more later; keep v1 small.)

### 9.3 Workflow UI (Agent page)
In Workflow mode:
- Right panel shows:
  - workflow name
  - step list with current step highlighted
  - “Start workflow” selector (if none active)

Suggestions in Workflow mode:
- Primary Continue runs next step.
- Alternatives can include:
  - “Run step X again”
  - “Switch workflow” (optional; Phase 4)
  - stage-relevant skills (still 3–5)

### 9.4 Workflow state transitions
- Start: create run + steps; status active
- Continue:
  - if run blocked by pending ChangeSet: return suggestions that include “Review draft” and keep workflow blocked
  - else run next pending step:
    - on success: mark done, advance
    - on prerequisites missing: mark blocked and return disabled reason
- Completion: mark completed

---

## 10) Phased delivery plan (deep, implementable)

### Phase 0 — Prep (1–2 hours)
Goal: Confirm baseline build and identify missing wiring.

Tasks:
- Verify which page is used: `/projects/[id]/agent`.
- Identify current storage for workspace fields in schema.
- Confirm how assistant messages are appended (conversationMessages).

Deliverable:
- No user-visible changes.

### Phase 1 — Agent UI restructure (Manual default; no Facts; Studio-style inspector)
Goal: Correct page layout and remove “activity” from main UI.

Files to change:
- `studio-console/app/projects/[id]/agent/page.tsx`
- New shared inspector component (recommended):
  - `studio-console/app/projects/[id]/_components/inspector/ArtifactInspector.tsx`
  - Update `studio-console/app/projects/[id]/studio/page.tsx` to use shared component (optional but recommended to prevent drift).

Tasks:
1) Remove `AgentActivityPanel` import + rendering from Agent page.
2) Remove Facts tab and any `FactsPanel` rendering from Agent page.
3) Add right-side panel containing:
   - Suggestions panel placeholder
   - Studio-style inspector tabs (Overview/Elements/Tasks/Printing/Trello)
4) Add top-bar mode toggle (Manual/Workflow). Persist later (Phase 2).

Acceptance criteria:
- Agent page has no Facts UI.
- Agent page has no activity timeline in the main layout.
- Inspector uses Studio-style tabs.

Testing:
- Manual smoke: open agent page; ensure layout renders.

### Phase 2 — Manual mode suggestions + Continue semantics (core feature)
Goal: Always show Continue + 3–5 suggestions; Continue repeats active skill.

Backend tasks:
- Extend `projectWorkspaces` schema with:
  - `agentMode`, `activeSkillKey`, `draftOverlayEnabled`, `lastSuggestionsState`
- Add Convex mutations:
  - `projectWorkspaces.setAgentMode`
  - `projectWorkspaces.setActiveSkillKey`
  - `projectWorkspaces.setDraftOverlayEnabled`
- Update `agents.controller.continueRun`:
  - Return TurnResponse (or persist + return)
  - Populate `controllerOutput.nextSuggestedActions` with 3–5 suggestions
  - Persist `lastSuggestionsState`

Suggestion engine tasks:
- Implement heuristics candidate selection using `skills.listEnabled` and workspace state.
- Implement stable selection logic + cooldown.

UI tasks:
- Add SuggestionsBar UI to side panel.
- Implement click handlers:
  - Click suggestion runs skill (via controller run action) and sets active skill
  - Continue runs active skill
- Add “Draft pending” badge if pending changeset exists.

Acceptance criteria:
- After any run, suggestions show immediately.
- Continue is always available (Manual).
- Clicking a suggestion runs a single skill and updates suggestions.

Testing:
- Add a Playwright test covering:
  - open agent
  - run continue
  - verify suggestions exist
  - click first suggestion and verify it triggers run

### Phase 2.5 — Keyboard shortcuts (Enter / Alt+1..5)
Goal: fast operator control.

Files:
- `studio-console/app/projects/[id]/_components/chat/ChatComposer.tsx`
- `studio-console/app/projects/[id]/agent/page.tsx`

Tasks:
- Enter on empty triggers Continue (desktop only).
- Alt+1..5 triggers corresponding suggestions.

Acceptance criteria:
- No interference with typing.
- Only triggers when empty.

Testing:
- Playwright: focus composer, clear input, press Enter → triggers run.

### Phase 3 — Hybrid ranking: LLM reranker
Goal: suggestions feel smarter but remain reliable.

Tasks:
- Implement rerank step calling `ux.suggestedActionsTop3` skill.
- Decide Top5 vs Top3 + fill.
- Validate schema strictly; fallback to heuristics.

Acceptance criteria:
- Suggestions diversify and align to context.
- System still works when LLM is unavailable.

Testing:
- Unit tests for heuristics.
- Integration test uses mocked reranker output.

### Phase 4 — Agnetic Workflow system (templates + runs)
Goal: Predefined workflows, step-by-step.

Backend:
- Add workflow tables: `workflowRuns`, `workflowRunSteps`.
- Add templates registry file.
- Add actions: start workflow, continue workflow.

UI:
- Workflow mode UI in Agent page:
  - start workflow selector
  - show step list
  - Continue executes next step

Acceptance criteria:
- Start workflow creates run.
- Continue advances step-by-step.
- Workflow blocks safely on pending ChangeSet.

Testing:
- Playwright: start workflow → Continue runs step 1 → step status updates.

### Phase 5 — Prerequisites, disabled reasons, and draft overlay
Goal: match your “best UX” requirements.

Tasks:
- Implement prerequisite checks for suggestions.
- Surface disabled reasons in UI tooltips.
- Add “Use draft as context” toggle.

Acceptance criteria:
- Suggestions never disappear; they disable with reason.
- Draft overlay is on by default.

Testing:
- Unit tests for each prerequisite.

---

## 11) Testing strategy (specific)

### 11.1 Unit tests
Add tests for suggestion logic:
- Always returns Continue.
- Returns 3–5 alternatives.
- Enforces diversity.
- Cooldown avoids repetition.
- Disabled reasons for prerequisites.

Suggested location:
- `studio-console/src/lib/__tests__/suggestions.test.ts` (or colocate next to convex suggestions module, depending on existing tooling).

### 11.2 Playwright integration tests
Existing Playwright config at repo root. Add/extend tests:

Manual mode tests:
- Create/open conversation in agent page.
- Run Continue.
- Verify suggestions appear.
- Click suggestion 1.
- Verify it triggers run and updates suggestions.

Workflow mode tests:
- Switch to Workflow mode.
- Start a workflow template.
- Continue step-by-step.

### 11.3 Manual verification checklist
- Continue behavior consistent in both modes.
- Suggestions always visible and stable-ish.
- Pending ChangeSet does not block suggestions.
- No Facts anywhere in Agent page.

---

## 12) File-by-file change checklist (high specificity)

### UI
- `studio-console/app/projects/[id]/agent/page.tsx`
  - Add mode toggle UI + state.
  - Remove activity panel usage.
  - Remove facts tab + FactsPanel usage.
  - Add SuggestionsBar in side panel.
  - Add Studio-style ArtifactInspector (shared component recommended).

- `studio-console/app/projects/[id]/_components/chat/ChatComposer.tsx`
  - Add Enter/Alt keyboard hooks with safe focus checks.

- `studio-console/app/projects/[id]/_components/agent/SuggestionsBar.tsx` (new)
  - Render Continue + 3–5
  - Disabled reasons tooltips

- `studio-console/app/projects/[id]/_components/inspector/ArtifactInspector.tsx` (new shared)
  - Tabs: Overview/Elements/Tasks/Printing/Trello
  - Use existing panels (`PrintingPanel`, `TrelloPanel`) where possible

- `studio-console/app/projects/[id]/studio/page.tsx` (optional)
  - Replace inline ArtifactInspector with shared one to keep design consistent.

### Convex backend
- `studio-console/convex/schema.ts`
  - Extend `projectWorkspaces`
  - Add workflow tables (Phase 4)

- `studio-console/convex/projectWorkspaces.ts` (or wherever mutations live)
  - Add mutations: setAgentMode, setActiveSkillKey, setDraftOverlayEnabled

- `studio-console/convex/agents/controller.ts`
  - Update continueRun to return TurnResponse and populate nextSuggestedActions.
  - Add suggestion computation call.
  - Add workflow-aware Continue semantics (Phase 4).

- `studio-console/convex/agents/suggestions/*` (new)
  - Implement heuristics + reranker.

- `studio-console/convex/agents/workflows/*` (new, Phase 4)
  - Templates registry
  - start/continue actions

### Skills/prompts
- If adding Top5:
  - Update skill generator inputs (where prompts are generated) and regenerate `agentSkills.generated.json`.

---

## 13) Known risks and mitigation

1) **Controller vs Conversation model mismatch**
   - Controller uses `chatThreads` in some places; Agent UI uses `projectConversations`.
   - Mitigation: standardize Agent page runs on `projectConversations` and ensure controller actions append assistant messages there.

2) **LLM output schema drift**
   - Mitigation: strict validation + deterministic fallback.

3) **UI drift between Studio inspector and Agent inspector**
   - Mitigation: extract shared inspector component.

4) **Repetition/quality of suggestions**
   - Mitigation: cooldown + diversity + stage relevance + reranker.

---

## 14) Implementation order (the “agent can follow”) — exact sequence

1) Phase 1 UI restructure: remove activity + facts, add studio-style inspector and placeholder suggestions.
2) Phase 2 backend: add workspace fields and mutations; modify continueRun to return suggestions and persist them.
3) Phase 2 UI wiring: SuggestionsBar consumes returned suggestions and triggers run actions; Continue semantics manual.
4) Phase 2.5 keyboard bindings and tests.
5) Phase 3 reranker integration.
6) Phase 4 workflow templates + run engine + UI.
7) Phase 5 prerequisites + draft overlay toggle.

---

## 15) Open questions (explicit defaults)

Defaults we will implement unless you change them later:

- Suggestions count: **4** alternatives by default (allowed 3–5 based on availability).
- If Manual has no active skill: Continue chooses best suggestion and sets active skill.
- In Workflow mode with no active run: Continue disabled.
- UI labels in English; agent messages in Hebrew.

---

## 16) Appendices

### 16.1 Minimal workflow template definitions (starter)

We will add these as code in `studio-console/convex/agents/workflows/templates.ts`:

- `wf.plan_to_quote`
- `wf.printing_qa`
- `wf.procurement`

Each workflow is a list of { id, title, skillKey, requires? }.

### 16.2 Suggested skills metadata approach

To avoid big DB migrations, v1 uses a code map keyed by skillKey:

```ts
const SKILL_META: Record<string, {
  label: string;
  intentTag: SuggestionIntentTag;
  stageRelevance: Partial<Record<StagePin, number>>;
  requires?: {
    elementSelected?: boolean;
    approvedElements?: boolean;
    files?: boolean;
    tasks?: boolean;
    accounting?: boolean;
  };
}> = {
  // ...
};
```

Later we can migrate to DB.
