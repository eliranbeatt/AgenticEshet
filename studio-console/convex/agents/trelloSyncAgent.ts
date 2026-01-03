import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { callChatWithSchema } from "../lib/openai";
import { z } from "zod";
import type { Doc } from "../_generated/dataModel";
import type { TrelloMappingDoc } from "../trelloSync"; // We will ensure this type is exported or redefine it
import { TrelloSyncPlan } from "../lib/trelloTypes";

// Zod Schema matching TrelloSyncPlan
const TrelloOpSchema = z.discriminatedUnion("op", [
  z.object({
    opId: z.string(),
    op: z.literal("ENSURE_BOARD"),
    setVar: z.string().optional(),
    board: z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      idOrganization: z.string().optional(),
      defaultLists: z.boolean().optional(),
    }).optional(),
    ifMissing: z.enum(["create", "error"]),
  }),
  z.object({
    opId: z.string(),
    op: z.literal("ENSURE_LIST"),
    boardId: z.string(),
    list: z.object({ id: z.string().optional(), name: z.string(), pos: z.union([z.string(), z.number()]).optional() }),
    setVar: z.string().optional(),
  }),
  z.object({
    opId: z.string(),
    op: z.literal("ENSURE_LABEL"),
    boardId: z.string(),
    label: z.object({ id: z.string().optional(), name: z.string(), color: z.string().nullable().optional() }),
    setVar: z.string().optional(),
  }),
  z.object({
    opId: z.string(),
    op: z.literal("ENSURE_CUSTOM_FIELD"),
    boardId: z.string(),
    field: z.object({
      id: z.string().optional(),
      name: z.string(),
      type: z.enum(["number", "text", "date", "checkbox", "list"]),
      pos: z.union([z.string(), z.number()]).optional(),
      displayOnCardFront: z.boolean().optional(),
    }),
    setVar: z.string().optional(),
  }),
  z.object({
    opId: z.string(),
    op: z.literal("UPSERT_CARD"),
    taskId: z.string(),
    boardId: z.string(),
    listId: z.string(),
    card: z.object({
      id: z.string().optional(),
      name: z.string(),
      desc: z.string().optional(),
      start: z.string().nullable().optional(),
      due: z.string().nullable().optional(),
      dueComplete: z.boolean().optional(),
      pos: z.union([z.string(), z.number()]).optional(),
      labelIds: z.array(z.string()).optional(),
      memberIds: z.array(z.string()).optional(),
    }),
    mode: z.literal("create_or_update"),
    setVar: z.string().optional(),
    contentHash: z.string(),
  }),
  z.object({
    opId: z.string(),
    op: z.literal("ENSURE_CHECKLIST_ON_CARD"),
    cardId: z.string(),
    checklist: z.object({ id: z.string().optional(), name: z.string(), pos: z.union([z.string(), z.number()]).optional() }),
    setVar: z.string().optional(),
  }),
  z.object({
    opId: z.string(),
    op: z.literal("UPSERT_CHECKITEMS"),
    cardId: z.string(),
    checklistId: z.string(),
    items: z.array(z.object({ name: z.string(), checked: z.boolean().optional(), due: z.string().nullable().optional() })),
    mode: z.literal("merge_by_name"),
  }),
  z.object({
    opId: z.string(),
    op: z.literal("SET_CUSTOM_FIELD_NUMBER"),
    cardId: z.string(),
    customFieldId: z.string(),
    value: z.number().nullable(),
  }),
  z.object({
    opId: z.string(),
    op: z.literal("SKIP"),
    taskId: z.string().optional(),
    reason: z.string(),
  }),
]);

const TrelloSyncPlanSchemaStrict = z.object({
  planVersion: z.literal("1.0"),
  context: z.object({
    projectId: z.string(),
    targetBoardId: z.string().optional(),
    targetBoardName: z.string().optional(),
  }),
  warnings: z.array(z.string()).optional(),
  operations: z.array(TrelloOpSchema),
  mappingUpserts: z.array(z.object({
    taskId: z.string(),
    trelloCardIdVarOrValue: z.string(),
    trelloListIdVarOrValue: z.string(),
    contentHash: z.string(),
  })).optional(),
});

const TrelloSyncPlanSchemaLenient = z.object({
  planVersion: z.any().optional(),
  context: z.any().optional(),
  warnings: z.array(z.string()).optional(),
  operations: z.array(z.any()).optional(),
  mappingUpserts: z.array(z.any()).optional(),
}).passthrough();

export function buildTrelloSyncPlanSchema(projectId: string) {
  return z.preprocess((input) => {
    if (!input || typeof input !== "object") return input;
    const raw = input as Record<string, any>;
    const plan: Record<string, any> = { ...raw };

    if (
      plan.planVersion === undefined ||
      plan.planVersion === null ||
      plan.planVersion === 1 ||
      plan.planVersion === 1.0 ||
      plan.planVersion === "1" ||
      plan.planVersion === "v1.0"
    ) {
      plan.planVersion = "1.0";
    } else if (typeof plan.planVersion === "number") {
      plan.planVersion = String(plan.planVersion);
    }

    if (!plan.context || typeof plan.context !== "object") {
      plan.context = { projectId };
    } else if (!plan.context.projectId) {
      plan.context.projectId = projectId;
    }

    if (Array.isArray(plan.operations)) {
      plan.operations = plan.operations.map((op) => {
        if (op && typeof op === "object" && !op.op) {
          const source = (op as any).type ?? (op as any).operation ?? (op as any).action;
          if (source) {
            return { ...op, op: source };
          }
        }
        return op;
      });
    }

    return plan;
  }, TrelloSyncPlanSchemaStrict);
}

const SYSTEM_PROMPT = `You are "TrelloSyncTranslator", an expert integration agent.

Goal:
Translate Convex Task documents into a deterministic TrelloSyncPlan JSON that an executor will run against Trello’s REST API.

CRITICAL: OUTPUT FORMAT RULES
1. The root object MUST contain "planVersion": "1.0" and a "context" object.
2. The "operations" array MUST contain objects with an "op" field (NOT "type").
3. "ENSURE_LIST" requires a nested "list" object: { op: "ENSURE_LIST", list: { name: "..." }, ... }
4. "UPSERT_CARD" requires a nested "card" object.
5. "UPSERT_CARD" MUST include "contentHash".

Example Output Structure:
{
  "planVersion": "1.0",
  "context": { "projectId": "p123", "targetBoardId": "b456" },
  "operations": [
    {
      "opId": "op1",
      "op": "ENSURE_LIST",
      "boardId": "b456",
      "list": { "name": "To Do" },
      "setVar": "list.todo"
    },
    {
      "opId": "op2",
      "op": "UPSERT_CARD",
      "taskId": "t1",
      "boardId": "b456",
      "listId": "$list.todo",
      "card": { "name": "Buy Milk" },
      "mode": "create_or_update",
      "contentHash": "abc123hash"
    }
  ],
  "mappingUpserts": []
}

Mapping rules (default):
- Project → board.
- status → list (todo/in_progress/blocked/done).
- category/priority/tags/workstream/isManagement → labels.
- task.subtasks → checklist "Subtasks".
- task.steps → checklist "Steps".
- estimates → custom field "Estimate (hours)" when available.
- dates → card.start + card.due in ISO.

You receive:
- tasks[]
- existing trelloMappings[]
- trelloContext: boardId, known lists/labels/customFields/member mapping
- config overrides (optional)

You produce:
- TrelloSyncPlan with ordered operations:
  1) ensure lists exist (ENSURE_LIST)
  2) ensure labels exist (ENSURE_LABEL)
  3) ensure custom fields exist (ENSURE_CUSTOM_FIELD)
  4) upsert cards (UPSERT_CARD)
  5) upsert checklists + checkitems (ENSURE_CHECKLIST_ON_CARD, UPSERT_CHECKITEMS)
  6) set custom field values (SET_CUSTOM_FIELD_NUMBER)
  7) update trelloMappings patch suggestions (via mappingUpserts)

If something is impossible (e.g., assignee email not mapped to Trello member id), emit a WARNING in plan.warnings and skip member assignment.`;

export const generateTrelloSyncPlan = internalAction({
  args: {
    projectId: v.id("projects"),
    tasks: v.array(v.any()), // typing as any to avoid complex nested validation here, validated by runtime schema
    trelloMappings: v.array(v.any()),
    trelloContext: v.object({
      boardId: v.string(),
      listsByStatus: v.optional(v.any()),
      labelsByName: v.optional(v.any()),
      customFieldsByName: v.optional(v.any()),
    }),
    config: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userPrompt = JSON.stringify({
      projectId: args.projectId,
      tasks: args.tasks,
      trelloMappings: args.trelloMappings,
      trelloContext: args.trelloContext,
      config: args.config,
    });

    const rawResult = await callChatWithSchema(TrelloSyncPlanSchemaLenient, {
      model: "gpt-4o", // Strong model for complex logic
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: userPrompt,
      language: "en",
    });

    const normalized = buildTrelloSyncPlanSchema(args.projectId).parse(rawResult);
    return normalized as TrelloSyncPlan;
  },
});
