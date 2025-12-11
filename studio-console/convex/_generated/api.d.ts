/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as agents_architect from "../agents/architect.js";
import type * as agents_clarification from "../agents/clarification.js";
import type * as agents_planning from "../agents/planning.js";
import type * as agents_quote from "../agents/quote.js";
import type * as backfill from "../backfill.js";
import type * as conversations from "../conversations.js";
import type * as ingestion from "../ingestion.js";
import type * as knowledge from "../knowledge.js";
import type * as lib_fileParsers from "../lib/fileParsers.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_textChunker from "../lib/textChunker.js";
import type * as lib_zodSchemas from "../lib/zodSchemas.js";
import type * as projects from "../projects.js";
import type * as quests from "../quests.js";
import type * as seed from "../seed.js";
import type * as tasks from "../tasks.js";
import type * as trelloSync from "../trelloSync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  "agents/architect": typeof agents_architect;
  "agents/clarification": typeof agents_clarification;
  "agents/planning": typeof agents_planning;
  "agents/quote": typeof agents_quote;
  backfill: typeof backfill;
  conversations: typeof conversations;
  ingestion: typeof ingestion;
  knowledge: typeof knowledge;
  "lib/fileParsers": typeof lib_fileParsers;
  "lib/hash": typeof lib_hash;
  "lib/openai": typeof lib_openai;
  "lib/textChunker": typeof lib_textChunker;
  "lib/zodSchemas": typeof lib_zodSchemas;
  projects: typeof projects;
  quests: typeof quests;
  seed: typeof seed;
  tasks: typeof tasks;
  trelloSync: typeof trelloSync;
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
