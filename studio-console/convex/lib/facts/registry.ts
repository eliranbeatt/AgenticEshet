export const BLOCK_KEY_ENUM = [
  "project.summary",
  "project.constraints",
  "project.logistics",
  "project.timeline",
  "project.budget",
  "project.decisions",
  "project.openQuestions",
  "item.summary",
  "item.dimensions",
  "item.materials",
  "item.production",
  "item.installation",
  "item.logistics",
  "item.constraints",
  "item.decisions",
  "item.openQuestions",
] as const;

export type BlockKey = typeof BLOCK_KEY_ENUM[number];

export interface FactKeyDefinition {
  valueType: "string" | "number" | "boolean" | "date" | "currency" | "dimension" | "enum";
  blockKey: BlockKey;
  risk: "low" | "medium" | "high";
  description: string;
}

export const FACT_KEY_REGISTRY: Record<string, FactKeyDefinition> = {
  // Project Level
  "project.summary.goal": {
    valueType: "string",
    blockKey: "project.summary",
    risk: "low",
    description: "The main goal or objective of the project",
  },
  "project.summary.theme": {
    valueType: "string",
    blockKey: "project.summary",
    risk: "low",
    description: "Visual theme or concept",
  },
  "project.constraints.budget_cap": {
    valueType: "currency",
    blockKey: "project.budget",
    risk: "high",
    description: "Maximum budget allowed",
  },
  "project.constraints.deadline": {
    valueType: "date",
    blockKey: "project.timeline",
    risk: "high",
    description: "Hard deadline for the project",
  },
  "project.constraints.safety": {
    valueType: "string",
    blockKey: "project.constraints",
    risk: "high",
    description: "Safety requirements or hazards",
  },
  "project.logistics.location": {
    valueType: "string",
    blockKey: "project.logistics",
    risk: "medium",
    description: "Event or installation location",
  },
  "project.logistics.access": {
    valueType: "string",
    blockKey: "project.logistics",
    risk: "medium",
    description: "Access restrictions (stairs, elevator, hours)",
  },
  
  // Item Level (Generic keys that apply to any item)
  "item.dimensions.width": {
    valueType: "dimension",
    blockKey: "item.dimensions",
    risk: "medium",
    description: "Width of the item",
  },
  "item.dimensions.height": {
    valueType: "dimension",
    blockKey: "item.dimensions",
    risk: "medium",
    description: "Height of the item",
  },
  "item.dimensions.depth": {
    valueType: "dimension",
    blockKey: "item.dimensions",
    risk: "medium",
    description: "Depth of the item",
  },
  "item.materials.primary": {
    valueType: "string",
    blockKey: "item.materials",
    risk: "medium",
    description: "Primary material used",
  },
  "item.production.method": {
    valueType: "string",
    blockKey: "item.production",
    risk: "medium",
    description: "How the item is produced (print, carpentry, etc)",
  },
};

export const HIGH_RISK_KEYS = Object.entries(FACT_KEY_REGISTRY)
  .filter(([_, def]) => def.risk === "high")
  .map(([key]) => key);
