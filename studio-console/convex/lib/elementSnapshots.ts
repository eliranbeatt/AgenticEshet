import { ElementPatchOpsSchema, ElementSnapshotSchema } from "./zodSchemas";
import type { ElementPatchOps, ElementSnapshot } from "./zodSchemas";

type ElementEntity = "materials" | "labor" | "tasks";

function cloneSnapshot(snapshot: ElementSnapshot): ElementSnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as ElementSnapshot;
}

function ensureUnique(list: string[]) {
    return Array.from(new Set(list));
}

function upsertLine<T extends { [key: string]: unknown }>(
    list: T[],
    keyField: keyof T,
    key: string,
    value: T
) {
    const index = list.findIndex((line) => String(line[keyField]) === key);
    if (index >= 0) {
        list[index] = value;
        return;
    }
    list.push(value);
}

function removeLine<T extends { [key: string]: unknown }>(
    list: T[],
    keyField: keyof T,
    key: string
) {
    const index = list.findIndex((line) => String(line[keyField]) === key);
    if (index >= 0) {
        list.splice(index, 1);
        return true;
    }
    return false;
}

function removeKeyFromTasks(snapshot: ElementSnapshot, key: string) {
    for (const task of snapshot.tasks) {
        task.dependencies = task.dependencies.filter((dep) => dep !== key);
        task.usesMaterialKeys = task.usesMaterialKeys.filter((dep) => dep !== key);
        task.usesLaborKeys = task.usesLaborKeys.filter((dep) => dep !== key);
        if (task.materialKey === key) {
            task.materialKey = undefined;
        }
    }
}

function addTombstone(snapshot: ElementSnapshot, entity: ElementEntity, key: string) {
    if (entity === "tasks") {
        snapshot.tombstones.taskKeys = ensureUnique([...snapshot.tombstones.taskKeys, key]);
        return;
    }
    if (entity === "materials") {
        snapshot.tombstones.materialKeys = ensureUnique([...snapshot.tombstones.materialKeys, key]);
        return;
    }
    snapshot.tombstones.laborKeys = ensureUnique([...snapshot.tombstones.laborKeys, key]);
}

function removeTombstone(snapshot: ElementSnapshot, entity: ElementEntity, key: string) {
    if (entity === "tasks") {
        snapshot.tombstones.taskKeys = snapshot.tombstones.taskKeys.filter((k) => k !== key);
        return;
    }
    if (entity === "materials") {
        snapshot.tombstones.materialKeys = snapshot.tombstones.materialKeys.filter((k) => k !== key);
        return;
    }
    snapshot.tombstones.laborKeys = snapshot.tombstones.laborKeys.filter((k) => k !== key);
}

export function normalizeSnapshot(input: unknown): ElementSnapshot {
    return ElementSnapshotSchema.parse(input);
}

export function applyPatchOps(base: ElementSnapshot, opsInput: ElementPatchOps): ElementSnapshot {
    const ops = ElementPatchOpsSchema.parse(opsInput);
    const snapshot = cloneSnapshot(base);
    const restoreKeys = new Set<string>();

    for (const op of ops) {
        if (op.op === "tombstone_restore") {
            restoreKeys.add(op.key);
        }
    }

    for (const op of ops) {
        if (op.op === "set_text") {
            const [section, field] = op.path.split(".");
            if (section === "descriptions") {
                if (field === "short") snapshot.descriptions.short = op.value;
                if (field === "long") snapshot.descriptions.long = op.value;
            }
            if (section === "freeText") {
                if (field === "preferences") snapshot.freeText.preferences = op.value;
                if (field === "risks") snapshot.freeText.risks = op.value;
                if (field === "openQuestions") snapshot.freeText.openQuestions = op.value;
                if (field === "installation") snapshot.freeText.installation = op.value;
                if (field === "building") snapshot.freeText.building = op.value;
                if (field === "constraints") snapshot.freeText.constraints = op.value;
                if (field === "notes") snapshot.freeText.notes = op.value;
            }
            continue;
        }

        if (op.op === "replace_section") {
            if (op.section === "descriptions") {
                snapshot.descriptions = op.value as ElementSnapshot["descriptions"];
            } else if (op.section === "freeText") {
                snapshot.freeText = op.value as ElementSnapshot["freeText"];
            } else if (op.section === "materials") {
                snapshot.materials = op.value as ElementSnapshot["materials"];
            } else if (op.section === "labor") {
                snapshot.labor = op.value as ElementSnapshot["labor"];
            } else if (op.section === "tasks") {
                snapshot.tasks = op.value as ElementSnapshot["tasks"];
            } else if (op.section === "tombstones") {
                snapshot.tombstones = op.value as ElementSnapshot["tombstones"];
            }
            continue;
        }

        if (op.op === "upsert_line") {
            if (
                (op.entity === "tasks" && snapshot.tombstones.taskKeys.includes(op.key) && !restoreKeys.has(op.key)) ||
                (op.entity === "materials" && snapshot.tombstones.materialKeys.includes(op.key) && !restoreKeys.has(op.key)) ||
                (op.entity === "labor" && snapshot.tombstones.laborKeys.includes(op.key) && !restoreKeys.has(op.key))
            ) {
                throw new Error(`Cannot re-add tombstoned key ${op.key} without tombstone_restore.`);
            }

            if (op.entity === "tasks") {
                upsertLine(snapshot.tasks, "taskKey", op.key, op.value as ElementSnapshot["tasks"][number]);
            } else if (op.entity === "materials") {
                upsertLine(snapshot.materials, "materialKey", op.key, op.value as ElementSnapshot["materials"][number]);
            } else {
                upsertLine(snapshot.labor, "laborKey", op.key, op.value as ElementSnapshot["labor"][number]);
            }
            continue;
        }

        if (op.op === "remove_line") {
            if (op.entity === "tasks") {
                const task = snapshot.tasks.find((t) => t.taskKey === op.key);
                if (task?.taskType === "purchase_material" && task.materialKey) {
                    const material = snapshot.materials.find((m) => m.materialKey === task.materialKey);
                    if (material) {
                        material.needPurchase = false;
                    }
                }
                removeLine(snapshot.tasks, "taskKey", op.key);
            } else if (op.entity === "materials") {
                removeLine(snapshot.materials, "materialKey", op.key);
            } else {
                removeLine(snapshot.labor, "laborKey", op.key);
            }
            removeKeyFromTasks(snapshot, op.key);
            addTombstone(snapshot, op.entity, op.key);
            continue;
        }

        if (op.op === "tombstone_add") {
            addTombstone(snapshot, op.entity, op.key);
            continue;
        }

        if (op.op === "tombstone_restore") {
            removeTombstone(snapshot, op.entity, op.key);
        }
    }

    const emptyTasks = snapshot.tasks.filter(
        (task) => task.title.trim().length === 0 && task.details.trim().length === 0
    );
    for (const task of emptyTasks) {
        removeLine(snapshot.tasks, "taskKey", task.taskKey);
        removeKeyFromTasks(snapshot, task.taskKey);
        addTombstone(snapshot, "tasks", task.taskKey);
    }

    snapshot.tombstones.taskKeys = ensureUnique(snapshot.tombstones.taskKeys);
    snapshot.tombstones.materialKeys = ensureUnique(snapshot.tombstones.materialKeys);
    snapshot.tombstones.laborKeys = ensureUnique(snapshot.tombstones.laborKeys);

    return ElementSnapshotSchema.parse(snapshot);
}
