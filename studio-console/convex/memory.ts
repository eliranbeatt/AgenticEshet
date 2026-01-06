import { v } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { callChatWithJsonSchema } from "./lib/openai";
import { z } from "zod";
import { Doc, Id } from "./_generated/dataModel";

// --- Zod Schemas ---

const NanoSummarySchema = z.object({
  element_key: z.string().nullable(),
  facts: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  inputs: z.array(z.string()).default([]),
  todos: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
});

type NanoSummary = z.infer<typeof NanoSummarySchema>;

// --- Constants ---
const NANO_SYSTEM_PROMPT = `You are RunningMemorySummarizer.

Goal: Extract ONLY the NEW information introduced in THIS single interaction (delta-only). Do NOT restate context. Do NOT invent. Be extremely concise.

Return output as VALID JSON ONLY (no markdown, no prose, no code fences). If a category has no items, return an empty array. Keep items short.

Rules:
- Use only information explicitly present in user_text or assistant_text.
- Each item must be <= 12 words.
- Max items per array: facts<=3, decisions<=2, inputs<=3, todos<=3, open_questions<=2.
- Prefer concrete nouns, numbers, names, decisions, constraints, next actions.
- If something is uncertain, phrase as an open_question (not a fact).
- element_key: Use selected_element_key if provided and not empty. Otherwise null.
- Do not include anything about these rules in the output.`;

// --- Public API ---

export const getRunningMemoryMarkdown = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("runningMemoryDocs")
      .withIndex("by_project_key", (q) => q.eq("projectId", args.projectId).eq("docKey", "project"))
      .first();
    return doc?.markdown ?? "";
  },
});

export const getRunningMemoryExcerpt = query({
  args: { projectId: v.id("projects"), elementKey: v.optional(v.string()), limitChars: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("runningMemoryDocs")
      .withIndex("by_project_key", (q) => q.eq("projectId", args.projectId).eq("docKey", "project"))
      .first();

    if (!doc) return "";

    // Simple truncation for now, can be smarter later (e.g. find element section)
    const md = doc.markdown;
    if (args.limitChars && md.length > args.limitChars) {
      return md.slice(0, args.limitChars) + "\n... (truncated)";
    }
    return md;
  },
});

export const appendTurnSummary = internalAction({
  args: {
    projectId: v.id("projects"),
    stage: v.string(),
    channel: v.string(),
    elementContext: v.optional(v.string()), // elementId or name
    userText: v.string(),
    assistantText: v.string(),
    elementName: v.optional(v.string()), // For header formatting
  },
  handler: async (ctx, args) => {
    // 0. Create Agent Run for Visibility
    const runId = await ctx.runMutation(internal.agentRuns.createRun, {
      projectId: args.projectId,
      agent: "memory-summarizer",
      stage: args.stage,
      initialMessage: "Analyzing conversation turn..."
    });
    console.log(`[Memory] Starting summary (RunID: ${runId})`);

    // 1. Run Nano Summarizer
    const userPrompt = `selected_element_key: "${args.elementContext ?? ""}"
stage: "${args.stage}"
channel: "${args.channel}"
user_text:
"""
${args.userText}
"""
assistant_text:
"""
${args.assistantText}
"""`;

    try {
      const nanoSummary = await callChatWithJsonSchema(NanoSummarySchema, {
        systemPrompt: NANO_SYSTEM_PROMPT,
        userPrompt: userPrompt,
        model: "gpt-4o",
        temperature: 0,
      });

      if (!nanoSummary) {
        console.warn("Nano summarizer returned null");
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "failed", error: "LLM returned null summary" });
        return;
      }

      // 2. Append to Markdown (via mutation)
      await ctx.runMutation(internal.memory.internalAppendToDoc, {
        projectId: args.projectId,
        stage: args.stage,
        channel: args.channel,
        nanoSummary: nanoSummary,
        elementName: args.elementName,
        // Pass raw text for structured Q&A
        transcript: args.channel === "structured" ? args.userText : undefined,
      });

      await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Failed to summarize turn:", e);

      await ctx.runMutation(internal.agentRuns.appendEvent, {
        runId,
        level: "error",
        message: `Summarization failed: ${msg}. Attempting fallback...`
      });

      // Fallback: Append raw text if LLM fails
      try {
        await ctx.runMutation(internal.memory.internalAppendToDoc, {
          projectId: args.projectId,
          stage: args.stage,
          channel: args.channel,
          nanoSummary: {
            element_key: null,
            facts: [],
            decisions: [],
            inputs: [],
            todos: [],
            open_questions: []
          }, // Empty summary, but will still log timestamp/stage
          elementName: args.elementName,
          transcript: args.userText + (args.assistantText ? "\n\nAssistant: " + args.assistantText : "")
        });

        await ctx.runMutation(internal.agentRuns.appendEvent, {
          runId,
          level: "warn",
          message: "Fallback: Appended raw transcript."
        });
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "succeeded" });

      } catch (fallbackErr) {
        const fallMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error("Even fallback failed:", fallbackErr);
        await ctx.runMutation(internal.agentRuns.setStatus, { runId, status: "failed", error: "Fallback also failed: " + fallMsg });
      }
    }
  },
});

export const updateRunningMemoryMarkdown = mutation({
  args: {
    projectId: v.id("projects"),
    markdown: v.string(),
  },
  handler: async (ctx, args) => {
    const existingDoc = await ctx.db
      .query("runningMemoryDocs")
      .withIndex("by_project_key", (q) => q.eq("projectId", args.projectId).eq("docKey", "project"))
      .first();

    if (existingDoc) {
      await ctx.db.patch(existingDoc._id, {
        markdown: args.markdown,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("runningMemoryDocs", {
        projectId: args.projectId,
        docKey: "project",
        markdown: args.markdown,
        updatedAt: Date.now(),
      });
    }
  },
});

export const internalAppendToDoc = internalMutation({
  args: {
    projectId: v.id("projects"),
    stage: v.string(),
    channel: v.string(),
    nanoSummary: v.any(), // passed as any from action, cast to NanoSummary
    elementName: v.optional(v.string()),
    transcript: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await appendToDocLogic(ctx, args);
  },
});

export async function appendToDocLogic(
  ctx: { db: any }, // MutationCtx-like
  args: {
    projectId: Id<"projects">;
    stage: string;
    channel: string;
    nanoSummary: any;
    elementName?: string;
    transcript?: string;
  }
) {
  const nano = args.nanoSummary as NanoSummary;
  const tsLocal = new Date().toISOString().slice(0, 16).replace("T", " ");

  // 1. Fetch existing doc
  const existingDoc = await ctx.db
    .query("runningMemoryDocs")
    .withIndex("by_project_key", (q: any) => q.eq("projectId", args.projectId).eq("docKey", "project"))
    .first();

  let md = existingDoc?.markdown ?? "";

  // 2. Format Entry
  md = appendRunningMemory(md, tsLocal, args.stage, args.channel, nano, args.elementName, args.transcript);

  // 3. Save
  if (existingDoc) {
    await ctx.db.patch(existingDoc._id, {
      markdown: md,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("runningMemoryDocs", {
      projectId: args.projectId,
      docKey: "project",
      markdown: md,
      updatedAt: Date.now(),
    });
  }
}


// --- Markdown Append Algorithm (from Spec) ---

function formatEntryBlock(
  tsLocal: string,
  stage: string,
  channel: string,
  s: NanoSummary,
  transcript?: string
): string {
  const lines: string[] = [];
  lines.push(`- [${tsLocal} | ${stage} | ${channel}]`);

  const join = (arr: string[]) => arr.join("; ");

  if (s.facts?.length) lines.push(`  - Facts: ${join(s.facts)}`);
  if (s.decisions?.length) lines.push(`  - Decisions: ${join(s.decisions)}`);
  if (s.inputs?.length) lines.push(`  - Inputs: ${join(s.inputs)}`);
  if (s.todos?.length) lines.push(`  - TODOs: ${join(s.todos)}`);
  if (s.open_questions?.length) lines.push(`  - Open: ${join(s.open_questions)}`);

  if (transcript) {
    lines.push(`  - Transcript:\n    ${transcript.replace(/\n/g, "\n    ")}`);
  }

  // If ALL arrays empty and no transcript, still keep a minimal marker
  if (lines.length === 1) lines.push(`  - Facts: (no new deltas)`);

  return lines.join("\n") + "\n";
}

function ensureBaseDoc(md: string, tsLocal: string): string {
  const trimmed = (md ?? "").trim();
  if (trimmed.length) return md;

  return [
    "# Running Memory (Auto)",
    `_Last updated: ${tsLocal}_`,
    "",
    "## Element: Unassigned",
    ""
  ].join("\n");
}

function updateLastUpdated(md: string, tsLocal: string): string {
  const re = /^_Last updated:\s*.*_$/m;
  if (re.test(md)) return md.replace(re, `_Last updated: ${tsLocal}_`);

  const h1re = /^# .+$/m;
  const m = md.match(h1re);
  if (m && m.index !== undefined) {
    const idx = m.index + m[0].length;
    return md.slice(0, idx) + `\n_Last updated: ${tsLocal}_` + md.slice(idx);
  }
  return `_Last updated: ${tsLocal}_\n` + md;
}

function buildElementHeading(elementKey: string | null, elementName?: string): string {
  if (!elementKey) return "## Element: Unassigned";

  // If your elementKey is like "element:abc123", show it:
  const id = elementKey.includes(":") ? elementKey.split(":")[1] : elementKey;
  const name = (elementName && elementName.trim()) ? elementName.trim() : "Unknown";
  return `## Element: ${name} (${id})`;
}

function findSection(md: string, headingLine: string): { start: number; end: number } | null {
  const idx = md.indexOf("\n" + headingLine + "\n");
  const start = idx >= 0 ? idx + 1 : (md.startsWith(headingLine + "\n") ? 0 : -1);
  if (start < 0) return null;

  const afterStart = start + headingLine.length;
  const nextIdx = md.indexOf("\n## Element:", afterStart);
  const end = nextIdx >= 0 ? nextIdx + 1 : md.length;
  return { start, end };
}

function appendEntryUnderElement(
  md: string,
  headingLine: string,
  entryBlock: string
): string {
  if (!md.endsWith("\n")) md += "\n";

  const sec = findSection(md, headingLine);

  if (!sec) {
    const spacer = md.endsWith("\n\n") ? "" : "\n";
    md += `${spacer}${headingLine}\n\n`;
    md += entryBlock + "\n";
    return md;
  }

  const sectionText = md.slice(sec.start, sec.end);
  const insertionPrefix = sectionText.endsWith("\n\n") ? "" : "\n";
  const insertPos = sec.end;

  return (
    md.slice(0, insertPos) +
    insertionPrefix +
    entryBlock +
    "\n" +
    md.slice(insertPos)
  );
}

function appendRunningMemory(
  existingMd: string,
  tsLocal: string,
  stage: string,
  channel: string,
  nano: NanoSummary,
  elementName?: string,
  transcript?: string
): string {
  let md = ensureBaseDoc(existingMd, tsLocal);
  md = updateLastUpdated(md, tsLocal);

  const heading = buildElementHeading(nano.element_key, elementName);
  const entry = formatEntryBlock(tsLocal, stage, channel, nano, transcript);

  md = appendEntryUnderElement(md, heading, entry);
  return md;
}
