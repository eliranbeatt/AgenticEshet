import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

// 4. Trello Sync Module

export type TrelloCard = {
    id: string;
    name: string;
    desc?: string;
    idList: string;
    labels: { id: string; name: string }[];
};

export type TrelloList = {
    id: string;
    name: string;
};

export type TrelloState = {
    lists: TrelloList[];
    cards: TrelloCard[];
};

export type SyncOperation = 
    | { op: "createCard"; taskId: string; listId: string; title: string; desc?: string }
    | { op: "updateCard"; cardId: string; taskId: string; title?: string; desc?: string; listId?: string }
    | { op: "archiveCard"; cardId: string };

export type TrelloSyncPlan = {
    operations: SyncOperation[];
    warnings: string[];
};

export async function generateTrelloPlan(ctx: any, args: { tasks: any[], trelloState: TrelloState }): Promise<TrelloSyncPlan> {
    const { tasks, trelloState } = args;
    const ops: SyncOperation[] = [];
    const warnings: string[] = [];

    // Map existing cards by Task ID (assumed stored in desc or managed via mapping table)
    // Here we simulate the logic: we assume `desc` starts with "mapped:taskId" for simplicity, 
    // or we'd query the 'trelloMappings' table in a real Action.
    // For this pure logic function, we rely on input state.
    
    const cardByTaskId = new Map<string, TrelloCard>();
    for (const card of trelloState.cards) {
        if (card.desc && card.desc.startsWith("mapped:")) {
            const taskId = card.desc.split(":")[1];
            cardByTaskId.set(taskId, card);
        }
    }

    const defaultList = trelloState.lists[0]; // Simple default
    if (!defaultList) {
        warnings.push("No lists found in Trello board.");
        return { operations: [], warnings };
    }

    for (const task of tasks) {
        const existingCard = cardByTaskId.get(task._id);
        
        if (!existingCard) {
            // New Task -> Create Card
            ops.push({
                op: "createCard",
                taskId: task._id,
                listId: defaultList.id,
                title: task.title,
                desc: `mapped:${task._id}`
            });
        } else {
            // Existing Card -> Update if changed
            // Simple dirty check
            if (existingCard.name !== task.title) {
                ops.push({
                    op: "updateCard",
                    cardId: existingCard.id,
                    taskId: task._id,
                    title: task.title
                });
            }
        }
    }

    return { operations: ops, warnings };
}
