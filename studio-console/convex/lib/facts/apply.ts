import { MutationCtx } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

type FactPayload = {
    key: string;
    value: any;
    scopeType: "project" | "item";
    itemId?: Id<"projectItems"> | null;
};

type DimensionFact = {
    width?: any;
    height?: any;
    depth?: any;
};

function isPlainObject(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatFactValue(value: any) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (typeof value === "object") {
        if ("value" in value && "unit" in value) {
            return `${value.value} ${value.unit}`.trim();
        }
        if ("min" in value || "max" in value) {
            const min = value.min ?? "";
            const max = value.max ?? "";
            return `${min}-${max}`.replace(/^-/, "").replace(/-$/, "");
        }
        if ("iso" in value) {
            return String(value.iso);
        }
    }
    return JSON.stringify(value);
}

function buildDimensionsLabel(dimensions: DimensionFact) {
    const parts = [];
    const width = formatFactValue(dimensions.width);
    const height = formatFactValue(dimensions.height);
    const depth = formatFactValue(dimensions.depth);
    if (width) parts.push(`W: ${width}`);
    if (height) parts.push(`H: ${height}`);
    if (depth) parts.push(`D: ${depth}`);
    return parts.length ? parts.join(", ") : "";
}

export async function applyFactsToItems(
    ctx: MutationCtx,
    projectId: Id<"projects">,
    facts: FactPayload[],
) {
    const factsByItem = new Map<Id<"projectItems">, FactPayload[]>();

    for (const fact of facts) {
        if (fact.scopeType !== "item" || !fact.itemId) continue;
        const list = factsByItem.get(fact.itemId) ?? [];
        list.push(fact);
        factsByItem.set(fact.itemId, list);
    }

    for (const [itemId, itemFacts] of factsByItem) {
        const item = await ctx.db.get(itemId);
        if (!item || item.projectId !== projectId) continue;

        const manualOverrides = isPlainObject(item.manualOverrides) ? { ...item.manualOverrides } : {};
        const existingFacts = isPlainObject(manualOverrides.facts) ? { ...manualOverrides.facts } : {};
        const dimensionFacts = isPlainObject(existingFacts.dimensions) ? { ...existingFacts.dimensions } : {};
        const materialFacts = isPlainObject(existingFacts.materials) ? { ...existingFacts.materials } : {};
        const productionFacts = isPlainObject(existingFacts.production) ? { ...existingFacts.production } : {};
        const miscFacts = isPlainObject(existingFacts.misc) ? { ...existingFacts.misc } : {};

        let changed = false;

        for (const fact of itemFacts) {
            switch (fact.key) {
                case "item.dimensions.width": {
                    if (JSON.stringify(dimensionFacts.width) !== JSON.stringify(fact.value)) {
                        dimensionFacts.width = fact.value;
                        changed = true;
                    }
                    break;
                }
                case "item.dimensions.height": {
                    if (JSON.stringify(dimensionFacts.height) !== JSON.stringify(fact.value)) {
                        dimensionFacts.height = fact.value;
                        changed = true;
                    }
                    break;
                }
                case "item.dimensions.depth": {
                    if (JSON.stringify(dimensionFacts.depth) !== JSON.stringify(fact.value)) {
                        dimensionFacts.depth = fact.value;
                        changed = true;
                    }
                    break;
                }
                case "item.materials.primary": {
                    if (materialFacts.primary !== fact.value) {
                        materialFacts.primary = fact.value;
                        changed = true;
                    }
                    break;
                }
                case "item.production.method": {
                    if (productionFacts.method !== fact.value) {
                        productionFacts.method = fact.value;
                        changed = true;
                    }
                    break;
                }
                default: {
                    if (JSON.stringify(miscFacts[fact.key]) !== JSON.stringify(fact.value)) {
                        miscFacts[fact.key] = fact.value;
                        changed = true;
                    }
                    break;
                }
            }
        }

        if (!changed) continue;

        const nextFacts = {
            ...existingFacts,
            dimensions: dimensionFacts,
            materials: materialFacts,
            production: productionFacts,
            misc: miscFacts,
        };

        manualOverrides.facts = nextFacts;

        const patch: Record<string, any> = {
            manualOverrides,
            updatedAt: Date.now(),
        };

        const dimensionLabel = buildDimensionsLabel(dimensionFacts);
        if (dimensionLabel) {
            const scope = isPlainObject(item.scope) ? { ...item.scope } : {};
            scope.dimensions = dimensionLabel;
            patch.scope = scope;
        }

        await ctx.db.patch(itemId, patch);
    }
}
