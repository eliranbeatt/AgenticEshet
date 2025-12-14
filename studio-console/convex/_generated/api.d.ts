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
import type * as agents_accountingGenerator from "../agents/accountingGenerator.js";
import type * as agents_architect from "../agents/architect.js";
import type * as agents_clarification from "../agents/clarification.js";
import type * as agents_deepResearch from "../agents/deepResearch.js";
import type * as agents_estimator from "../agents/estimator.js";
import type * as agents_planning from "../agents/planning.js";
import type * as agents_quote from "../agents/quote.js";
import type * as backfill from "../backfill.js";
import type * as buying from "../buying.js";
import type * as clarificationDocs from "../clarificationDocs.js";
import type * as conversations from "../conversations.js";
import type * as costPlanDocs from "../costPlanDocs.js";
import type * as deepResearch from "../deepResearch.js";
import type * as drive from "../drive.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as ingestion from "../ingestion.js";
import type * as knowledge from "../knowledge.js";
import type * as lib_costing from "../lib/costing.js";
import type * as lib_fileParsers from "../lib/fileParsers.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_textChunker from "../lib/textChunker.js";
import type * as lib_zodSchemas from "../lib/zodSchemas.js";
import type * as management from "../management.js";
import type * as prices from "../prices.js";
import type * as projects from "../projects.js";
import type * as quests from "../quests.js";
import type * as quotes from "../quotes.js";
import type * as research from "../research.js";
import type * as seed from "../seed.js";
import type * as tasks from "../tasks.js";
import type * as trelloSync from "../trelloSync.js";
import type * as whatsapp from "../whatsapp.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounting: typeof accounting;
  admin: typeof admin;
  "agents/accountingGenerator": typeof agents_accountingGenerator;
  "agents/architect": typeof agents_architect;
  "agents/clarification": typeof agents_clarification;
  "agents/deepResearch": typeof agents_deepResearch;
  "agents/estimator": typeof agents_estimator;
  "agents/planning": typeof agents_planning;
  "agents/quote": typeof agents_quote;
  backfill: typeof backfill;
  buying: typeof buying;
  clarificationDocs: typeof clarificationDocs;
  conversations: typeof conversations;
  costPlanDocs: typeof costPlanDocs;
  deepResearch: typeof deepResearch;
  drive: typeof drive;
  http: typeof http;
  inbox: typeof inbox;
  ingestion: typeof ingestion;
  knowledge: typeof knowledge;
  "lib/costing": typeof lib_costing;
  "lib/fileParsers": typeof lib_fileParsers;
  "lib/gemini": typeof lib_gemini;
  "lib/hash": typeof lib_hash;
  "lib/openai": typeof lib_openai;
  "lib/textChunker": typeof lib_textChunker;
  "lib/zodSchemas": typeof lib_zodSchemas;
  management: typeof management;
  prices: typeof prices;
  projects: typeof projects;
  quests: typeof quests;
  quotes: typeof quotes;
  research: typeof research;
  seed: typeof seed;
  tasks: typeof tasks;
  trelloSync: typeof trelloSync;
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
