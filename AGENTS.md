# Repository Guidelines

## Project Structure & Module Organization
- Primary work happens inside `studio-console/`, a Next.js App Router workspace where routes such as `app/projects/page.tsx` and providers like `app/ConvexClientProvider.tsx` define navigation and layout.
- Convex backend logic lives under `convex/` with domain modules (`projects.ts`, `quests.ts`, `knowledge.ts`), role prompts in `convex/agents/`, schema + seeds in `convex/schema.ts` and `convex/seed.ts`, and generated clients in `convex/_generated/` (never edit by hand).
- Shared TypeScript helpers sit in `src/lib/`, static assets live in `public/`, and Tailwind/global styles are centralized at `app/globals.css`.

## Build, Test, and Development Commands
- Run `npm install` once inside `studio-console/` to sync dependencies.
- `npm run dev` boots the Next dev server on http://localhost:3000; pair it with `npx convex dev` to run the Convex backend locally (requires `.env.local`).
- `npm run build` outputs the optimized bundle, `npm run start` serves that build for smoke checks, and `npm run lint` applies the ESLint config in `eslint.config.mjs`.

## Coding Style & Naming Conventions
- Use TypeScript with 4-space indentation as seen in `app/layout.tsx`; keep files ASCII-only and favor small, typed utilities over inline logic.
- React components/files exporting JSX should use PascalCase (`ProjectList.tsx`), hooks start with `use`, and helper functions remain camelCase.
- Compose styles with Tailwind utilities plus `clsx`/`class-variance-authority`; avoid ad-hoc inline styles.
- Convex functions must be exported via `query`, `mutation`, `action`, or `internal*` wrappers and be named after the domain (`quests.create`, `tasks.assign`). Always run `npm run lint` before pushing.

## Testing Guidelines
- No formal `npm test` script exists yet; colocate new `*.test.ts(x)` files next to components or under `src/__tests__/` and document any tooling you add.
- Prefer Vitest + React Testing Library for UI logic and Convex testing helpers (or lightweight mocks) for backend actions. Describe manual verification steps (route hit, payloads) in the PR if automation is not viable.
- Aim for at least one high-value test per control branch in `convex/lib/*.ts` and ensure seed changes are exercised with sample data.

## Commit & Pull Request Guidelines
- Recent history favors terse, lower-case subjects like `phase 7`; keep the first line under 50 characters and expand with an optional scope (`phase 8 - quests UI`).
- Squash WIP commits, include a summary, linked issue/task, screenshots for UI work, and note any schema or `convex/seed.ts` changes.
- Confirm `npm run lint` (and any tests you add) pass locally, and call out new env vars or Convex deployment steps in the PR body.

## Environment & Security Notes
- Store secrets such as `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, and `OPENAI_API_KEY` in `studio-console/.env.local`; never commit `.env*` files or share raw logs with client data.
- Generated Convex artifacts update automatically; review diffs before committing to avoid leaking deployment IDs.
