
export function mapPatchOpsToChangeSet(patchOps: any[]) {
    const changes = {
        items: { create: [] as any[], patch: [] as any[], deleteRequest: [] as any[] },
        tasks: { create: [] as any[], patch: [] as any[], dependencies: [] as any[] },
        accountingLines: { create: [] as any[], patch: [] as any[] },
        materialLines: { create: [] as any[], patch: [] as any[], deleteRequest: [] as any[] }
    };

    if (!Array.isArray(patchOps)) return changes;

    for (const op of patchOps) {
        const path = op.path || "";
        const parts = path.split("/");
        const root = parts[0];
        const id = parts.length > 1 ? parts[1] : null;

        if (root === "elements") {
            if (op.op === "add" && !id) {
                // Add new element
                // value expected to be { tempId, name, category, ... }
                changes.items.create.push(op.value);
            } else if (op.op === "update" || op.op === "replace") {
                // Patch existing
                // value expected to be patch object
                if (id) changes.items.patch.push({ itemId: id, patch: op.value });
            } else if (op.op === "remove") {
                if (id) changes.items.deleteRequest.push({ itemId: id });
            }
        }
        else if (root === "tasks") {
            if (op.op === "add" && !id) {
                changes.tasks.create.push(op.value);
            } else if ((op.op === "update" || op.op === "replace") && id) {
                changes.tasks.patch.push({ taskId: id, patch: op.value });
            }
        }
        else if (root === "materials") {
            if (op.op === "add" && !id) {
                changes.materialLines.create.push(op.value);
            } else if ((op.op === "update" || op.op === "replace") && id) {
                changes.materialLines.patch.push({ lineId: id, patch: op.value });
            } else if (op.op === "remove" && id) {
                changes.materialLines.deleteRequest.push({ lineId: id });
            }
        }
        else if (root === "accounting") {
            if (op.op === "add" && !id) {
                changes.accountingLines.create.push(op.value);
            } else if ((op.op === "update" || op.op === "replace") && id) {
                changes.accountingLines.patch.push({ lineId: id, patch: op.value });
            }
        }
    }

    return changes;
}
