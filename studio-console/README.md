This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Development Workflow

1. Copy `.env.local.example` to `.env.local` and fill in Convex/OpenAI/Trello secrets.
2. In one terminal run `npx convex dev` to boot the Convex backend (requires login).
3. In another terminal run `npm run dev` to start Next.js on http://localhost:3000.
4. (First-time) seed shared agent prompts via `npx convex run seed:seedSkills`.
5. `npm run prepush` executes linting + tests; run it (or wire a git hook) before pushing to keep CI green.

## Google Drive Connector

1. Create an OAuth client in Google Cloud Console (OAuth consent screen + "Web application" client).
2. Add `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET` to `studio-console/.env.local` (see `studio-console/.env.local.example`).
3. Add `http://localhost:3000/api/google-drive/auth/callback` as an authorized redirect URI (or set `GOOGLE_DRIVE_REDIRECT_URI` to match your configured URI).
4. In the app, go to `/ingestion/connectors`, connect Google Drive, then pick a folder to watch and click "Sync now" to create an ingestion job.

## Testing & Quality

- `npm run lint` runs the repo-wide ESLint checks.
- `npm run test` executes the Vitest suite (unit tests live in `tests/**/*.test.ts`). Use `npm run test -- --coverage` to see V8 coverage.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

Additional operational playbooks live in `docs/`:

- `docs/DEPLOYMENT.md` – production Convex/Vercel configuration, required environment variables.
- `docs/QA_CHECKLIST.md` – final testing sequence (lint/tests, Trello sync smoke, RAG validation).
