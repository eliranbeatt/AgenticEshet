# Deployment & Environment Notes

## Required Environment Variables

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Public Convex URL for the deployment (e.g. `https://coolstudio.convex.cloud`). |
| `CONVEX_DEPLOYMENT` | Convex deployment identifier (`dev:xxx` for local, `prod:xxx` for production). |
| `OPENAI_API_KEY` | Key used by Clarification/Planning/Architect/Quote agents. |
| `TRELLO_API_KEY` / `TRELLO_TOKEN` | Trello credentials used when syncing cards. |
| `TRELLO_BOARD_ID` | Default board ID for the Trello Sync tab (optional; can be overridden per project). |

The `.env.local.example` file covers all of the above. When deploying to Vercel, mirror the same variables in the project settings (Environment Variables tab) and ensure `CONVEX_DEPLOYMENT` points at the production Convex deployment ID.

## Deploying Convex

1. Authenticate: `npx convex login`.
2. Deploy schema/functions: `npx convex deploy` (choose the production deployment when prompted).
3. Seed base skills in prod if needed: `npx convex run --deployment prod:<id> seed:seedSkills`.

## Deploying Next.js (Vercel)

1. Push to the `main` branch (or the branch configured for Vercel). Ensure `npm run prepush` passes locally first.
2. Confirm the Vercel project has the same environment variables as `.env.local`.
3. Trigger a Vercel deployment (automatic on push or via dashboard).
4. After deploy, smoke test:
   - Hit `/projects` and create a sample project.
   - Run Clarification & Planning agents to ensure OpenAI creds work.
   - Visit the Trello tab and verify the configuration loads.

## Operational Notes

- Running locally requires two processes: `npx convex dev` and `npm run dev`.
- Trello sync calls make real HTTP requests; preferring test boards/keys during development is recommended.
- When rotating OpenAI/Trello keys, redeploy Convex (`npx convex deploy`) so the updated env vars apply to the server-side actions.
