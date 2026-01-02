# AgenticEshet - Project Context for Gemini

## 1. Project Overview
**AgenticEshet** is an AI-powered studio production and resource planning platform. It allows users to manage complex projects (events, shoots, constructions) by defining "Elements" (deliverables) and breaking them down into tasks, materials, and labor, assisted by autonomous agents.

## 2. Tech Stack
*   **Frontend:** Next.js 15+ (App Router), React 19, TypeScript, Tailwind CSS, Lucide Icons.
*   **Backend:** Convex (Serverless functions, Database, Vector Search, Scheduling).
*   **AI:** OpenAI/Gemini integration via Convex Actions.
*   **State Management:** React Context (`ItemsContext`, `ExplorerContext`), URL-based state.

## 3. Core Architecture & Concepts

### 3.1 Data Model (Convex)
*   **Projects (`projects`)**: The root container.
*   **Elements (`projectItems`)**: The central entity. Can be nested. Represents a physical object or service (e.g., "Stage", "Lighting Rig").
*   **Revisions (`revisions`, `revisionChanges`)**: System for tracking changes. Agents propose changes via "Drafts" which users approve/discard.
*   **Versions (`elementVersions`)**: Immutable snapshots of elements after approval.
*   **Drafts (`elementDrafts`)**: Temporary work-in-progress state for elements.
*   **Facts/Knowledge (`facts`, `projectKnowledge`)**: Source of truth extraction from conversations.

### 3.2 Key UI Components
*   **Planning Page (`/planning`)**:
    *   **Goal:** High-level ideation and structuring.
    *   **Layout:** 3-Column Grid (Elements Sidebar | Chat | Context) + Bottom Editor.
    *   **Components:** `FlowItemsPanel` (List + Suggestions), `PlanningChat` (AI conversation), `StructuredEditorPanel` (Details).
*   **Elements Page (`/elements`)**:
    *   **Goal:** Deep editing and management.
    *   **Current State:** 2-Pane Split (Sidebar | Inspector).
    *   **Target State:** **3-Pane Explorer** (Sidebar | Outline Tree | Granular Inspector).
*   **Agent Logic**:
    *   Located in `convex/agents/`.
    *   Includes `planner`, `solutioning`, `suggestions`.

## 4. Current Status (Jan 2026)

### ✅ Recently Completed
*   **Planning Page Implementation**: Built the `PlanningPage` with a specific grid layout.
*   **Unified Sidebar (`FlowItemsPanel`)**: Combined manual element creation with **Agent Suggestions** (Draft Revisions). Users can approve/discard agent proposals directly from the sidebar.
*   **Planning Chat**: Implemented context-aware chat (`PlanningChat`) that syncs with selected elements.
*   **Multi-Selection**: Updated `ItemsContext` to support selecting multiple elements.
*   **Navigation**: Added "Planning" to the main project navigation.

### 🚧 In Progress / Next Steps
*   **Elements Explorer Redesign**:
    *   **Objective**: Convert the `/elements` tab from a flat editor to a hierarchy-focused "Explorer".
    *   **Plan Location**: `Specs/elements/element_gmi.txt`.
    *   **Requirements**:
        *   3-Pane Layout (Sidebar, Center Outline, Right Inspector).
        *   "Outline" pane with Accordions (Overview, Tasks, Budget, Files).
        *   Granular selection (select a specific Task node, not just the whole Element).
        *   Draft Banner ("Unsaved Changes").

## 5. Key File Locations
*   **Specs**: `Specs/` (Detailed plans).
*   **Page Routes**: `studio-console/app/projects/[id]/`
    *   `planning/page.tsx`
    *   `elements/page.tsx`
*   **Shared Components**: `studio-console/app/projects/[id]/_components/`
    *   `planning/FlowItemsPanel.tsx` (Sidebar)
    *   `planning/StructuredEditorPanel.tsx` (Editor)
*   **Backend Schema**: `studio-console/convex/schema.ts`

## 6. How to Work with This Project
1.  **Check `Specs/`**: Major features usually have a text file in `Specs/`.
2.  **Respect `ItemsContext`**: Selection state is global.
3.  **Convex First**: Data logic resides in `convex/`.
4.  **Strict Mode**: React Strict Mode is on; ensure `useEffect` is idempotent (e.g., use refs for initialization locks).
