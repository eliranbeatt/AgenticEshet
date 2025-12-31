# Tasks Tab Technical Specification

## Overview
The Tasks Tab provides a Kanban-style interface for managing project tasks. It supports standard task management features (create, read, update, delete) as well as deep integration with the "Elements" (Project Items) system and Accounting. It also features AI-powered task generation and refinement.

## Directory Structure
- **Frontend**: `studio-console/app/projects/[id]/tasks/`
  - `page.tsx`: Main controller and view. Handles state, data fetching, and renders the Kanban board.
  - `_components/TaskModal.tsx`: Modal for detailed task editing.
  - `_components/`: Other shared components.
- **Backend**: `studio-console/convex/`
  - `tasks.ts`: Backend logic for task operations.
  - `schema.ts`: Database schema definition for `tasks`.
  - `revisions.ts`: Handles "Elements" draft/revision logic used by the tasks tab.

## Data Model (`convex/schema.ts`)
The `tasks` table is the core entity. Key fields include:
- **Identity**: `projectId`, `taskNumber` (sequential ID), `title`, `description`.
- **Status & Classification**: `status` (todo, in_progress, blocked, done), `category` (Logistics, Creative, Finance, Admin, Studio), `priority` (High, Medium, Low).
- **Links**:
  - `itemId`: ID of the linked Project Item (Element).
  - `itemSubtaskId`: ID of the specific task within the Element's internal structure (e.g., `tsk_...`).
  - `accountingSectionId`: ID of the linked Accounting Section.
  - `accountingLineId` / `accountingLineType`: Link to specific material or work lines in accounting.
  - `questId`: Link to a Quest (if applicable).
- **Gantt/Timing**: `estimatedDuration` (ms), `estimatedMinutes`, `startDate`, `endDate`, `dependencies` (list of task IDs).
- **Details**: `steps` (string array), `subtasks` (object array), `assignee`.
- **Metadata**: `source` (user vs agent), `createdAt`, `updatedAt`.

## Frontend Architecture (`page.tsx`)

### State Management
- **Filters**: `filterField` (section, item, priority, category, status, source) and `filterValue`.
- **Sorting**: `sortField` (updatedAt, createdAt, priority, title, category, section) and `sortOrder`.
- **Edit Mode**: `editMode` boolean. Toggles "Draft Mode" for Elements integration.
- **Drafts**: `draftRevisionId` stores the ID of the active revision when editing Elements.
- **Drag & Drop**: Uses `@dnd-kit` for moving tasks between Kanban columns.

### Components
1.  **`TasksPage` (Main)**:
    - Fetches data (`tasks`, `project`, `accounting`, `items`, `agentRuns`).
    - Handles global actions: Auto-Generate, Refine, Regenerate.
    - Manages "Draft Mode" lifecycle (Create Draft -> Edit -> Approve/Discard).
    - Renders `TaskControlsBar`, `DndContext` (Kanban), `SectionTaskPanel`, and `TaskModal`.
2.  **`KanbanColumn`**:
    - Renders a column for a specific status.
    - Uses `useDroppable` to accept dropped tasks.
3.  **`TaskCard`**:
    - Renders individual task details.
    - Uses `useDraggable` for drag operations.
    - Provides inline editing for quick updates (Category, Priority, Status, etc.).
4.  **`TaskModal`**:
    - Detailed form for editing all task fields.
    - Handles saving changes to both the `tasks` table and the Element's revision (if linked).
    - Integrates with Chat (`AgentChatThread`) and Image generation.

## Backend Logic (`convex/tasks.ts`)

### Key Functions
- **`listByProject`**: Returns all tasks for a project. Supports filtering by `itemId`.
- **`createTask`**: Creates a new task. Calculates the next `taskNumber`.
- **`updateTask`**: Updates task fields.
  - Automatically calculates `estimatedDuration` from `estimatedMinutes`.
  - Attempts to link `accountingSectionId` if `itemId` is provided and a matching section exists.
- **`deleteTask`**: Removes a task.
- **`ensureTaskNumbers`**: Maintenance function to ensure all tasks have sequential `taskNumber`s.
- **`clearTasks`**: Deletes all tasks for a project (used before regeneration).

## Data Flow & Elements Integration

### Standard Flow
1.  User performs action (e.g., drag card).
2.  Frontend calls `api.tasks.updateTask`.
3.  Backend updates `tasks` table.
4.  UI updates via reactive `useQuery`.

### Elements "Draft Mode" Flow
This flow is active when `elementsCanonical` feature is enabled and `editMode` is true.
1.  **Enter Mode**: User clicks "Edit tasks". Frontend calls `api.revisions.createDraft` (or fetches existing).
2.  **Modify Task**:
    - When a task linked to an Element (`itemId`) is modified, the frontend calls `applyTaskPatch` (in `page.tsx`) or logic in `TaskModal`.
    - **Parsing/Formatting**: The task is converted to the Element's expected JSON format using `buildTaskValue`:
      ```typescript
      {
          taskKey: string, // e.g. "tsk_a1b2c3d4"
          title: string,
          details: string,
          bucketKey: "general",
          taskType: "normal",
          estimate: "",
          dependencies: string[], // mapped from task IDs to taskKeys
          usesMaterialKeys: [],
          usesLaborKeys: []
      }
      ```
    - **Patching**: Frontend calls `api.revisions.patchElement` with operations:
      - `upsert_line`: To add/update a task in the Element.
      - `remove_line`: To delete a task or move it to another Element.
3.  **Commit**: User clicks "Approve". Frontend calls `api.revisions.approve`.
4.  **Discard**: User clicks "Discard". Frontend calls `api.revisions.discardDraft`.

### AI Integration
- **Generation**: `api.agents.architect.run` generates tasks based on the project plan.
- **Refinement**: `api.agents.taskRefiner.run` analyzes tasks to add dependencies and time estimates.
