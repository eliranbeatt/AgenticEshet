export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_CATEGORIES = ["Logistics", "Creative", "Finance", "Admin", "Studio"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_PRIORITIES = ["High", "Medium", "Low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const STUDIO_PHASES = ["plan", "buy", "build", "install", "closeout"] as const;
export type StudioPhase = (typeof STUDIO_PHASES)[number];

export const TRELLO_API_BASE = "https://api.trello.com";
