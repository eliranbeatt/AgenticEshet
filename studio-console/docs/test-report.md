# QA & Testing Report (2025-12-10)

## Scope
- Reviewed AgneticEshet.txt blueprint, CompletionPlan.md, deployment/QA docs, and key app/Convex modules in `studio-console/`.
- Target stack: Next.js App Router frontend + Convex backend (agents, ingestion, Trello sync, RAG).

## Automated Checks
- `npm run lint` — passed.
- `npm run test` — passed; Vitest include glob still skips TSX (`tests/**/*.test.tsx`), so the quote page test is unrun.
- Playwright: installed `@playwright/test` and `npx playwright install chromium`; no e2e specs yet.

## Findings
- Active preview deployment: `https://blessed-otter-358.convex.cloud` (created via preview deploy key). `.env.local` points here.
- Convex env set for `OPENAI_API_KEY`, `OPENAI_EMBED_MODEL=text-embedding-3-small`, `TRELLO_API_KEY`, `TRELLO_TOKEN`.
- Seeded skills via `seedSkillsPublic`.
- Agent smoke on project `Agent Flow Project`:
  - Clarification agent returns structured output successfully.
  - Planning agent returns structured plan (version 2) successfully.
  - Architect agent now succeeds after Zod schema fix (questName nullable) and generates tasks from the active plan.
- RAG not re-run on this deployment; prior RAG smoke was on an earlier preview.
- Trello API credentials still return `invalid key` on `/members/me/boards`; Trello sync not testable without working key/token/board id.
- Vitest still excludes TSX tests; Playwright installed but no e2e specs yet.

## Completion Plan
1. Keep env aligned to `https://blessed-otter-358.convex.cloud` (`CONVEX_DEPLOYMENT` preview key in `.env.local`) and ensure the same vars are set in Convex env (done).
2. Fix Vitest include glob to run `tests/**/*.test.ts?(x)`; rerun tests to bring the TSX quote page test online.
3. Add Playwright e2e specs for project creation + clarification/planning + architect flow, tasks drag/drop + Trello sync (once working Trello creds/board id), knowledge upload/search, and quote export.
4. Extend agent validation to quote agent and RAG-based flows on this deployment (knowledge upload + search + agent prompts pulling context).
5. Resolve Trello credentials (key/token/board id) and rerun Trello API smoke; configure `trelloSync.saveConfig` once a board id is available.
6. Execute the QA checklist against `blessed-otter-358` and document any regressions.

## Blockers / Requests
- Trello key/token still return `invalid key`; need a working key/token and a target board id to exercise Trello sync.
- Confirm that `https://blessed-otter-358.convex.cloud` should remain the canonical preview target before adding Playwright e2e.
- Provide any Playwright MCP expectations (runner config/target host) before adding UI e2e.
