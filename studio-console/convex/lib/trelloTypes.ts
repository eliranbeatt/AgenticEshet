export type TrelloID = string;
export type ISODateString = string; // e.g. 2026-01-03T12:00:00.000Z

export type TrelloContext = {
  boardId: string;
  // lists keyed by status
  listsByStatus?: Partial<Record<"todo" | "in_progress" | "blocked" | "done", { id: string; name: string }>>;
  // labels known on the board
  labelsByName?: Record<string, { id: string; color?: string }>;
  // custom fields known on the board
  customFieldsByName?: Record<string, { id: string; type: "number" | "text" | "checkbox" | "date" | "list" }>;
  // optional: map your assignee string (email) → Trello member id
  memberIdByAssignee?: Record<string, string>;
};

export type TrelloOp =
  | {
      opId: string;
      op: "ENSURE_BOARD";
      setVar?: string; // e.g. "board.main"
      board?: {
        id?: TrelloID;
        name?: string;
        idOrganization?: TrelloID;
        defaultLists?: boolean;
      };
      ifMissing: "create" | "error";
    }
  | {
      opId: string;
      op: "ENSURE_LIST";
      boardId: TrelloID | `$${string}`;
      list: { id?: TrelloID; name: string; pos?: "top" | "bottom" | number };
      setVar?: string; // e.g. "list.todo"
    }
  | {
      opId: string;
      op: "ENSURE_LABEL";
      boardId: TrelloID | `$${string}`;
      label: { id?: TrelloID; name: string; color?: string | null };
      setVar?: string; // e.g. "label.Logistics"
    }
  | {
      opId: string;
      op: "ENSURE_CUSTOM_FIELD";
      boardId: TrelloID | `$${string}`;
      field: {
        id?: TrelloID;
        name: string;
        type: "number" | "text" | "date" | "checkbox" | "list";
        pos?: "top" | "bottom" | number;
        displayOnCardFront?: boolean;
      };
      setVar?: string; // e.g. "cf.estimateHours"
    }
  | {
      opId: string;
      op: "UPSERT_CARD";
      taskId: string;
      boardId: TrelloID | `$${string}`;
      listId: TrelloID | `$${string}`;
      card: {
        id?: TrelloID; // if known from trelloMappings
        name: string;
        desc?: string;
        start?: ISODateString | null;
        due?: ISODateString | null;
        dueComplete?: boolean;
        pos?: "top" | "bottom" | number;
        labelIds?: Array<TrelloID | `$${string}`>;
        memberIds?: Array<TrelloID | `$${string}`>;
      };
      mode: "create_or_update";
      setVar?: string; // e.g. "card.task.<taskId>"
      contentHash: string;
    }
  | {
      opId: string;
      op: "ENSURE_CHECKLIST_ON_CARD";
      cardId: TrelloID | `$${string}`;
      checklist: { id?: TrelloID; name: string; pos?: "top" | "bottom" | number };
      setVar?: string; // e.g. "chk.task.<taskId>"
    }
  | {
      opId: string;
      op: "UPSERT_CHECKITEMS";
      cardId: TrelloID | `$${string}`;
      checklistId: TrelloID | `$${string}`;
      items: Array<{ name: string; checked?: boolean; due?: ISODateString | null }>;
      mode: "merge_by_name";
    }
  | {
      opId: string;
      op: "SET_CUSTOM_FIELD_NUMBER";
      cardId: TrelloID | `$${string}`;
      customFieldId: TrelloID | `$${string}`;
      value: number | null;
    }
  | {
      opId: string;
      op: "SKIP";
      taskId?: string;
      reason: string;
    };

export type TrelloSyncPlan = {
  planVersion: "1.0";
  context: {
    projectId: string;
    targetBoardId?: TrelloID;
    targetBoardName?: string;
  };
  warnings?: string[];
  operations: TrelloOp[];
  // what to write back to Convex after successful execution
  mappingUpserts?: Array<{
    taskId: string;
    trelloCardIdVarOrValue: string; // e.g. "$card_abc" or "64f..."
    trelloListIdVarOrValue: string;
    contentHash: string;
  }>;
};

export type TrelloExecutionReport = {
  runId: string;
  startedAt: number;
  finishedAt: number;
  boardId?: TrelloID;
  opResults: Array<{
    opId: string;
    op: TrelloOp["op"];
    ok: boolean;
    producedVars?: Record<string, string>;
    created?: { type: string; id: TrelloID; name?: string };
    updated?: { type: string; id: TrelloID };
    error?: { message: string; status?: number; details?: unknown };
  }>;
};
