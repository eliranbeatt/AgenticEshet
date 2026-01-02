# Magnetic Studio Console — Completion Plan

This plan closes the gaps between the current codebase and the blueprint in `AgneticEshet.txt`, and stabilizes the repo for shipping. It assumes work is done inside `studio-console/` (Convex + Next.js App Router).

## Snapshot of current state
- Convex schema matches the blueprint, but the Trello sync action cannot run (uses `api` without import) and content hashes omit status/category/priority.
- Agents exist but are thin: no RAG context, no plan approval path, limited conversation logging, and Clarification/Planning prompts ignore prior plans/notes.
- Ingestion is single-file only: no job pipeline, no enrichment review, no commit-to-knowledge step, and `knowledge.search` returns chunk IDs without doc context.
- Frontend duplicates (`app/` vs `src/app/`), minimal navigation, and several tabs (Admin, Ingestion) are missing. Task board lacks drag/drop and quest assignment.
- `npm run lint` fails (unchecked `any`, unescaped quotes, unused vars) and there are no tests.

## Work plan

### Phase 0 — Baseline cleanup
- Remove `src/app/*` and `src/lib/*` or migrate any needed bits into `app/` to avoid dual Next.js roots; align `app/layout.tsx` with the chosen theme/fonts.
- Normalize global styles (Tailwind v4) and verify `postcss.config.mjs` and `tailwind` imports are consistent after removing the duplicate tree.
- Add `.env.local.example` documenting `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `OPENAI_API_KEY`, Trello keys.
- Fix lint blockers: replace `any` with typed shapes from `convex/_generated/dataModel`, escape raw quotes in JSX, remove unused vars/imports, and ensure `ConvexClientProvider` guards missing envs.

### Phase 1 — Project + plan lifecycle
- Enhance projects API/UI to edit status/details (event date, budget, location, notes) and surface summary on `app/projects/[id]/overview/page.tsx`.
- Add plan approval flow: mutation to set `isDraft=false` and mark older plans inactive; expose in Planning UI (Approve/Set Active buttons).
- Persist “brief summary” back to projects or plans so overview has a stable recap; display phase indicators on the project tabs.
- Strengthen conversation logging (phase-specific, ordered) and surface recent clarifications/plans in Overview.

### Phase 2 — LLM agents (strict mode + context)
- Extend `convex/lib/openai.ts` with retry/backoff and better error surfaces; parameterize models.
- Clarification agent: include recent plan/notes and latest conversation history in prompts; store responses into plans (draft clarification) and conversations.
- Planning agent: pull the latest clarification + RAG search snippets (see Phase 3) into the prompt; write reasoning/content to plans with version bump.
- Architect agent: require an approved plan, include plan markdown + constraints, and optionally bucket tasks into quests; ensure dedupe/idempotency when re-running.
- Quote agent: include tasks plus pricing docs from RAG, capture totals, and save both internal JSON and client-facing text; add currency handling.

### Phase 3 — Ingestion + knowledge base
- Rework `convex/ingestion.ts` to match the job pipeline: create job → upload files → `runIngestionJob` loops files (set status, parse, enrich via `EnhancerSchema`, store `enrichedText`, key points, tags).
- Add `commitIngestionJob` action: create `knowledgeDocs`, chunk `enrichedText`, embed chunks, insert `knowledgeChunks`, and mark files committed with `ragDocId`.
- Expand file parsing to at least text/markdown/pdf/docx via lightweight libs; enforce size limits and error capture.
- Update frontend Knowledge tab: show jobs/files with status, allow rerun/enrich, review enriched output, select files to commit, and list docs with tags/status; add search panel showing doc title and snippet, not just chunk text.
- Implement `knowledge.search` to return chunk + doc metadata; surface in agents (Phase 2) as contextual retrieval.

### Phase 4 — Tasks, quests, and Trello sync
- Task model: add quest assignment in UI (dropdown per task), quick edit for category/priority, and drag/drop by status (e.g., `dnd-kit`).
- Trello sync: fix missing `api` import, include status/category/priority in `contentHash`, map blocked state, and use Trello API with query params instead of JSON body; handle archiving deleted/done tasks and retry logging.
- Add Trello snapshot action (read-only board lists/cards) for the Trello View tab; show mapping status and last sync time.
- Quests: allow ordering/editing, display tasks per quest in Tasks tab, and show progress chips in Overview.

### Phase 5 — Knowledge-driven UI polish
- Overview: show latest clarification summary, active plan version, task counts, last Trello sync, last quote total, and quick links.
- Clarification/Planning tabs: show transcript history, phase badges, and the current approved plan alongside the editor.
- Knowledge tab: add doc detail drawer (summary, key points, tags, download link) and commit controls.
- Quote tab: compute totals per version, allow selecting a quote version for display/export.
- Add Admin pages: manage skill prompts (`skills` table) and enrichment profiles.

### Phase 6 — Reliability and testing
- Introduce Vitest + React Testing Library; add tests for `calculateHash`, `callChatWithSchema` (mock OpenAI), ingestion chunking/embedding wiring, and Trello mapping decisions.
- Add UI tests for critical flows (project creation, plan approval, task status change, knowledge search) using Playwright or Vitest + jsdom where feasible.
- Wire `npm run lint` + tests into a pre-push script and document manual Convex/Next dev commands.

### Phase 7 — Deployment readiness
- Document seeding (`npx convex run seed:seedSkills`), environment setup, and running Convex dev alongside Next.
- Create production config: Convex deployment IDs, Vercel env vars, and Trello/OpenAI secrets; add minimal logging/alerting around Trello sync and ingestion failures.
- Final QA checklist: lint/test pass, agents return schema-valid JSON, Trello sync dry-run on sample project, and RAG search returns relevant chunks.
