# New RAG System Plan

## Objectives
- Expand RAG to cover all conversation and work artifacts (plans, tasks, quests, quotes, conversations), not just knowledge uploads.
- Let agents dynamically query RAG with richer filters (project/global scope, topics, client name, domain, thresholds, result counts).
- Ensure every agent can choose what to retrieve, with tunable parameters per invocation.
- Maintain high-quality embeddings via enrichment/summarization before chunking.

## Scope & Principles
- Scope includes Convex backend, agent prompts, ingestion pipeline, and minimal UI to configure/debug retrieval.
- Backward-compatible migration: preserve existing knowledge docs and chunk schema; add new tables or fields without breaking current flows.
- Security: do not expose other projects’ data unless explicitly requested (global search is opt-in).
- Observability: log retrieval queries and selections for traceability.

## Data Model Changes (Convex)
- Knowledge artifacts
  - Add a unified `knowledgeSources` enum/type to tag origin: `doc_upload`, `plan`, `conversation`, `task`, `quest`, `quote`, `system_note`.
  - Add metadata fields to `knowledgeDocs` (or a new `knowledgeRecords` table if cleaner):
    - `projectId` (optional for global), `title`, `sourceType`, `sourceRefId`, `phase` (optional), `clientName`, `tags`, `topics`, `domain`, `createdAt`.
  - Add `knowledgeChunks` fields:
    - `sourceType`, `projectId` (optional), `clientName`, `topics` (array), `domain`, `phase`, `scoreOverride` (optional), `timestamp`.
  - Add vector indexes:
    - Existing `by_embedding` per project; add a global-capable index with filter fields that include `projectId`, `sourceType`, `clientName`, `domain`, `topics`.
- Conversations & artifacts ingestion
  - Add background jobs to ingest: `plans`, `conversations`, `tasks`, `quests`, `quotes`.
  - Each ingestion stores a normalized doc (summary + enriched text) and chunks with embeddings.
- Retrieval logs
  - Add `retrievalLogs` table: `agentRole`, `projectId`, `query`, `filters`, `limit`, `threshold`, `resultsMetadata`, `createdAt`.

## Ingestion & Enrichment
- Shared enrichment service
  - Reuse `extractTextFromFile` + `callChatWithSchema` pattern to produce: `normalizedText`, `summary`, `keyPoints`, `keywords`, `topics`, `domain`, `clientName` (if detectable), `language`.
  - Chunking: parameterize chunk size/overlap; default 1,200 chars / 150 overlap.
- File uploads (existing)
  - Keep ingestion jobs; extend commit to write `sourceType=doc_upload`, propagate topics/domain/clientName from enrichment.
- Plans
  - Hook: when a plan is created/updated/activated, enqueue ingestion to normalize markdown and store as a knowledge record + chunks.
- Conversations
  - Hook: when `conversations` table gets a new entry, extract assistant/user text, summarize, and ingest with `sourceType=conversation`, `phase`.
- Tasks/quests/quotes
  - Periodic or event-driven ingestion to convert records into short narratives (title + description + status/tags) for embeddings.
- Re-ingestion strategy
  - On updates, mark previous knowledge record superseded and ingest a new version; optionally keep `sourceRefId` linkage.

## Retrieval API Design
- New Convex action `knowledge.dynamicSearch`:
  - Args: `projectId` (optional), `query`, `limit`, `minScore`, `scope` (`project` | `global` | `both`), `sourceTypes?`, `clientNames?`, `domains?`, `topics?`, `phases?`, `includeSummaries?`, `returnChunks?`.
  - Behavior: embed query, vector search with filters based on scope and provided facets; allow two-pass (project-first then global fallback).
  - Output: list of chunks with doc metadata (title, sourceType, projectId, clientName, tags/topics, summary, score).
- Convenience helpers
  - `getContextDocs` evolves to accept filters and limits; defaults to current behavior to avoid breaking callers.
- Thresholds
  - Apply `minScore` filter; optionally rescore or normalize by source recency.

## Agent Integration
- Clarification, Planning, Architect, Quote agents:
  - Before calling the LLM, build a retrieval request based on current task:
    - Clarification: scope project+global, sourceTypes `conversation`, `plan`, `doc_upload`; topics from project domain.
    - Planning: project scope with fallback to global, sourceTypes `plan`, `doc_upload`, `conversation`; limit 8; minScore tuned.
    - Architect: include `task`, `quest`, `plan`, `doc_upload`.
    - Quote: include `task`, `quote`, `doc_upload` (pricing/rate cards), `plan`.
  - Agents decide filters dynamically (e.g., if clientName known, include it; if no results, widen scope).
  - Inject retrieved snippets into prompts with attribution (title/sourceType/project).
- Logging
  - Each agent writes to `retrievalLogs` with the parameters and selected doc IDs for debugging.

## UI & Ops
- Knowledge page
  - Add toggle for project-only vs global search; filters for source type, topics, domain, client name, min score, limit.
  - Display source badges and originating artifact.
- Admin/debug page
  - Simple table of retrieval logs and ingestion status.
- Settings
  - Environment/config for default chunk size, overlap, limit, minScore, global-search allowlist.

## Testing & QA
- Unit tests
  - Chunking/enrichment helpers; dynamicSearch filter logic; ingestion of markdown/conversation payloads.
- Integration (Convex actions)
  - End-to-end ingestion for a plan -> knowledge record + chunks; search with project vs global scope; threshold behavior.
- UI tests
  - Search filters applying; global vs project toggle; rendering source badges.
- Regression
  - Ensure legacy `knowledge.search` still works for project-only flows until fully migrated.

## Migration Plan
- Add new tables/fields and indexes.
- Ship enrichment/ingestion for artifacts; backfill:
  - Batch through existing plans/conversations/tasks/quests/quotes to create knowledge records and chunks.
- Swap agents to use `dynamicSearch`; keep old `getContextDocs` as fallback.
- Update UI to expose new search options.
- Monitor retrieval logs and adjust defaults.

## Work Breakdown
1) Schema & indexes
   - Add metadata fields and vector index filters; create `retrievalLogs`.
2) Enrichment pipeline
   - Generalize enrichment; configurable chunking.
3) Artifact ingestion hooks
   - Plans, conversations, tasks/quests/quotes event-driven ingestion.
4) Dynamic retrieval action
   - Implement `knowledge.dynamicSearch` with filters, scope, thresholds; logging.
5) Agent wiring
   - Update four agents to choose filters/limits per role and inject results.
6) UI/UX
   - Search filters + scope toggle; admin/logs view.
7) Backfill & verification
   - Reingest historical artifacts; smoke tests; adjust scoring.
8) Testing
   - Unit/integration/UI coverage; lint.

## Risks & Mitigations
- Scope creep: keep legacy search intact while rolling out dynamic search per agent.
- Cost/latency: cache embeddings; tune chunk sizes; limit global searches by default.
- Data bleed: default to project scope; require explicit opt-in for global/both; log retrievals.
- Quality: enrichment schema must extract topics/client/domain reliably; add validation and guardrails.
