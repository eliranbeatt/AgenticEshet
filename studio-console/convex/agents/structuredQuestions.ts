import { v } from "convex/values";

import { action } from "../_generated/server";
import { z } from "zod";
import { internal, api } from "../_generated/api";

import { callChatWithSchema } from "../lib/openai";

import { StructuredQuestionsTurnSchema } from "../lib/zodSchemas";
import {
    summarizeItems,
    summarizeKnowledgeBlocks,
    summarizeKnowledgeDocs,
    summarizeElementSnapshots,
} from "../lib/contextSummary";
import { buildBrainContext } from "../lib/brainContext";


export const run = action({

    args: {

        projectId: v.id("projects"),

        stage: v.union(v.literal("clarification"), v.literal("planning"), v.literal("solutioning")),

        sessionId: v.id("structuredQuestionSessions"),

        conversationId: v.optional(v.id("projectConversations")),

        runId: v.optional(v.id("agentRuns")),

    },

    handler: async (ctx, args) => {

        const runId = args.runId ?? await ctx.runMutation(internal.agentRuns.createRun, {

            projectId: args.projectId,

            agent: "structured_questions",

            stage: args.stage,

        });



        await ctx.runMutation(internal.agentRuns.setStatus, {

            runId,

            status: "running",

            stage: "generating_questions",

        });

        // 1. Load context (previous turns)

        const turns = await ctx.runQuery(api.structuredQuestions.listTurns, {

            sessionId: args.sessionId,

        });

        // 1.5 Load Project Context
        const project = await ctx.runQuery(api.projects.getProject, { projectId: args.projectId });
        if (!project) throw new Error("Project not found");

        // --- NEW MEMORY SYSTEM ---
        const runningMemory = await ctx.runQuery(api.memory.getRunningMemoryMarkdown, {
            projectId: args.projectId,
        });

        const knowledgeDocs = await ctx.runQuery(api.knowledge.listRecentDocs, {
            projectId: args.projectId,
            limit: 6,
            sourceTypes: ["doc_upload", "plan", "conversation"],
        });

        const { items } = await ctx.runQuery(api.items.listSidebarTree, {
            projectId: args.projectId,
            includeDrafts: true,
        });

        const elementSnapshots = project.features?.elementsCanonical
            ? await ctx.runQuery(internal.elementVersions.getActiveSnapshotsByItemIds, {
                itemIds: items.map((item) => item._id),
            })
            : [];
        const elementSnapshotsSummary = project.features?.elementsCanonical
            ? summarizeElementSnapshots(elementSnapshots, 20)
            : "(none)";

        // 2. Build Prompt
        const systemPrompt = buildSystemPrompt(args.stage, project);
        const userPrompt = buildUserPrompt(turns, {
            elementSnapshotsSummary,
            runningMemory: runningMemory || "(empty)",
            knowledgeDocsSummary: summarizeKnowledgeDocs(knowledgeDocs ?? []),
            itemsSummary: summarizeItems(items ?? []),
        });


        try {

            // 3. Call Model

            const result = await callChatWithSchema(RawStructuredQuestionsTurnSchema, {
                systemPrompt,
                userPrompt,
                model: "gpt-5-mini" // Use a strong model for structured output

            });

            // 4. Save Turn
            const nextTurnNumber = turns.length + 1;

            const normalized = normalizeTurn({
                raw: result,
                stage: args.stage,
                sessionId: args.sessionId,
                turnNumber: nextTurnNumber,
            });

            await ctx.runMutation(internal.structuredQuestions.internal_createTurn, {
                projectId: args.projectId,
                stage: args.stage,
                conversationId: args.conversationId,
                sessionId: args.sessionId,
                turnNumber: nextTurnNumber,
                questions: normalized.questions,
                agentRunId: runId,
            });


            // 5. Update Session

            await ctx.runMutation(internal.structuredQuestions.internal_updateSessionTurn, {

                sessionId: args.sessionId,

                turnNumber: nextTurnNumber,

            });



            await ctx.runMutation(internal.agentRuns.setStatus, {

                runId,

                status: "succeeded",

                stage: "done",

            });



        } catch (error) {

            const message = error instanceof Error ? error.message : String(error);

            await ctx.runMutation(internal.agentRuns.setStatus, {

                runId,

                status: "failed",

                stage: "error",

                error: message,

            });

            throw error;

        }

    },

});

const RawStructuredQuestionSchema = z.object({
    id: z.string().optional(),
    stage: z.enum(["clarification", "planning", "solutioning"]).optional(),
    questionType: z.enum(["boolean", "text"]),
    title: z.string().optional(),
    question: z.string().optional(),
    prompt: z.string().optional(),
    expectsFreeText: z.boolean().optional(),
    blocking: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    elementTags: z.array(z.string()).optional(),
});

const RawStructuredQuestionsTurnSchema = z.object({
    turnId: z.string().optional(),
    questions: z.array(RawStructuredQuestionSchema),
    sessionState: z.object({
        done: z.boolean(),
        nextGoal: z.string().optional(),
    }),
});

function normalizeTurn(args: {
    raw: z.infer<typeof RawStructuredQuestionsTurnSchema>;
    stage: "clarification" | "planning" | "solutioning";
    sessionId: string;
    turnNumber: number;
}) {
    const turnId = args.raw.turnId ?? `turn_${args.sessionId}_${args.turnNumber}`;
    const questions = args.raw.questions.map((q, index) => {
        const title = q.title ?? q.question ?? `Question ${index + 1}`;
        const expectsFreeText =
            typeof q.expectsFreeText === "boolean" ? q.expectsFreeText : q.questionType === "text";
        const blocking = typeof q.blocking === "boolean" ? q.blocking : false;
        return {
            id: q.id ?? `q_${args.turnNumber}_${index + 1}`,
            stage: q.stage ?? args.stage,
            questionType: q.questionType,
            title,
            prompt: q.prompt,
            expectsFreeText,
            blocking,
            tags: q.tags ?? q.elementTags,
        };
    });

    return StructuredQuestionsTurnSchema.parse({
        turnId,
        questions,
        sessionState: args.raw.sessionState,
    });
}

function buildSystemPrompt(stage: string, project: any) {
    const projectContext = `

PROJECT CONTEXT:

Name: ${project.name}

Client: ${project.clientName}

Overview: ${JSON.stringify(project.overview || {}, null, 2)}

Details: ${JSON.stringify(project.details || {}, null, 2)}

Summary: ${project.overviewSummary || "None"}

`;



    const base = `You are an expert studio producer for 'Emily Studio'.
Your goal is to ask structured questions to clarify the project requirements in an ELEMENT-FIRST way (אלמנטים).

${projectContext}
    
RULES:
1) Return 1 to 4 questions only.
2) You MUST return JSON matching the schema below.
3) At least 2 questions per turn must be questionType="boolean" (when possible).
4) Do NOT ask anything already answered.
5) Ask highest-leverage blockers first: dates/windows, venue access/rules, approvals/safety, and missing element sizes/qty/finish.
6) Efficiency: set sessionState.done=true ONLY when:
   - install/shoot/strike dates are known OR explicitly "TBD but flexible",
   - venue constraints/access are known OR explicitly unknown with assumptions,
   - top 3 elements have enough info to plan (size/qty/finish tier),
   - and user says they have no more info OR wants to proceed.
7) Always try to attach a question to a specific element when relevant (tag it with element-like tags: ["element:floor","element:prop","element:branding"]).

OUTPUT JSON SCHEMA (EXACT KEYS):
{
  "turnId": "string",
  "questions": [
    {
      "id": "string",
      "stage": "clarification|planning|solutioning",
      "questionType": "boolean|text",
      "title": "string",
      "prompt": "string (optional)",
      "expectsFreeText": true|false,
      "blocking": true|false,
      "tags": ["element:prop","element:installation"]
    }
  ],
  "sessionState": { "done": true|false, "nextGoal": "string (optional)" }
}

Do NOT use keys named "question" or "elementTags".
`;


    let stagePrompt = "";



    if (stage === "clarification") {

        stagePrompt = `

Stage: CLARIFICATION (Ideation / Initial Scope)

You are the CLARIFICATION AGENT for Emily Studio projects. Your job is to ask the smallest number of high-impact questions needed to produce a realistic initial plan and item breakdown.



REASONING STEPS:

- Step 1: Identify what’s already known from overview + docs.

- Step 2: Identify missing blockers for planning:

  - dimensions/quantities

  - deadlines/install/shoot windows

  - what is fixed vs flexible (budget/look/time)

  - approvals and who decides

  - what is already owned vs must buy/rent

  - logistics constraints (parking, elevator, access times)

- Step 3: Ask only what affects the plan structure and critical path.



REQUIRED QUESTION THEMES:

- requiresStudioProduction: ask about finishes, durability, weight limits, workshop constraints.

- requiresPurchases: ask about preferred sourcing (local/abroad), lead time tolerance, vendor constraints.

- requiresRentals: ask about rental categories (furniture/lighting/AV) and return timing.

- requiresMoving: ask about access, vehicle size limits, load-in/out times, packaging constraints.

- requiresInstallation: ask about crew size, install window, venue safety requirements.

- includesShootDay: ask about camera constraints (seams/reflections/lighting control).

- includesManagementFee: ask about approvals cadence, meetings, stakeholder list.

`;

    } else if (stage === "planning") {

        stagePrompt = `

Stage: PLANNING

You are the PLANNING AGENT. Your mission is to turn the project overview + clarification transcript + existing items into an initial operational plan that is structured inside Items and Tasks.

You think like a senior producer for a set-design studio: you think in terms of procurement, studio fabrication, packaging, logistics, installation, shoot-day readiness, dismantle/returns, and admin coordination.



REASONING STEPS:

1) Read project overview selections and treat them as triggers for plan structure.

2) Read clarification answers; extract:

   - hard dates

   - deliverables list

   - constraints per item

3) Ensure item coverage:

   - deliverables exist as items

   - services/days/fees exist as items when required (moving/install/dismantle/shoot/management)

4) For each item:

   - create a minimal but complete task chain:

     - design/measurement → sourcing → build/produce → QA → pack → move → install → shoot support → dismantle/return

   - tag tasks by type (studio/purchase/rental/install/admin)



REQUIRED TEMPLATE ITEMS (Verify if these are needed):

- requiresMoving=true => ensure a “Moving / Transport” service item exists

- requiresInstallation=true => ensure “Installation Day” day/service item exists

- requiresDismantle=true => ensure “Dismantle / Return” item exists

- includesShootDay=true => ensure “Shoot Day Support” day item exists

- includesManagementFee=true => ensure “Management / Production Fee” fee item exists



TASK CREATION RULES (Use these to guide your questions):

- Always include at least:

  - Measurements / requirements confirmation

  - Vendor outreach / sourcing

  - Production/build steps (if studio)

  - QA + packing

  - On-site setup (if install)

  - Strike / return (if dismantle/rental)

`;

    } else if (stage === "solutioning") {

        stagePrompt = `

Stage: SOLUTIONING

You are the SOLUTIONING AGENT. Your job is to turn the plan into executable build guidance and structured material/labor inputs for each item subtask.

You think like a master fabricator + producer: strong methods, efficient builds, realistic materials, safety, finish quality, modularity for transport, and venue constraints. You may propose multiple options (budget/standard/premium).



REASONING STEPS:

1) For each item: read flags (studio/purchase/rental/moving/install) and constraints.

2) Decide build method(s) that match quality tier and timeline.

3) For each key task:

   - identify required materials (name, estimated qty, unit)

   - identify labor roles (builder, painter, installer, assistant) and rough hours

   - identify tools/equipment and safety notes

4) Identify critical lead-time risks and propose alternatives.



REQUIRED HANDLING:

- requiresStudioProduction: include fabrication workflow: cut/build → reinforce → surface prep → paint/finish → dry time → QA → packing

- requiresPurchases: include purchasing lines with lead time and “purchaseStatus=planned”; propose local alternatives when schedule is tight

- requiresRentals: include rental lines (deposit/return window notes)

- requiresMoving: include packing materials and moving labor allowances

- requiresInstallation: include install hardware, anchors, safety checks, onsite tools

- includesShootDay: include touch-up kit, standby labor, camera-facing adjustments

- requiresDismantle: include strike plan, disposal/return labor, damage risk planning

`;

    }



    return base + "\n" + stagePrompt;

}



function buildUserPrompt(turns: any[], context: {
    elementSnapshotsSummary: string;
    runningMemory: string;
    knowledgeDocsSummary: string;
    itemsSummary: string;
}) {
    if (turns.length === 0) {
        return [
            "Start the questioning session. Ask the most critical initial questions.",
            "",
            "ELEMENT SNAPSHOTS (CANONICAL - OVERRIDES KNOWLEDGE/CHAT):",
            context.elementSnapshotsSummary,
            "",
            "RUNNING MEMORY (AUTHORITATIVE):",
            context.runningMemory,
            "",
            "RECENT KNOWLEDGE DOCS:",
            context.knowledgeDocsSummary,
            "",
            "CURRENT ITEMS SUMMARY:",
            context.itemsSummary,
        ].join("\n");
    }


    const history = turns.map(t => {

        return `Turn ${t.turnNumber}:

Questions:

${t.questions.map((q: any) => `- ${q.title} (${q.questionType})`).join("\n")}

Answers:

${t.answers ? t.answers.map((a: any) => `- [${a.quick}] ${a.text || ""}`).join("\n") : "No answers yet"}

User Instructions: ${t.userInstructions || "None"}`;

    }).join("\n\n");



    return [
        "Here is the history of the session so far:",
        "",
        history,
        "",
        "ELEMENT SNAPSHOTS (CANONICAL - OVERRIDES KNOWLEDGE/CHAT):",
        context.elementSnapshotsSummary,
        "",
        "RUNNING MEMORY (AUTHORITATIVE):",
        context.runningMemory,
        "",
        "RECENT KNOWLEDGE DOCS:",
        context.knowledgeDocsSummary,
        "",
        "CURRENT ITEMS SUMMARY:",
        context.itemsSummary,
        "",
        "Based on these answers and instructions, generate the next batch of questions.",
    ].join("\n");
}
