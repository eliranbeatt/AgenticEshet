# Test Plan: Agentic Migration (AgnetGMI)

## 1. Overview
This test plan covers the validation of the new **Single Autonomous Controller** architecture, the **Skills Registry**, and the associated **Printing** and **Trello** modules.

## 2. Test Levels

### 2.1 Unit Tests (Vitest)
Focus on individual functions and logic isolation.

*   **Skills Library (`convex/lib/skills.ts`)**
    *   `validateInput`: Ensure inputs match the skill's JSON Schema.
    *   `validateOutput`: Ensure LLM outputs match the skill's JSON Schema.
    *   `resolveSkill`: Check successful loading of skill definitions from the DB.
*   **Controller Logic (`convex/agents/controller.ts`)**
    *   `assessState`: Verify it correctly identifies "Gate" conditions (missing questions, pending changes).
    *   `nextStep`: Verify the state machine transitions (e.g., Question Gate -> Skill Run -> Artifact Update).
    *   `serializeWorkspace`: Ensure workspace context is correctly formatted for the LLM.
*   **Printing Module (`convex/printing.ts`)**
    *   `extractMetadata`: Mock file inputs and verify DPI/size calculations.
    *   `validateSpec`: Check pass/fail logic against printing specs.
*   **Trello Module (`convex/trello.ts`)**
    *   `generatePlan`: Verify the translator produces valid JSON plans.
    *   `validatePlan`: Ensure idempotent safety checks work.

### 2.2 Integration Tests (Convex-Test or Mocked Actions)
Focus on the interaction between Convex functions and the Database.

*   **Full Skill Run**:
    *   Seed a skill.
    *   Call `skill.run`.
    *   Verify it writes to `agentRuns` and returns the expected result.
*   **Controller Loop**:
    *   Seed a workspace state (e.g., "Ideation" with no brief).
    *   Call `controller.continue`.
    *   Verify it stops at "Ask Questions".
    *   Submit answers.
    *   Call `controller.continue`.
    *   Verify it proceeds to "Generate Ideas".

### 2.3 End-to-End Tests (Playwright)
Focus on the User Experience in the Studio UI.

*   **Studio Page Load**:
    *   Navigate to `/projects/[id]/studio`.
    *   Verify all panels (Thread, Timeline, Inspector) load.
*   **Autonomy Flow**:
    *   Click "Continue (Auto)".
    *   Verify UI updates with "Thinking..." and then shows new content.
    *   Verify "Question Gate" appears when expected.
*   **Artifact Inspection**:
    *   Click "Printing" tab.
    *   Upload a file (mocked).
    *   Verify "QA Findings" badge appears.

## 3. Test File Structure

```
studio-console/tests/
├── convex/
│   ├── controller.test.ts       # Controller logic & state machine
│   ├── skills.test.ts           # Skill validation & execution
│   ├── printing.test.ts         # Printing module logic
│   └── trello_new.test.ts       # New Trello sync logic
└── e2e/
    └── studio.spec.ts           # Playwright UI tests
```

## 4. Prerequisites
*   Convex Schema must be updated (Tables: `projectWorkspaces`, `printing`, etc.).
*   Skills Registry must be seeded.
*   Environment variables for LLM (OpenAI/Gemini) must be mocked or available.

## 5. Execution
Run `npm run test` for Unit/Integration tests.
Run `npx playwright test` for E2E tests.
