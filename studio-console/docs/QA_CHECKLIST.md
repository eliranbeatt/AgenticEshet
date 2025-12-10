# Release QA Checklist

1. **Code Quality**
   - `npm run lint`
   - `npm run test` (or `npm run test -- --run` in CI)
   - Spot-check Vitest coverage for the critical utilities (hashing, OpenAI wrapper, Trello helpers).

2. **Convex / Next Agents**
   - Run `npx convex dev` + `npm run dev`.
   - Create a project and run the Clarification agent — verify output appears in Overview.
   - Run Planning + Architect agents; confirm tasks populate the Tasks board.
   - Generate a quote and ensure the new export button copies data to clipboard.

3. **Trello Sync**
   - On the Tasks tab, ensure statuses/categories/priorities update Trello after `Sync Now`.
   - On the Trello View tab, verify the snapshot pulls lists/cards (uses configured API key/token/board).

4. **Knowledge Base**
   - Upload a test document, wait for ingestion, review the drawer details, and commit the doc.
   - Run Knowledge search to confirm snippet/doc metadata appear.

5. **Deployment Config**
   - Confirm `.env.local` (and Vercel env) contain `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `OPENAI_API_KEY`, `TRELLO_*`.
   - Run `npx convex run seed:seedSkills` on fresh deployments to ensure prompts exist.

6. **Smoke Tests (Prod/Staging)**
   - Hit `/projects` page, create a project, and navigate through Overview/Clarification/Planning tabs without console errors.
   - Perform a Trello sync dry-run on a sample board (test project) to ensure API creds are valid.
   - Execute a Knowledge search and confirm results return reasonable text.
