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
import type * as agentSuggestionSets from "../agentSuggestionSets.js";
import type * as agents_accountingFromDeepResearch from "../agents/accountingFromDeepResearch.js";
import type * as agents_accountingGenerator from "../agents/accountingGenerator.js";
import type * as agents_architect from "../agents/architect.js";
import type * as agents_brainUpdater from "../agents/brainUpdater.js";
import type * as agents_clarification from "../agents/clarification.js";
import type * as agents_clarificationV2 from "../agents/clarificationV2.js";
import type * as agents_controller from "../agents/controller.js";
import type * as agents_convertIdeas from "../agents/convertIdeas.js";
import type * as agents_deepResearch from "../agents/deepResearch.js";
import type * as agents_estimator from "../agents/estimator.js";
import type * as agents_flow from "../agents/flow.js";
import type * as agents_ideation from "../agents/ideation.js";
import type * as agents_inputs from "../agents/inputs.js";
import type * as agents_itemPopulator from "../agents/itemPopulator.js";
import type * as agents_orchestrator from "../agents/orchestrator.js";
import type * as agents_patchMapper from "../agents/patchMapper.js";
import type * as agents_planner from "../agents/planner.js";
import type * as agents_planning from "../agents/planning.js";
import type * as agents_quote from "../agents/quote.js";
import type * as agents_rules from "../agents/rules.js";
import type * as agents_skillRunner from "../agents/skillRunner.js";
import type * as agents_skills from "../agents/skills.js";
import type * as agents_solutioning from "../agents/solutioning.js";
import type * as agents_solutioningV2 from "../agents/solutioningV2.js";
import type * as agents_structuredQuestions from "../agents/structuredQuestions.js";
import type * as agents_suggestions from "../agents/suggestions.js";
import type * as agents_summary from "../agents/summary.js";
import type * as agents_taskEditor from "../agents/taskEditor.js";
import type * as agents_taskRefiner from "../agents/taskRefiner.js";
import type * as agents_trelloSyncAgent from "../agents/trelloSyncAgent.js";
import type * as assets from "../assets.js";
import type * as backfill from "../backfill.js";
import type * as brainEvents from "../brainEvents.js";
import type * as brainRuns from "../brainRuns.js";
import type * as buying from "../buying.js";
import type * as changeSets from "../changeSets.js";
import type * as chat from "../chat.js";
import type * as clarificationDocs from "../clarificationDocs.js";
import type * as constants from "../constants.js";
import type * as conversations from "../conversations.js";
import type * as costPlanDocs from "../costPlanDocs.js";
import type * as currentState from "../currentState.js";
import type * as deepResearch from "../deepResearch.js";
import type * as derivations from "../derivations.js";
import type * as drive from "../drive.js";
import type * as elementDrafts from "../elementDrafts.js";
import type * as elementPipelineMigrations from "../elementPipelineMigrations.js";
import type * as elementVersions from "../elementVersions.js";
import type * as facts from "../facts.js";
import type * as factsPipeline from "../factsPipeline.js";
import type * as factsV2 from "../factsV2.js";
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
import type * as lib_brainContext from "../lib/brainContext.js";
import type * as lib_brainPatch from "../lib/brainPatch.js";
import type * as lib_contextSummary from "../lib/contextSummary.js";
import type * as lib_costing from "../lib/costing.js";
import type * as lib_currentState from "../lib/currentState.js";
import type * as lib_elementDigest from "../lib/elementDigest.js";
import type * as lib_elementProjections from "../lib/elementProjections.js";
import type * as lib_elementRegistry from "../lib/elementRegistry.js";
import type * as lib_elementSerializer from "../lib/elementSerializer.js";
import type * as lib_elementSnapshots from "../lib/elementSnapshots.js";
import type * as lib_factsV2_prompts from "../lib/factsV2/prompts.js";
import type * as lib_factsV2_verify from "../lib/factsV2/verify.js";
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
import type * as lib_jsonSchema from "../lib/jsonSchema.js";
import type * as lib_knowledgeBlocks_patch from "../lib/knowledgeBlocks/patch.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_openaiImages from "../lib/openaiImages.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_projects from "../lib/projects.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_skills from "../lib/skills.js";
import type * as lib_textChunker from "../lib/textChunker.js";
import type * as lib_trelloExecutor from "../lib/trelloExecutor.js";
import type * as lib_trelloTypes from "../lib/trelloTypes.js";
import type * as lib_zodSchemas from "../lib/zodSchemas.js";
import type * as management from "../management.js";
import type * as memory from "../memory.js";
import type * as migrations from "../migrations.js";
import type * as migrators from "../migrators.js";
import type * as prices from "../prices.js";
import type * as printing from "../printing.js";
import type * as printingQuery from "../printingQuery.js";
import type * as projectBrain from "../projectBrain.js";
import type * as projectConversations from "../projectConversations.js";
import type * as projectWorkspaces from "../projectWorkspaces.js";
import type * as projections from "../projections.js";
import type * as projects from "../projects.js";
import type * as prompts_flowPromptPack from "../prompts/flowPromptPack.js";
import type * as prompts_itemsPromptPack from "../prompts/itemsPromptPack.js";
import type * as questionQueue from "../questionQueue.js";
import type * as quests from "../quests.js";
import type * as quotes from "../quotes.js";
import type * as rateLimit from "../rateLimit.js";
import type * as registry from "../registry.js";
import type * as research from "../research.js";
import type * as revisions from "../revisions.js";
import type * as scenarios from "../scenarios.js";
import type * as scripts_check_memory from "../scripts/check_memory.js";
import type * as scripts_check_skill from "../scripts/check_skill.js";
import type * as scripts_debug_save_answers from "../scripts/debug_save_answers.js";
import type * as scripts_test_changeset_flow from "../scripts/test_changeset_flow.js";
import type * as scripts_test_controller_flow from "../scripts/test_controller_flow.js";
import type * as scripts_test_helpers from "../scripts/test_helpers.js";
import type * as scripts_test_suggestions_flow from "../scripts/test_suggestions_flow.js";
import type * as scripts_test_trello_flow from "../scripts/test_trello_flow.js";
import type * as scripts_test_ui_persistence from "../scripts/test_ui_persistence.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as skills_seed from "../skills/seed.js";
import type * as structuredQuestions from "../structuredQuestions.js";
import type * as suggestions from "../suggestions.js";
import type * as tasks from "../tasks.js";
import type * as trello from "../trello.js";
import type * as trelloActions from "../trelloActions.js";
import type * as trelloQuery from "../trelloQuery.js";
import type * as trelloSync from "../trelloSync.js";
import type * as turnBundles from "../turnBundles.js";
import type * as verify_fix from "../verify_fix.js";
import type * as verify_fix_mutation from "../verify_fix_mutation.js";
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
  agentSuggestionSets: typeof agentSuggestionSets;
  "agents/accountingFromDeepResearch": typeof agents_accountingFromDeepResearch;
  "agents/accountingGenerator": typeof agents_accountingGenerator;
  "agents/architect": typeof agents_architect;
  "agents/brainUpdater": typeof agents_brainUpdater;
  "agents/clarification": typeof agents_clarification;
  "agents/clarificationV2": typeof agents_clarificationV2;
  "agents/controller": typeof agents_controller;
  "agents/convertIdeas": typeof agents_convertIdeas;
  "agents/deepResearch": typeof agents_deepResearch;
  "agents/estimator": typeof agents_estimator;
  "agents/flow": typeof agents_flow;
  "agents/ideation": typeof agents_ideation;
  "agents/inputs": typeof agents_inputs;
  "agents/itemPopulator": typeof agents_itemPopulator;
  "agents/orchestrator": typeof agents_orchestrator;
  "agents/patchMapper": typeof agents_patchMapper;
  "agents/planner": typeof agents_planner;
  "agents/planning": typeof agents_planning;
  "agents/quote": typeof agents_quote;
  "agents/rules": typeof agents_rules;
  "agents/skillRunner": typeof agents_skillRunner;
  "agents/skills": typeof agents_skills;
  "agents/solutioning": typeof agents_solutioning;
  "agents/solutioningV2": typeof agents_solutioningV2;
  "agents/structuredQuestions": typeof agents_structuredQuestions;
  "agents/suggestions": typeof agents_suggestions;
  "agents/summary": typeof agents_summary;
  "agents/taskEditor": typeof agents_taskEditor;
  "agents/taskRefiner": typeof agents_taskRefiner;
  "agents/trelloSyncAgent": typeof agents_trelloSyncAgent;
  assets: typeof assets;
  backfill: typeof backfill;
  brainEvents: typeof brainEvents;
  brainRuns: typeof brainRuns;
  buying: typeof buying;
  changeSets: typeof changeSets;
  chat: typeof chat;
  clarificationDocs: typeof clarificationDocs;
  constants: typeof constants;
  conversations: typeof conversations;
  costPlanDocs: typeof costPlanDocs;
  currentState: typeof currentState;
  deepResearch: typeof deepResearch;
  derivations: typeof derivations;
  drive: typeof drive;
  elementDrafts: typeof elementDrafts;
  elementPipelineMigrations: typeof elementPipelineMigrations;
  elementVersions: typeof elementVersions;
  facts: typeof facts;
  factsPipeline: typeof factsPipeline;
  factsV2: typeof factsV2;
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
  "lib/brainContext": typeof lib_brainContext;
  "lib/brainPatch": typeof lib_brainPatch;
  "lib/contextSummary": typeof lib_contextSummary;
  "lib/costing": typeof lib_costing;
  "lib/currentState": typeof lib_currentState;
  "lib/elementDigest": typeof lib_elementDigest;
  "lib/elementProjections": typeof lib_elementProjections;
  "lib/elementRegistry": typeof lib_elementRegistry;
  "lib/elementSerializer": typeof lib_elementSerializer;
  "lib/elementSnapshots": typeof lib_elementSnapshots;
  "lib/factsV2/prompts": typeof lib_factsV2_prompts;
  "lib/factsV2/verify": typeof lib_factsV2_verify;
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
  "lib/jsonSchema": typeof lib_jsonSchema;
  "lib/knowledgeBlocks/patch": typeof lib_knowledgeBlocks_patch;
  "lib/openai": typeof lib_openai;
  "lib/openaiImages": typeof lib_openaiImages;
  "lib/pricing": typeof lib_pricing;
  "lib/projects": typeof lib_projects;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/skills": typeof lib_skills;
  "lib/textChunker": typeof lib_textChunker;
  "lib/trelloExecutor": typeof lib_trelloExecutor;
  "lib/trelloTypes": typeof lib_trelloTypes;
  "lib/zodSchemas": typeof lib_zodSchemas;
  management: typeof management;
  memory: typeof memory;
  migrations: typeof migrations;
  migrators: typeof migrators;
  prices: typeof prices;
  printing: typeof printing;
  printingQuery: typeof printingQuery;
  projectBrain: typeof projectBrain;
  projectConversations: typeof projectConversations;
  projectWorkspaces: typeof projectWorkspaces;
  projections: typeof projections;
  projects: typeof projects;
  "prompts/flowPromptPack": typeof prompts_flowPromptPack;
  "prompts/itemsPromptPack": typeof prompts_itemsPromptPack;
  questionQueue: typeof questionQueue;
  quests: typeof quests;
  quotes: typeof quotes;
  rateLimit: typeof rateLimit;
  registry: typeof registry;
  research: typeof research;
  revisions: typeof revisions;
  scenarios: typeof scenarios;
  "scripts/check_memory": typeof scripts_check_memory;
  "scripts/check_skill": typeof scripts_check_skill;
  "scripts/debug_save_answers": typeof scripts_debug_save_answers;
  "scripts/test_changeset_flow": typeof scripts_test_changeset_flow;
  "scripts/test_controller_flow": typeof scripts_test_controller_flow;
  "scripts/test_helpers": typeof scripts_test_helpers;
  "scripts/test_suggestions_flow": typeof scripts_test_suggestions_flow;
  "scripts/test_trello_flow": typeof scripts_test_trello_flow;
  "scripts/test_ui_persistence": typeof scripts_test_ui_persistence;
  seed: typeof seed;
  settings: typeof settings;
  "skills/seed": typeof skills_seed;
  structuredQuestions: typeof structuredQuestions;
  suggestions: typeof suggestions;
  tasks: typeof tasks;
  trello: typeof trello;
  trelloActions: typeof trelloActions;
  trelloQuery: typeof trelloQuery;
  trelloSync: typeof trelloSync;
  turnBundles: typeof turnBundles;
  verify_fix: typeof verify_fix;
  verify_fix_mutation: typeof verify_fix_mutation;
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
