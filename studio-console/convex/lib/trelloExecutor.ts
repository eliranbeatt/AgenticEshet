import crypto from "node:crypto";
import { TrelloExecutionReport, TrelloID, TrelloOp, TrelloSyncPlan } from "./trelloTypes";

export type TrelloExecutorConfig = {
  apiKey: string;
  token: string;
  baseUrl?: string; // default: https://api.trello.com/1
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
};

class TrelloClient {
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(private cfg: TrelloExecutorConfig) {
    this.baseUrl = cfg.baseUrl ?? "https://api.trello.com/1";
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts?: { query?: Record<string, any>; body?: any; headers?: Record<string, string> }
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);

    // Auth as query params (key/token)
    url.searchParams.set("key", this.cfg.apiKey);
    url.searchParams.set("token", this.cfg.token);

    if (opts?.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) url.searchParams.set(k, v.join(",")); // common Trello pattern
        else url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(opts?.headers ?? {}),
    };

    let body: string | undefined;
    if (opts?.body !== undefined) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      body = headers["Content-Type"].includes("application/json") ? JSON.stringify(opts.body) : String(opts.body);
    }

    if (this.cfg.dryRun) {
      // eslint-disable-next-line no-console
      console.log("[DRY RUN]", method, url.toString(), body ? `body=${body}` : "");
      return {} as T;
    }

    return await withRetry(async () => {
      const res = await this.fetchImpl(url.toString(), { method, headers, body });

      const text = await res.text();
      const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
      const payload = text && isJson ? safeJsonParse(text) : text;

      if (!res.ok) {
        const err: any = new Error(`Trello API ${res.status} ${res.statusText}`);
        err.status = res.status;
        err.payload = payload;
        throw err;
      }

      return payload as T;
    });
  }
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 5;
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.status as number | undefined;
      const retryable = status === 429 || (status !== undefined && status >= 500 && status <= 599);

      if (!retryable || attempt >= maxAttempts) throw e;

      const backoffMs = Math.min(2000 * attempt, 8000);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

function isVarRef(x: any): x is `$${string}` {
  return typeof x === "string" && x.startsWith("$");
}

function resolveId(vars: Map<string, string>, v: any, labelForError: string): string {
  if (typeof v !== "string") throw new Error(`Expected string id for ${labelForError}`);
  if (isVarRef(v)) {
    const key = v.slice(1);
    const val = vars.get(key);
    if (!val) throw new Error(`Missing runtime var "${key}" for ${labelForError}`);
    return val;
  }
  return v;
}

function makeRunId() {
  return crypto.randomBytes(8).toString("hex");
}

type BoardCaches = {
  listsByName: Map<string, TrelloID>;
  labelsByKey: Map<string, TrelloID>; // `${name}::${color ?? ""}`
  customFieldsByName: Map<string, { id: TrelloID; type: string }>;
};

export async function executeTrelloSyncPlan(
  plan: TrelloSyncPlan,
  cfg: TrelloExecutorConfig,
  context?: {
    // Optional: Pre-loaded caches if we have them from an earlier step
    knownLists?: Array<{ id: TrelloID; name: string }>;
    knownLabels?: Array<{ id: TrelloID; name: string; color?: string }>;
    knownCustomFields?: Array<{ id: TrelloID; name: string; type: string }>;
  }
): Promise<TrelloExecutionReport> {
  const client = new TrelloClient(cfg);

  const runId = makeRunId();
  const startedAt = Date.now();
  const vars = new Map<string, string>();

  const report: TrelloExecutionReport = {
    runId,
    startedAt,
    finishedAt: startedAt,
    boardId: undefined,
    opResults: [],
  };

  // Seed vars from known context
  if (plan.context.targetBoardId) vars.set("board.main", plan.context.targetBoardId);

  let caches: BoardCaches | null = null;

  async function loadBoardCaches(boardId: TrelloID): Promise<BoardCaches> {
    const listsByName = new Map<string, TrelloID>();
    const labelsByKey = new Map<string, TrelloID>();
    const customFieldsByName = new Map<string, { id: TrelloID; type: string }>();

    // Use pre-loaded context if available and relevant (simple merging strategy)
    if (context?.knownLists) {
      for (const l of context.knownLists) listsByName.set(normalizeName(l.name), l.id);
    } else {
      const lists = await client.request<any[]>("GET", `/boards/${boardId}/lists`, {
        query: { fields: "name", filter: "open" },
      });
      for (const l of lists ?? []) listsByName.set(normalizeName(l.name), l.id);
    }

    if (context?.knownLabels) {
       for (const lb of context.knownLabels) labelsByKey.set(labelKey(lb.name, lb.color), lb.id);
    } else {
      const labels = await client.request<any[]>("GET", `/boards/${boardId}/labels`, {
        query: { fields: "name,color" },
      });
      for (const lb of labels ?? []) labelsByKey.set(labelKey(lb.name, lb.color), lb.id);
    }

    if (context?.knownCustomFields) {
        for (const f of context.knownCustomFields) customFieldsByName.set(normalizeName(f.name), { id: f.id, type: f.type as any });
    } else {
      const fields = await client.request<any[]>("GET", `/boards/${boardId}/customFields`);
      for (const f of fields ?? []) customFieldsByName.set(normalizeName(f.name), { id: f.id, type: f.type });
    }

    return { listsByName, labelsByKey, customFieldsByName };
  }

  async function ensureCaches(boardId: TrelloID) {
    if (!caches) caches = await loadBoardCaches(boardId);
    return caches;
  }

  function setVar(name: string | undefined, id: string | undefined, out: Record<string, string>) {
    if (!name || !id) return;
    vars.set(name, id);
    out[name] = id;
  }

  for (const op of plan.operations) {
    const producedVars: Record<string, string> = {};

    try {
      if (op.op === "SKIP") {
        report.opResults.push({ opId: op.opId, op: op.op, ok: true });
        continue;
      }

      if (op.op === "ENSURE_BOARD") {
        const existingId = op.board?.id ?? plan.context.targetBoardId ?? vars.get("board.main");

        if (existingId) {
          report.boardId = existingId;
          setVar(op.setVar ?? "board.main", existingId, producedVars);
          report.opResults.push({
            opId: op.opId,
            op: op.op,
            ok: true,
            producedVars,
            updated: { type: "board", id: existingId },
          });
          continue;
        }

        if (op.ifMissing === "error") throw new Error("No boardId provided and ENSURE_BOARD.ifMissing=error");

        const name = op.board?.name ?? plan.context.targetBoardName;
        if (!name) throw new Error("ENSURE_BOARD requires board.name (or context.targetBoardName)");

        // POST /boards
        const created = await client.request<any>("POST", `/boards`, {
          query: {
            name,
            idOrganization: op.board?.idOrganization,
            defaultLists: op.board?.defaultLists ?? false,
          },
        });

        const boardId = created.id as TrelloID;
        report.boardId = boardId;
        setVar(op.setVar ?? "board.main", boardId, producedVars);

        caches = null; // reset caches for new board
        report.opResults.push({
          opId: op.opId,
          op: op.op,
          ok: true,
          producedVars,
          created: { type: "board", id: boardId, name },
        });
        continue;
      }

      if (op.op === "ENSURE_LIST") {
        const boardId = resolveId(vars, op.boardId, "boardId");
        report.boardId = report.boardId ?? boardId;
        const c = await ensureCaches(boardId);

        if (op.list.id) {
          setVar(op.setVar, op.list.id, producedVars);
          report.opResults.push({
            opId: op.opId,
            op: op.op,
            ok: true,
            producedVars,
            updated: { type: "list", id: op.list.id },
          });
          continue;
        }

        const k = normalizeName(op.list.name);
        const existing = c.listsByName.get(k);
        if (existing) {
          setVar(op.setVar, existing, producedVars);
          report.opResults.push({
            opId: op.opId,
            op: op.op,
            ok: true,
            producedVars,
            updated: { type: "list", id: existing },
          });
          continue;
        }

        // POST /boards/{id}/lists?name=...
        const created = await client.request<any>("POST", `/boards/${boardId}/lists`, {
          query: { name: op.list.name, pos: op.list.pos ?? "bottom" },
        });

        const listId = created.id as TrelloID;
        c.listsByName.set(k, listId);
        setVar(op.setVar, listId, producedVars);

        report.opResults.push({
          opId: op.opId,
          op: op.op,
          ok: true,
          producedVars,
          created: { type: "list", id: listId, name: op.list.name },
        });
        continue;
      }

      if (op.op === "ENSURE_LABEL") {
        const boardId = resolveId(vars, op.boardId, "boardId");
        report.boardId = report.boardId ?? boardId;
        const c = await ensureCaches(boardId);

        if (op.label.id) {
          setVar(op.setVar, op.label.id, producedVars);
          report.opResults.push({
            opId: op.opId,
            op: op.op,
            ok: true,
            producedVars,
            updated: { type: "label", id: op.label.id },
          });
          continue;
        }

        const key = labelKey(op.label.name, op.label.color ?? null);
        const existing = c.labelsByKey.get(key);
        if (existing) {
          setVar(op.setVar, existing, producedVars);
          report.opResults.push({
            opId: op.opId,
            op: op.op,
            ok: true,
            producedVars,
            updated: { type: "label", id: existing },
          });
          continue;
        }

        // POST /boards/{id}/labels?name=&color=
        const created = await client.request<any>("POST", `/boards/${boardId}/labels`, {
          query: { name: op.label.name, color: op.label.color ?? undefined },
        });

        const labelId = created.id as TrelloID;
        c.labelsByKey.set(key, labelId);
        setVar(op.setVar, labelId, producedVars);

        report.opResults.push({
          opId: op.opId,
          op: op.op,
          ok: true,
          producedVars,
          created: { type: "label", id: labelId, name: op.label.name },
        });
        continue;
      }

      if (op.op === "ENSURE_CUSTOM_FIELD") {
        const boardId = resolveId(vars, op.boardId, "boardId");
        report.boardId = report.boardId ?? boardId;
        const c = await ensureCaches(boardId);

        if (op.field.id) {
          setVar(op.setVar, op.field.id, producedVars);
          report.opResults.push({
            opId: op.opId,
            op: op.op,
            ok: true,
            producedVars,
            updated: { type: "customField", id: op.field.id },
          });
          continue;
        }

        const k = normalizeName(op.field.name);
        const existing = c.customFieldsByName.get(k);
        if (existing) {
          setVar(op.setVar, existing.id, producedVars);
          report.opResults.push({
            opId: op.opId,
            op: op.op,
            ok: true,
            producedVars,
            updated: { type: "customField", id: existing.id },
          });
          continue;
        }

        // POST /customFields (JSON body)
        const created = await client.request<any>("POST", `/customFields`, {
          body: {
            idModel: boardId,
            modelType: "board",
            name: op.field.name,
            type: op.field.type,
            pos: op.field.pos ?? "top",
            display_cardFront: op.field.displayOnCardFront ?? true,
          },
        });

        const fieldId = created.id as TrelloID;
        c.customFieldsByName.set(k, { id: fieldId, type: op.field.type });
        setVar(op.setVar, fieldId, producedVars);

        report.opResults.push({
          opId: op.opId,
          op: op.op,
          ok: true,
          producedVars,
          created: { type: "customField", id: fieldId, name: op.field.name },
        });
        continue;
      }

      if (op.op === "UPSERT_CARD") {
        const boardId = resolveId(vars, op.boardId, "boardId");
        const listId = resolveId(vars, op.listId, "listId");
        report.boardId = report.boardId ?? boardId;

        const desiredLabelIds = (op.card.labelIds ?? []).map((x) => resolveId(vars, x, "labelId"));
        const desiredMemberIds = (op.card.memberIds ?? []).map((x) => resolveId(vars, x, "memberId"));

        const payload = {
          name: op.card.name,
          desc: op.card.desc ?? "",
          idList: listId,
          due: op.card.due ?? undefined,
          start: op.card.start ?? undefined,
          dueComplete: op.card.dueComplete ?? undefined,
          pos: op.card.pos ?? "top",
          idLabels: desiredLabelIds.length ? desiredLabelIds : undefined,
          idMembers: desiredMemberIds.length ? desiredMemberIds : undefined,
        };

        let cardId: TrelloID;
        let created = false;

        if (!op.card.id) {
          // POST /cards (JSON body allowed)
          const res = await client.request<any>("POST", `/cards`, { body: payload });
          cardId = res.id as TrelloID;
          created = true;
        } else {
          cardId = op.card.id;
          // PUT /cards/{id} (JSON body allowed)
          await client.request<any>("PUT", `/cards/${cardId}`, { body: payload });
        }

        // Strong idempotency for members/labels:
        // fetch current ids then add/remove by diff using dedicated endpoints.
        const current = await client.request<any>("GET", `/cards/${cardId}`, {
          query: { fields: "idLabels,idMembers" },
        });
        const currentLabels = new Set<string>((current.idLabels ?? []).map(String));
        const currentMembers = new Set<string>((current.idMembers ?? []).map(String));

        const desiredLabels = new Set<string>(desiredLabelIds.map(String));
        const desiredMembers = new Set<string>(desiredMemberIds.map(String));

        // Add missing labels
        for (const idLabel of desiredLabels) {
          if (!currentLabels.has(idLabel)) {
            await client.request<any>("POST", `/cards/${cardId}/idLabels`, { query: { value: idLabel } });
          }
        }
        // Remove extra labels
        for (const idLabel of currentLabels) {
          if (!desiredLabels.has(idLabel)) {
            await client.request<any>("DELETE", `/cards/${cardId}/idLabels/${idLabel}`);
          }
        }

        // Add missing members
        for (const idMember of desiredMembers) {
          if (!currentMembers.has(idMember)) {
            await client.request<any>("POST", `/cards/${cardId}/idMembers`, { query: { value: idMember } });
          }
        }
        // Remove extra members
        for (const idMember of currentMembers) {
          if (!desiredMembers.has(idMember)) {
            await client.request<any>("DELETE", `/cards/${cardId}/idMembers/${idMember}`);
          }
        }

        setVar(op.setVar, cardId, producedVars);

        report.opResults.push({
          opId: op.opId,
          op: op.op,
          ok: true,
          producedVars,
          ...(created
            ? { created: { type: "card", id: cardId, name: op.card.name } }
            : { updated: { type: "card", id: cardId } }),
        });
        continue;
      }

      if (op.op === "ENSURE_CHECKLIST_ON_CARD") {
        const cardId = resolveId(vars, op.cardId, "cardId");

        if (op.checklist.id) {
          setVar(op.setVar, op.checklist.id, producedVars);
          report.opResults.push({
            opId: op.opId,
            op: op.op,
            ok: true,
            producedVars,
            updated: { type: "checklist", id: op.checklist.id },
          });
          continue;
        }

        // GET /cards/{id}/checklists
        const existing = await client.request<any[]>("GET", `/cards/${cardId}/checklists`);
        const found = (existing ?? []).find((c) => normalizeName(c.name) === normalizeName(op.checklist.name));

        if (found?.id) {
          setVar(op.setVar, found.id as TrelloID, producedVars);
          report.opResults.push({
            opId: op.opId,
            op: op.op,
            ok: true,
            producedVars,
            updated: { type: "checklist", id: found.id },
          });
          continue;
        }

        // POST /cards/{id}/checklists?name=...
        const created = await client.request<any>("POST", `/cards/${cardId}/checklists`, {
          query: { name: op.checklist.name, pos: op.checklist.pos ?? "bottom" },
        });

        const checklistId = created.id as TrelloID;
        setVar(op.setVar, checklistId, producedVars);

        report.opResults.push({
          opId: op.opId,
          op: op.op,
          ok: true,
          producedVars,
          created: { type: "checklist", id: checklistId, name: op.checklist.name },
        });
        continue;
      }

      if (op.op === "UPSERT_CHECKITEMS") {
        const cardId = resolveId(vars, op.cardId, "cardId");
        const checklistId = resolveId(vars, op.checklistId, "checklistId");

        // GET /checklists/{id}/checkItems
        const existing = await client.request<any[]>("GET", `/checklists/${checklistId}/checkItems`);
        const byName = new Map<string, any>();
        for (const it of existing ?? []) byName.set(normalizeName(it.name), it);

        for (const desired of op.items) {
          const key = normalizeName(desired.name);
          const found = byName.get(key);

          if (!found) {
            // POST /checklists/{id}/checkItems?name=&checked=
            await client.request<any>("POST", `/checklists/${checklistId}/checkItems`, {
              query: {
                name: desired.name,
                checked: desired.checked ?? false,
                due: desired.due ?? undefined,
              },
            });
            continue;
          }

          // Update checkItem state if needed.
          // Trello updates checkItems via card endpoint:
          // PUT /cards/{id}/checkItem/{idCheckItem}?state=complete|incomplete
          const desiredState = desired.checked ? "complete" : "incomplete";
          const currentState = String(found.state ?? "").toLowerCase();
          const currentAsState = currentState === "complete" ? "complete" : "incomplete";

          if (desiredState !== currentAsState) {
            await client.request<any>("PUT", `/cards/${cardId}/checkItem/${found.id}`, {
              query: { state: desiredState, idChecklist: checklistId },
            });
          }
        }

        report.opResults.push({ opId: op.opId, op: op.op, ok: true });
        continue;
      }

      if (op.op === "SET_CUSTOM_FIELD_NUMBER") {
        const cardId = resolveId(vars, op.cardId, "cardId");
        const customFieldId = resolveId(vars, op.customFieldId, "customFieldId");

        // PUT /cards/{idCard}/customField/{idCustomField}/item with JSON body { value: { number: ... } }
        const value = op.value === null ? null : String(op.value);

        await client.request<any>("PUT", `/cards/${cardId}/customField/${customFieldId}/item`, {
          body: value === null ? { value: {} } : { value: { number: value } },
        });

        report.opResults.push({ opId: op.opId, op: op.op, ok: true });
        continue;
      }

      // Exhaustiveness guard
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _never: never = op;

      report.opResults.push({ opId: (op as any).opId, op: (op as any).op, ok: false, error: { message: "Unknown op" } });
    } catch (e: any) {
      report.opResults.push({
        opId: (op as any).opId ?? "unknown",
        op: (op as any).op ?? "unknown",
        ok: false,
        producedVars: Object.keys(producedVars).length ? producedVars : undefined,
        error: {
          message: e?.message ?? String(e),
          status: e?.status,
          details: e?.payload,
        },
      });
    }
  }

  report.finishedAt = Date.now();
  return report;
}

function normalizeName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function labelKey(name: string, color?: string | null) {
  return `${normalizeName(name)}::${(color ?? "").trim().toLowerCase()}`;
}
