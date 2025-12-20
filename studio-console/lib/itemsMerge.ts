import { ItemSpecV2, LaborSpec, MaterialSpec, SubtaskSpec } from "./items";

export type ItemSpecPatch = Partial<ItemSpecV2>;

type WithId = { id: string };

function mergeById<T extends WithId>(
    base: T[],
    patch: Array<Partial<T> & WithId>,
    mergeItem: (baseItem: T, patchItem: Partial<T> & WithId) => T,
) {
    const patchById = new Map(patch.map((item) => [item.id, item]));
    const merged = base.map((item) => {
        const patchItem = patchById.get(item.id);
        if (!patchItem) return item;
        patchById.delete(item.id);
        return mergeItem(item, patchItem);
    });

    for (const patchItem of patchById.values()) {
        merged.push(patchItem as T);
    }

    return merged;
}

function mergeMaterial(baseItem: MaterialSpec, patchItem: Partial<MaterialSpec> & WithId) {
    return { ...baseItem, ...patchItem };
}

function mergeLabor(baseItem: LaborSpec, patchItem: Partial<LaborSpec> & WithId) {
    return { ...baseItem, ...patchItem };
}

function mergeSubtask(baseItem: SubtaskSpec, patchItem: Partial<SubtaskSpec> & WithId): SubtaskSpec {
    const merged: SubtaskSpec = { ...baseItem, ...patchItem };
    if (patchItem.children) {
        merged.children = mergeSubtaskArray(baseItem.children ?? [], patchItem.children);
    }
    return merged;
}

function mergeSubtaskArray(
    base: SubtaskSpec[],
    patch: Array<Partial<SubtaskSpec> & WithId>,
) {
    return mergeById(base, patch, mergeSubtask);
}

function mergeOptional<T extends Record<string, unknown>>(base: T | undefined, patch: Partial<T> | undefined) {
    if (!patch) return base;
    return { ...(base ?? {}), ...patch } as T;
}

export function mergeItemSpec(base: ItemSpecV2, patch: ItemSpecPatch): ItemSpecV2 {
    const identity = { ...base.identity, ...patch.identity };
    const breakdown = {
        subtasks: patch.breakdown?.subtasks
            ? mergeSubtaskArray(base.breakdown.subtasks, patch.breakdown.subtasks)
            : base.breakdown.subtasks,
        materials: patch.breakdown?.materials
            ? mergeById(base.breakdown.materials, patch.breakdown.materials, mergeMaterial)
            : base.breakdown.materials,
        labor: patch.breakdown?.labor
            ? mergeById(base.breakdown.labor, patch.breakdown.labor, mergeLabor)
            : base.breakdown.labor,
    };

    const state = {
        openQuestions: patch.state?.openQuestions ?? base.state.openQuestions,
        assumptions: patch.state?.assumptions ?? base.state.assumptions,
        decisions: patch.state?.decisions ?? base.state.decisions,
        alternatives: patch.state?.alternatives ?? base.state.alternatives,
    };

    return {
        ...base,
        version: "ItemSpecV2",
        identity,
        quality: mergeOptional(base.quality, patch.quality),
        budgeting: mergeOptional(base.budgeting, patch.budgeting),
        procurement: mergeOptional(base.procurement, patch.procurement),
        studioWork: mergeOptional(base.studioWork, patch.studioWork),
        logistics: mergeOptional(base.logistics, patch.logistics),
        onsite: mergeOptional(base.onsite, patch.onsite),
        safety: mergeOptional(base.safety, patch.safety),
        breakdown,
        attachments: mergeOptional(base.attachments, patch.attachments),
        state,
        quote: mergeOptional(base.quote, patch.quote),
    };
}
