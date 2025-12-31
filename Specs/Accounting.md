# Accounting Tab — Low-Level Spec

> Scope: Next.js UI under `studio-console/app/projects/[id]/accounting/*`, Convex backend under `studio-console/convex/*`, and the element/item projection systems that feed Accounting.

## 0) Where the Accounting tab lives

### Frontend entry
- Route: `studio-console/app/projects/[id]/accounting/page.tsx`
- Tabs rendered from this page:
  - `Summary`
  - `Materials`
  - `Labor`
  - `Deep Research`

### Tab components
- `studio-console/app/projects/[id]/accounting/_components/SummaryTab.tsx`
- `studio-console/app/projects/[id]/accounting/_components/MaterialsTab.tsx`
- `studio-console/app/projects/[id]/accounting/_components/LaborTab.tsx`
- `studio-console/app/projects/[id]/accounting/_components/DeepResearchTab.tsx`
- Types:
  - `studio-console/app/projects/[id]/accounting/_components/AccountingTypes.ts` (used)
  - `studio-console/app/projects/[id]/accounting/_components/AccountingTypes.tsx` (empty / unused)

### Cross-cutting UI helpers referenced by Accounting
- ChangeSet review banner:
  - `studio-console/app/projects/[id]/_components/changesets/ChangeSetReviewBanner.tsx`
- Buying assistant panel (used inside Materials tab):
  - `studio-console/app/projects/[id]/quote/_components/BuyingAssistantPanel.tsx`

## 1) Primary data model (Convex)

Accounting UI reads/writes *sectioned* accounting via these main tables:

### `projects`
- Pricing defaults used by accounting totals:
  - `currency` (default: `ILS`)
  - `overheadPercent`, `riskPercent`, `profitPercent`
- Feature flags:
  - `features.elementsCanonical` (critical: changes how inline edits work)

### `sections`
Represents a logical accounting section for a project.
- Key fields used by UI:
  - `projectId`
  - `group` (grouping label shown in Summary)
  - `name`, `description`
  - `sortOrder`
  - `itemId?` (optional link to a `projectItems` element)
  - possible per-section overrides (if present in schema / code)

### `materialLines`
Detailed material line items.
- Typical fields (as used by UI/backends):
  - `projectId`, `sectionId`
  - `label`, `description`
  - quantities + unit pricing (planned and actual), computed gaps in UI
  - procurement / vendor fields, quote visibility flags
  - `isManagement` (management costs are optionally excluded in Summary UI)
  - provenance fields (common in this repo): `origin`, `generation`, `derivedFrom`, `derivationRunId`, `locked`, etc.

### `workLines`
Detailed labor line items.
- Typical fields:
  - `projectId`, `sectionId`
  - role/workType, rateType (incl. `flat` handling)
  - planned vs actual quantities/costs
  - provenance + lock similar to material lines

### `projectItems`, `itemRevisions`, `revisions`, `revisionChanges`, `elementVersions`
Used for “elements canonical” editing and for *generation* flows.

### `tasks`
Tasks can be linked back to accounting lines:
- `accountingSectionId`
- `accountingLineId` (links to a material line or work line id; the schema supports broader linking too)

### `deepResearchRuns`
Stores deep research runs:
- `projectId`
- status (`in_progress`/`completed`/etc.)
- `reportMarkdown` when completed

### ChangeSets tables
- `itemChangeSets` (summary object + status)
- `itemChangeSetOps` (serialized ops to apply/reject)

## 2) Primary backend API surface (Convex)

### Accounting API: `studio-console/convex/accounting.ts`

#### Query: `api.accounting.getProjectAccounting({ projectId })`
Purpose: **single read model** for the Accounting page.
- Loads:
  - `project` (pricing defaults)
  - all `sections` for project
  - all `materialLines` and `workLines` for project and groups them by section
  - project items (draft/approved/archived) to attach to linked sections
- Computes per-section stats server-side using server costing helper (`convex/lib/costing.ts`), producing a “snapshot” per section.
- Returns a structure used by the UI:
  - `sections: [{ section, materials, work, stats, item? }, ...]`
  - plus totals

Important nuance:
- Server “stats/snapshot” does **not** apply all UI filters (see client costing below). The Summary tab recomputes stats client-side with filter settings.

#### Mutations (core CRUD)
- `api.accounting.addSection`
- `api.accounting.updateSection`
- `api.accounting.deleteSection` (cascades delete its lines)
- `api.accounting.addMaterialLine` / `updateMaterialLine` / `deleteMaterialLine`
- `api.accounting.addWorkLine` / `updateWorkLine` / `deleteWorkLine`

#### Vendor/catalog helpers
- `api.accounting.ensureVendor`
- `api.accounting.searchVendors`
- `api.accounting.searchMaterialCatalog`
- `api.accounting.saveToCatalog`

### Projects API: `studio-console/convex/projects.ts`
- `api.projects.getProject({ projectId })` (Accounting page uses this)
- `api.projects.updateProject({ projectId, overheadPercent, riskPercent, profitPercent, ... })`
  - Summary tab uses it to persist margins.

### ChangeSets API: `studio-console/convex/changeSets.ts`
Used by `ChangeSetReviewBanner` (and also other phases like Tasks).

Key queries/mutations/actions:
- `api.changeSets.listByProject({ projectId, phase, status })`
- `api.changeSets.getWithOps({ changeSetId })`
- `api.changeSets.apply({ changeSetId, decidedBy? })`
- `api.changeSets.reject({ changeSetId, decidedBy? })`
- `api.changeSets.create({ changeSet })` (mutation)
- `api.changeSets.createFromAgentOutput({ agentOutput })` (action)

Important behavior:
- When `project.features.elementsCanonical === true`, apply uses `applyChangeSetCanonical(...)` which routes modifications through the canonical element/revision system instead of direct table edits.

### Agents used by Accounting

#### Accounting generator from Plan
File: `studio-console/convex/agents/accountingGenerator.ts`
- Action: `api.agents.accountingGenerator.run({ projectId, replaceExisting })`
  - Generates accounting from the *active approved planning document*.
  - If `replaceExisting`:
    - archives existing items
    - deletes sections + materialLines + workLines
    - recreates items/revisions from generated spec
    - runs projection sync to repopulate accounting lines

#### Accounting from Deep Research
File: `studio-console/convex/agents/accountingFromDeepResearch.ts`
- Action: `api.agents.accountingFromDeepResearch.run({ projectId, deepResearchRunId, replaceExisting })`
  - Similar replace-and-rebuild flow, but input is `deepResearchRuns.reportMarkdown`.

#### Deep Research run manager
File: `studio-console/convex/agents/deepResearch.ts` + `studio-console/convex/deepResearch.ts`
- `api.deepResearch.listByProject({ projectId })`
- `api.agents.deepResearch.startProject({ projectId })` (starts run)
- `api.agents.deepResearch.pollRun({ runId })` (polls, fills markdown)

#### Estimator hooks referenced from Accounting UI
- Project-level estimate: `api.agents.estimator.estimateProject({ projectId })`
- Section-level estimate (Materials/Labor tabs): `api.agents.estimator.run({ sectionId })`

### Items ↔ Accounting sync APIs
File: `studio-console/convex/items.ts`
- `api.items.syncApproved({ itemId })`
  - “Sync to accounting”: parse item’s approved spec and re-project into Accounting lines.
- `api.items.syncFromAccountingSection({ itemId, sectionId })`
  - “Sync from accounting”: build an `ItemSpecV2` from section+lines, write an approved revision (`tabScope="accounting"`), then re-project.

Conversion helper:
- `studio-console/convex/lib/itemHelpers.ts`: `buildSpecFromAccounting(...)`

## 3) Client-side costing and filters (Summary)

### Where filters live
Accounting page owns filter state and passes it to Summary.
Filters (as implemented in UI):
- selected element scope: `"all" | "unlinked" | <itemId>`
- `excludeManagement` (UI label is “Exclude management costs”)
- `respectVisibility` (quote visibility)
- `includeOptional`

### Where stats are computed
- Client: `studio-console/src/lib/costing.ts` (`calculateSectionStats`) — **filter-aware**.
- Server: `studio-console/convex/lib/costing.ts` (`calculateSectionSnapshot`) — used for baseline stats in query.

Net effect:
- `getProjectAccounting` returns `stats`, but Summary tab recomputes using filters for what the user sees.

## 4) UI behavior by file (low-level)

## 4.1 Accounting page — `app/projects/[id]/accounting/page.tsx`

Responsibilities:
- Fetches:
  - accounting read model: `api.accounting.getProjectAccounting`
  - project: `api.projects.getProject`
  - item tree: `api.items.listSidebarTree({ projectId, includeDrafts: true })`
- Controls tab selection and filter state.
- Controls “elements canonical” edit lifecycle:
  - toggling edit mode
  - draft creation/reuse
  - approve/discard draft
- Renders `ChangeSetReviewBanner` for phase `"accounting"`.

Elements-canonical editing state (high-level):
- `editMode` (on/off)
- `draftRevisionId` (current draft revision id)
- Approve: `api.revisions.approve({ revisionId: draftRevisionId })`
- Discard: `api.revisions.discardDraft({ revisionId: draftRevisionId })`

## 4.2 ChangeSet review banner — `app/projects/[id]/_components/changesets/ChangeSetReviewBanner.tsx`

Purpose:
- Shows how many pending ChangeSets exist for a given project phase.

Data:
- Loads pending list:
  - `api.changeSets.listByProject({ projectId, phase, status: "pending" })`
- Loads details for active ChangeSet:
  - `api.changeSets.getWithOps({ changeSetId })`

Actions:
- Approve button:
  - `api.changeSets.apply({ changeSetId })`
- Reject button:
  - `api.changeSets.reject({ changeSetId })`
- “Check Rules” button (when no pending ChangeSets):
  - `api.agents.rules.run({ projectId })`

UI:
- If pending count > 0: yellow banner with “Review” button.
- Review opens a right-side drawer:
  - left column: pending list
  - right column: active ChangeSet metadata + operation groups
  - operations are grouped by `entityType` and show `opType` and raw JSON payload.

## 4.3 Summary tab — `accounting/_components/SummaryTab.tsx`

Primary UI areas:
1) Top action buttons
- “Generate from Plan” → `api.agents.accountingGenerator.run({ projectId, replaceExisting: true })`
- “Deep-Estimate Project” → `api.agents.deepResearch.startProject({ projectId })`
- “Auto-Estimate Project” → `api.agents.estimator.estimateProject({ projectId })`
- “Add Section” → `api.accounting.addSection({ projectId, ... })`

2) Margins panel (project-level)
- Edits `riskPercent`, `overheadPercent`, `profitPercent`
- Saved via `api.projects.updateProject({ projectId, riskPercent, overheadPercent, profitPercent })`

3) Sections table
- Lists sections, grouped by `group`, ordered by `sortOrder`.
- Shows computed stats from client costing (filters apply).
- Inline edits per section:
  - edit fields (group/name/description/sortOrder) → `api.accounting.updateSection`
  - delete section → `api.accounting.deleteSection`

4) Sync controls
- “Sync from accounting” (per linked item): `api.items.syncFromAccountingSection({ itemId, sectionId })`
- “Sync to accounting” (per item): `api.items.syncApproved({ itemId })`

## 4.4 Materials tab — `accounting/_components/MaterialsTab.tsx`

Core concepts:
- Section selection: materials are displayed per section.
- Two operating modes:
  1) **Normal mode** (no canonical draft): writes directly to `materialLines`.
  2) **Draft mode** (elements canonical editing): writes patch ops against element snapshots via revisions.

Normal mode mutations:
- add line: `api.accounting.addMaterialLine`
- update line: `api.accounting.updateMaterialLine`
- delete line: `api.accounting.deleteMaterialLine`
- save to catalog: `api.accounting.saveToCatalog`

Draft mode dataflow:
- Preview what lines *would* be after draft patches:
  - `api.revisions.previewSnapshots({ revisionId: draftRevisionId })`
- Apply edits as patch ops:
  - `api.revisions.patchElement({ revisionId, elementId, ops: [...] })`
  - Patch ops used for materials:
    - `upsert_line` into `materials`
    - `remove_line` from `materials`
    - (and potentially lock/visibility toggles depending on implementation)

Other behaviors:
- “Auto-Estimate” per section uses `api.agents.estimator.run({ sectionId })` and is typically disabled in draft mode.

Buying assistant integration:
- Per material line, can render:
  - `BuyingAssistantPanel materialLineId={line._id} label={line.label}`

## 4.5 Buying Assistant panel — `quote/_components/BuyingAssistantPanel.tsx`

Purpose:
- Helps produce vendor/price suggestions for a given material line.

Reads:
- `api.buying.getSuggestions({ materialLineId })`
  - returns `{ summary, source, options[], citations? }` or null
- `api.buying.getMaterialLineContext({ materialLineId })`
  - used to infer procurement mode and disable online research for `in_stock`.

Actions:
- “Check History” / “Refresh”:
  - `api.buying.generateSuggestions({ materialLineId })`
- “Search Online”:
  - `api.research.startOnlineResearch({ materialLineId, query: label })`
  - tracks `researchRunId` and polls `api.research.getRun({ researchRunId })`
  - cancel: `api.research.cancelOnlineResearch({ researchRunId })`

Persisting results:
- Saving an option creates a manual price observation:
  - `api.prices.addManualObservation({ rawItemName: label, unit, unitPrice, currency: "ILS", notes })`

UI details:
- Shows procurement label derived from `materialLine.procurement`.
- Shows research status (queued/running/failed).
- Shows top citations (max 6).

## 4.6 Labor tab — `accounting/_components/LaborTab.tsx`

Parallels Materials tab but for `workLines`.

Normal mode mutations:
- add: `api.accounting.addWorkLine`
- update: `api.accounting.updateWorkLine`
- delete: `api.accounting.deleteWorkLine`

Draft mode:
- uses `api.revisions.previewSnapshots` and `api.revisions.patchElement`
- patch ops target the snapshot `labor` array
- special-cases `rateType: "flat"` semantics in UI/validation (quantities vs rate)

## 4.7 Deep Research tab — `accounting/_components/DeepResearchTab.tsx`

Purpose:
- List deep research runs and allow applying their report into accounting.

Reads:
- `api.deepResearch.listByProject({ projectId })`

Polling:
- When a run is in progress, tab calls `api.agents.deepResearch.pollRun` about every ~10 seconds until complete.

Apply to accounting:
- `api.agents.accountingFromDeepResearch.run({ projectId, deepResearchRunId, replaceExisting: true })`

Markdown handling:
- Normalizes the report markdown before display by:
  - extracting citation/source sections (supports headings like `Citations`, `Sources`, `מקורות`)
  - rewriting inline `[cite: ...]` markers into numbered markdown links
  - rebuilding a standardized `## Sources` block

## 5) Elements parsing and canonical editing (the “draft mode”)

This subsystem is what the Accounting Materials/Labor tabs switch into when the project is in canonical mode and the user toggles edit mode.

### Zod schemas
File: `studio-console/convex/lib/zodSchemas.ts`
- `ElementSnapshotSchema`
  - snapshot arrays: `materials`, `labor`, `tasks` with stable IDs like `mat_XXXXXXXX`, `lab_XXXXXXXX`, `tsk_XXXXXXXX`
  - includes tombstones to represent removals
- `ElementPatchOpsSchema`
  - patch operations such as:
    - `set_text`
    - `replace_section`
    - `upsert_line`
    - `remove_line`
    - tombstone add/restore

### Applying patches / preview
File: `studio-console/convex/lib/elementSnapshots.ts`
- Normalizes snapshots.
- Applies patch ops deterministically.
- Enforces tombstone + cleanup rules.

Convex interface:
File: `studio-console/convex/revisions.ts`
- `api.revisions.createDraft({ projectId, ... })`
- `api.revisions.patchElement({ revisionId, elementId, ops })`
- `api.revisions.previewSnapshots({ revisionId })`
- `api.revisions.approve({ revisionId })`
- `api.revisions.discardDraft({ revisionId })`

### Projection from element snapshots to accounting lines/tasks
Files:
- `studio-console/convex/projections.ts`
- `studio-console/convex/lib/elementProjections.ts`

Behavior summary:
- On approval of a revision draft (canonical flow), projections rebuild:
  - For each element, ensures it has a section.
  - Clears previously generated, non-locked lines/tasks.
  - Inserts new `materialLines`, `workLines`, and `tasks` derived from the element snapshot.
  - Updates dependencies and links tasks to accounting lines (`accountingLineId`) for purchase-material tasks.

## 6) Item spec projection (used by “Generate from Plan”, “Apply Deep Research”, and Sync)

File: `studio-console/convex/lib/itemProjections.ts`
- `syncItemProjections(ctx, { item, revision, spec })`
  - Ensures a `sections` row exists for the item.
  - Syncs materials → `materialLines` (keyed by itemMaterialId or label matching).
  - Syncs labor → `workLines` (keyed by itemLaborId or `(workType, role)` matching).
  - Syncs subtasks → `tasks`.

Item spec builder from accounting:
- `studio-console/convex/lib/itemHelpers.ts` (`buildSpecFromAccounting`)

## 7) End-to-end flows (what happens when you click)

### 7.1 Page load
1. UI loads project and accounting snapshot
   - `getProject`
   - `getProjectAccounting`
   - `listSidebarTree(includeDrafts: true)`
2. UI selects default tab (Summary) and computes filtered totals client-side.

### 7.2 Add/Edit/Delete Section
- Add: Summary → `api.accounting.addSection`
- Edit: Summary inline edit → `api.accounting.updateSection`
- Delete: Summary → `api.accounting.deleteSection` (also deletes its material/work lines)

### 7.3 Add/Edit/Delete Material/Work line (normal mode)
- Materials tab uses `add/update/deleteMaterialLine`.
- Labor tab uses `add/update/deleteWorkLine`.

### 7.4 Materials/Labor edits in canonical draft mode
1. Page toggles edit mode and ensures a draft revision exists.
2. Tabs read `api.revisions.previewSnapshots(revisionId)` to display draft result.
3. Edits are recorded via `api.revisions.patchElement(...)` using patch ops.
4. On approve: `api.revisions.approve(...)` triggers projection rebuild → accounting lines/tasks updated.

### 7.5 Generate from Plan
1. Summary tab calls `api.agents.accountingGenerator.run({ projectId, replaceExisting: true })`.
2. Agent:
   - reads active plan markdown
   - produces structured accounting sections/items via LLM schema
   - replaces existing accounting by archiving items + deleting section/material/work lines
   - creates approved items + revisions
   - calls projections to repopulate accounting tables

### 7.6 Deep Research → Apply
1. Summary triggers `deepResearch.startProject` (or elsewhere).
2. Deep Research tab polls `deepResearch.pollRun` until completed.
3. Apply uses `accountingFromDeepResearch.run(replaceExisting: true)` → replaces accounting similarly to plan generation.

### 7.7 Sync to accounting (item → accounting)
- UI calls `api.items.syncApproved({ itemId })`.
- Backend reads the approved item spec and forces projection sync into sections/material/work lines.

### 7.8 Sync from accounting (accounting section → item)
- UI calls `api.items.syncFromAccountingSection({ itemId, sectionId })`.
- Backend converts section + its lines into an `ItemSpecV2`, writes an approved revision scoped to accounting, then re-syncs projections.

### 7.9 ChangeSet review inside Accounting
- Banner shows pending ChangeSets for phase `"accounting"`.
- Review drawer shows:
  - summary (counts/warnings/assumptions/questions)
  - list of serialized ops grouped by `entityType`
- Approve calls `api.changeSets.apply`.
  - If canonical enabled: applies through canonical pipeline.
  - Else: applies direct creates/patches to items/tasks/accounting/materials per op payload.

## 8) “Lowest level” notes / gotchas

- Two competing read models for totals:
  - server `stats` returned by `getProjectAccounting` (snapshot)
  - client recomputation in Summary that applies filters
- Canonical edit mode changes the write path:
  - normal: mutations directly change `materialLines`/`workLines`
  - canonical: user edits become revision patch ops; only approval updates accounting tables
- Generation flows are destructive when `replaceExisting: true`:
  - sections/material/work lines are deleted
  - items are archived and recreated

---

## Appendix: file map
- UI
  - `studio-console/app/projects/[id]/accounting/page.tsx`
  - `studio-console/app/projects/[id]/accounting/_components/SummaryTab.tsx`
  - `studio-console/app/projects/[id]/accounting/_components/MaterialsTab.tsx`
  - `studio-console/app/projects/[id]/accounting/_components/LaborTab.tsx`
  - `studio-console/app/projects/[id]/accounting/_components/DeepResearchTab.tsx`
  - `studio-console/app/projects/[id]/_components/changesets/ChangeSetReviewBanner.tsx`
  - `studio-console/app/projects/[id]/quote/_components/BuyingAssistantPanel.tsx`

- Backend
  - `studio-console/convex/accounting.ts`
  - `studio-console/convex/projects.ts`
  - `studio-console/convex/changeSets.ts`
  - `studio-console/convex/deepResearch.ts`
  - `studio-console/convex/agents/accountingGenerator.ts`
  - `studio-console/convex/agents/accountingFromDeepResearch.ts`
  - `studio-console/convex/agents/deepResearch.ts`
  - `studio-console/convex/items.ts`
  - `studio-console/convex/revisions.ts`

- Projection + schemas
  - `studio-console/convex/lib/zodSchemas.ts`
  - `studio-console/convex/lib/elementSnapshots.ts`
  - `studio-console/convex/lib/elementProjections.ts`
  - `studio-console/convex/lib/itemProjections.ts`
  - `studio-console/convex/lib/itemHelpers.ts`
  - `studio-console/src/lib/costing.ts`
  - `studio-console/convex/lib/costing.ts`
