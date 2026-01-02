# Brain Codex Plan (repo-specific)

This plan reflects the remaining work from `Specs/brain.txt` after the current codebase updates. Each phase lists the exact files/components touched. Status is included for clarity.

## Phase 1 - Brain updater reliability + retries (DONE)
- `studio-console/convex/agents/brainUpdater.ts`: ensure Brain exists before prompt build, wrap entire run in try/catch, and retry on `conflict_retry`.
- `studio-console/convex/brainEvents.ts`: add `resetForRetry` to rebase `brainVersionAtStart`.

## Phase 2 - Brain UI visibility + structured controls (DONE)
- `studio-console/app/projects/[id]/_components/flow/FlowWorkbench.tsx`: always expose the Project Brain tab.
- `studio-console/app/projects/[id]/knowledge/page.tsx`: always show the `current` tab for Brain.
- `studio-console/app/projects/[id]/_components/knowledge/BrainEditor.tsx`: add bullet reordering, move-to-element/project, and conflict tombstone actions.

## Phase 3 - Conflict tagging in patch engine (DONE)
- `studio-console/convex/lib/brainPatch.ts`: assign conflict IDs server-side and tag referenced bullets (`conflict:<id>`).
- `studio-console/convex/agents/brainUpdater.ts`: instruct updater to include `bulletAId/bulletBId` when creating conflicts.

## Remaining deletions
- None.

## Remaining changes
- None. The Brain feature implementation and fixes are complete for this phase of work.
