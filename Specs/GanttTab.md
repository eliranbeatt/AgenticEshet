# Gantt Tab Technical Specification

## 1. Overview
The Gantt Tab provides a visual timeline representation of project tasks. It allows users to view task schedules, dependencies, and progress in a Gantt chart format. The view supports different time scales (Day, Week, Month) and enables interactive rescheduling of tasks.

## 2. Frontend Architecture

### 2.1 Components
- **Page Entry**: `app/projects/[id]/gantt/page.tsx`
  - Simple wrapper that renders the `GanttView` component.
- **Main View**: `app/projects/[id]/gantt/_components/ganttview.tsx`
  - **Library**: Uses `gantt-task-react` for the core chart rendering.
  - **State**:
    - `viewMode`: Controls the time scale (`ViewMode.Day`, `ViewMode.Week`, `ViewMode.Month`).
  - **Data Fetching**:
    - `api.tasks.listByProject`: Fetches all tasks for the current project.
    - `api.items.listSidebarTree`: Fetches project items to resolve `itemId` to human-readable titles.
  - **Mutations**:
    - `api.tasks.updateTask`: Used to persist changes when tasks are moved or resized.

### 2.2 UI Logic
- **Task Mapping**:
  - Raw tasks from Convex are mapped to `Task` objects expected by `gantt-task-react`.
  - **Start Date**: Uses `startDate` from DB or defaults to today (00:00:00).
  - **End Date**: Uses `endDate` from DB. If missing, calculates based on `estimatedDuration` or defaults to Start + 1 day.
  - **Labeling**: Task names are prefixed with the associated Item title if `itemId` is present (e.g., `[Living Room] Paint Walls`).
  - **Progress**: Derived from `status`:
    - `done`: 100%
    - `in_progress`: 50%
    - `todo` / `blocked`: 0%
  - **Styling**: Custom colors for progress bars (`#ffbb54` / `#ff9e0d`).
  - **Dependencies**: Maps `dependencies` array (IDs) to string IDs required by the library.

- **Interactivity**:
  - **View Modes**: Buttons to switch between Day, Week, and Month views.
  - **Drag & Drop**: Users can drag tasks to change start/end dates.
  - **Resizing**: Users can resize task bars to change duration.

## 3. Backend Architecture (Convex)

### 3.1 API Endpoints (`convex/tasks.ts`)
- **`listByProject` (Query)**
  - **Args**: `projectId`, optional `itemId`.
  - **Logic**: Returns all tasks matching the `projectId`. If `itemId` is provided, filters by that specific item.
  - **Indexing**: Uses `by_project` or `by_project_item` indexes for performance.

- **`updateTask` (Mutation)**
  - **Args**: `taskId` and partial task fields (including `startDate`, `endDate`, `dependencies`).
  - **Logic**:
    - Updates the specified fields.
    - **Duration Handling**: If `estimatedMinutes` is updated, it automatically recalculates `estimatedDuration` (in ms).
    - **Accounting Link**: If `itemId` is set but `accountingSectionId` is missing, it attempts to find and link the corresponding accounting section.

- **`createTask` (Mutation)**
  - **Args**: Full task details.
  - **Logic**:
    - Auto-increments `taskNumber` based on existing tasks in the project.
    - Inserts new task with `createdAt` and `updatedAt` timestamps.

### 3.2 Data Model (`convex/schema.ts`)
The `tasks` table contains the following fields relevant to the Gantt view:

| Field | Type | Description |
|-------|------|-------------|
| `projectId` | `id("projects")` | Parent project reference. |
| `title` | `string` | Task display name. |
| `status` | `string` | `todo`, `in_progress`, `done`, `blocked`. |
| `startDate` | `number` (optional) | Timestamp for task start. |
| `endDate` | `number` (optional) | Timestamp for task end. |
| `estimatedDuration` | `number` (optional) | Duration in milliseconds. |
| `dependencies` | `array<id("tasks")>` | List of parent task IDs this task depends on. |
| `itemId` | `id("projectItems")` | Optional link to a project item (e.g., a room or feature). |
| `taskNumber` | `number` | Sequential identifier for the task. |

## 4. Data Flow & Logic

### 4.1 Loading Sequence
1. `GanttView` mounts.
2. Parallel fetch of `tasks` and `items` via Convex hooks.
3. `useMemo` hook processes the raw data:
   - Creates a Map of `itemId` -> `item.title`.
   - Iterates through tasks, formatting dates and resolving names.
   - Returns `ganttTasks` array to the `Gantt` component.

### 4.2 Update Sequence (Rescheduling)
1. User drags/resizes a task in the UI.
2. `onDateChange` handler (`handleTaskChange`) is triggered.
3. **Primary Update**: Calls `updateTask` for the moved task with new `startDate` and `endDate`.
4. **Dependency Cascade (Frontend Side)**:
   - The code identifies direct children (tasks that have the moved task in their `dependencies`).
   - It iterates through these children.
   - **Logic**: If a child task starts *before* the parent ends, the child is pushed forward.
     - New Child Start = Parent End.
     - New Child End = New Child Start + Original Duration.
   - Calls `updateTask` for each affected child.
   - *Note*: This cascade is currently limited to one level of depth (direct children only) and runs client-side.

## 5. Limitations & Future Considerations
- **Cascade Depth**: The current dependency update logic is shallow (1 level). Deep chains of dependencies won't automatically shift.
- **Server-Side Cascade**: Moving the cascade logic to a Convex mutation would ensure data consistency and handle deep chains more efficiently.
- **Performance**: Client-side mapping is efficient for typical project sizes but might need pagination or windowing for very large projects (1000+ tasks).
