/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounting from "../accounting.js";
import type * as admin from "../admin.js";
import type * as agentRuns from "../agentRuns.js";
import type * as agents_accountingFromDeepResearch from "../agents/accountingFromDeepResearch.js";
import type * as agents_accountingGenerator from "../agents/accountingGenerator.js";
import type * as agents_architect from "../agents/architect.js";
import type * as agents_clarification from "../agents/clarification.js";
import type * as agents_clarificationV2 from "../agents/clarificationV2.js";
import type * as agents_convertIdeas from "../agents/convertIdeas.js";
import type * as agents_deepResearch from "../agents/deepResearch.js";
import type * as agents_estimator from "../agents/estimator.js";
import type * as agents_flow from "../agents/flow.js";
import type * as agents_ideation from "../agents/ideation.js";
import type * as agents_planning from "../agents/planning.js";
import type * as agents_quote from "../agents/quote.js";
import type * as agents_solutioning from "../agents/solutioning.js";
import type * as agents_solutioningV2 from "../agents/solutioningV2.js";
import type * as agents_structuredQuestions from "../agents/structuredQuestions.js";
import type * as agents_taskEditor from "../agents/taskEditor.js";
import type * as agents_taskRefiner from "../agents/taskRefiner.js";
import type * as assets from "../assets.js";
import type * as backfill from "../backfill.js";
import type * as buying from "../buying.js";
import type * as changeSets from "../changeSets.js";
import type * as chat from "../chat.js";
import type * as clarificationDocs from "../clarificationDocs.js";
import type * as constants from "../constants.js";
import type * as conversations from "../conversations.js";
import type * as costPlanDocs from "../costPlanDocs.js";
import type * as currentState from "../currentState.js";
import type * as deepResearch from "../deepResearch.js";
import type * as drive from "../drive.js";
import type * as facts from "../facts.js";
import type * as flowWorkspaces from "../flowWorkspaces.js";
import type * as http from "../http.js";
import type * as ideaSelections from "../ideaSelections.js";
import type * as ideation from "../ideation.js";
import type * as inbox from "../inbox.js";
import type * as ingestion from "../ingestion.js";
import type * as items from "../items.js";
import type * as itemsMigrations from "../itemsMigrations.js";
import type * as itemsProjection from "../itemsProjection.js";
import type * as knowledge from "../knowledge.js";
import type * as knowledgeDiagnostics from "../knowledgeDiagnostics.js";
import type * as lib_architectTaskGeneration from "../lib/architectTaskGeneration.js";
import type * as lib_contextSummary from "../lib/contextSummary.js";
import type * as lib_costing from "../lib/costing.js";
import type * as lib_currentState from "../lib/currentState.js";
import type * as lib_facts_apply from "../lib/facts/apply.js";
import type * as lib_facts_prompts from "../lib/facts/prompts.js";
import type * as lib_facts_reconcile from "../lib/facts/reconcile.js";
import type * as lib_facts_registry from "../lib/facts/registry.js";
import type * as lib_facts_schemas from "../lib/facts/schemas.js";
import type * as lib_facts_verify from "../lib/facts/verify.js";
import type * as lib_fileParsers from "../lib/fileParsers.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_geminiImages from "../lib/geminiImages.js";
import type * as lib_geminiInteractions from "../lib/geminiInteractions.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_itemHelpers from "../lib/itemHelpers.js";
import type * as lib_itemProjections from "../lib/itemProjections.js";
import type * as lib_itemRollups from "../lib/itemRollups.js";
import type * as lib_knowledgeBlocks_patch from "../lib/knowledgeBlocks/patch.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_openaiImages from "../lib/openaiImages.js";
import type * as lib_projects from "../lib/projects.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_textChunker from "../lib/textChunker.js";
import type * as lib_zodSchemas from "../lib/zodSchemas.js";
import type * as management from "../management.js";
import type * as migrations from "../migrations.js";
import type * as prices from "../prices.js";
import type * as projects from "../projects.js";
import type * as prompts_flowPromptPack from "../prompts/flowPromptPack.js";
import type * as prompts_itemsPromptPack from "../prompts/itemsPromptPack.js";
import type * as quests from "../quests.js";
import type * as quotes from "../quotes.js";
import type * as rateLimit from "../rateLimit.js";
import type * as research from "../research.js";
import type * as scenarios from "../scenarios.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as structuredQuestions from "../structuredQuestions.js";
import type * as tasks from "../tasks.js";
import type * as trelloSync from "../trelloSync.js";
import type * as turnBundles from "../turnBundles.js";
import type * as whatsapp from "../whatsapp.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounting: typeof accounting;
  admin: typeof admin;
  agentRuns: typeof agentRuns;
  "agents/accountingFromDeepResearch": typeof agents_accountingFromDeepResearch;
  "agents/accountingGenerator": typeof agents_accountingGenerator;
  "agents/architect": typeof agents_architect;
  "agents/clarification": typeof agents_clarification;
  "agents/clarificationV2": typeof agents_clarificationV2;
  "agents/convertIdeas": typeof agents_convertIdeas;
  "agents/deepResearch": typeof agents_deepResearch;
  "agents/estimator": typeof agents_estimator;
  "agents/flow": typeof agents_flow;
  "agents/ideation": typeof agents_ideation;
  "agents/planning": typeof agents_planning;
  "agents/quote": typeof agents_quote;
  "agents/solutioning": typeof agents_solutioning;
  "agents/solutioningV2": typeof agents_solutioningV2;
  "agents/structuredQuestions": typeof agents_structuredQuestions;
  "agents/taskEditor": typeof agents_taskEditor;
  "agents/taskRefiner": typeof agents_taskRefiner;
  assets: typeof assets;
  backfill: typeof backfill;
  buying: typeof buying;
  changeSets: typeof changeSets;
  chat: typeof chat;
  clarificationDocs: typeof clarificationDocs;
  constants: typeof constants;
  conversations: typeof conversations;
  costPlanDocs: typeof costPlanDocs;
  currentState: typeof currentState;
  deepResearch: typeof deepResearch;
  drive: typeof drive;
  facts: typeof facts;
  flowWorkspaces: typeof flowWorkspaces;
  http: typeof http;
  ideaSelections: typeof ideaSelections;
  ideation: typeof ideation;
  inbox: typeof inbox;
  ingestion: typeof ingestion;
  items: typeof items;
  itemsMigrations: typeof itemsMigrations;
  itemsProjection: typeof itemsProjection;
  knowledge: typeof knowledge;
  knowledgeDiagnostics: typeof knowledgeDiagnostics;
  "lib/architectTaskGeneration": typeof lib_architectTaskGeneration;
  "lib/contextSummary": typeof lib_contextSummary;
  "lib/costing": typeof lib_costing;
  "lib/currentState": typeof lib_currentState;
  "lib/facts/apply": typeof lib_facts_apply;
  "lib/facts/prompts": typeof lib_facts_prompts;
  "lib/facts/reconcile": typeof lib_facts_reconcile;
  "lib/facts/registry": typeof lib_facts_registry;
  "lib/facts/schemas": typeof lib_facts_schemas;
  "lib/facts/verify": typeof lib_facts_verify;
  "lib/fileParsers": typeof lib_fileParsers;
  "lib/gemini": typeof lib_gemini;
  "lib/geminiImages": typeof lib_geminiImages;
  "lib/geminiInteractions": typeof lib_geminiInteractions;
  "lib/hash": typeof lib_hash;
  "lib/itemHelpers": typeof lib_itemHelpers;
  "lib/itemProjections": typeof lib_itemProjections;
  "lib/itemRollups": typeof lib_itemRollups;
  "lib/knowledgeBlocks/patch": typeof lib_knowledgeBlocks_patch;
  "lib/openai": typeof lib_openai;
  "lib/openaiImages": typeof lib_openaiImages;
  "lib/projects": typeof lib_projects;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/textChunker": typeof lib_textChunker;
  "lib/zodSchemas": typeof lib_zodSchemas;
  management: typeof management;
  migrations: typeof migrations;
  prices: typeof prices;
  projects: typeof projects;
  "prompts/flowPromptPack": typeof prompts_flowPromptPack;
  "prompts/itemsPromptPack": typeof prompts_itemsPromptPack;
  quests: typeof quests;
  quotes: typeof quotes;
  rateLimit: typeof rateLimit;
  research: typeof research;
  scenarios: typeof scenarios;
  seed: typeof seed;
  settings: typeof settings;
  structuredQuestions: typeof structuredQuestions;
  tasks: typeof tasks;
  trelloSync: typeof trelloSync;
  turnBundles: typeof turnBundles;
  whatsapp: typeof whatsapp;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
