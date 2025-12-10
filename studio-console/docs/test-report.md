# QA & Testing Report (2025-12-10)

## Scope
- Reviewed AgneticEshet.txt blueprint, CompletionPlan.md, deployment/QA docs, and key app/Convex modules in `studio-console/`.
- Target stack: Next.js App Router frontend + Convex backend (agents, ingestion, Trello sync, RAG).

## Automated Checks
- `npm run lint` — passed.
- `npm run test` — passed; Vitest include glob still skips TSX (`tests/**/*.test.tsx`), so the quote page test is unrun.
- Playwright: installed `@playwright/test` and `npx playwright install chromium`; no e2e specs yet.

## Findings
- Used the provided preview deploy key to deploy Convex; it created preview deployment `https://proper-lemming-614.convex.cloud` (the provided `hidden-dogfish-153` URL had no functions).
- Seeded skills via `seedSkillsPublic` against `proper-lemming-614`.
- RAG smoke: created project `QA Project` and two knowledge docs; re-embedded with `OPENAI_EMBED_MODEL=text-embedding-3-small`; `knowledge.search` returns the expected chunks.
- Trello API credentials returned `invalid key` for `GET /1/members/me/boards`; Trello sync cannot be exercised without a working key/token/board id.
- Vitest still excludes TSX tests; automated coverage remains limited to small helpers; UI/agent flows are untested.
- Playwright is installed but no specs exist yet.

## Completion Plan
1. Standardize env to the active preview deployment: `NEXT_PUBLIC_CONVEX_URL=https://proper-lemming-614.convex.cloud`, `CONVEX_DEPLOYMENT=preview:eliran-ben-haim:agenticeshet`, and ensure Convex env has `OPENAI_API_KEY` + `OPENAI_EMBED_MODEL=text-embedding-3-small` (already set for preview).
2. Fix Vitest include glob to run `tests/**/*.test.ts?(x)`; rerun tests to include TSX UI coverage.
3. Author Playwright e2e covering project creation + clarification/planning flow, tasks drag/drop + Trello sync (once valid Trello creds + board id are supplied), knowledge upload/search, and quote export.
4. Validate Convex agents via scripted calls: clarification/planning/architect/quote hitting the new deployment with the provided OpenAI key.
5. Resolve Trello credentials (key/token/board id) and rerun Trello API smoke; configure `trelloSync.saveConfig` once a board id is available.
6. Execute the QA checklist against `proper-lemming-614`; document results and regressions.

## Blockers / Requests
- Trello key/token appear invalid (`invalid key` from `/members/me/boards`); need working creds and a target board id.
- Confirm the desired Convex deployment URL for UI/testing (currently `proper-lemming-614` created from the supplied preview key; original `hidden-dogfish-153` had no functions).
- Provide any Playwright MCP expectations (runner config/target host) before adding UI e2e.
