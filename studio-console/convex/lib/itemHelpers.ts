import type { Doc } from "../_generated/dataModel";
import { ItemSpecV2Schema, type ItemSpecV2 } from "./zodSchemas";

export function parseItemSpec(data: unknown) {
    const parsed = ItemSpecV2Schema.safeParse(data);
    if (!parsed.success) {
        console.error("Invalid ItemSpecV2", parsed.error.flatten());
        throw new Error("Invalid ItemSpecV2");
    }
    return parsed.data;
}

export function buildSearchText(args: { name?: string; description?: string; title?: string; typeKey?: string }) {
    const name = args.name ?? args.title ?? "";
    const description = args.description ?? "";
    const typeKey = args.typeKey ? `\n${args.typeKey}` : "";
    return `${name}\n${description}${typeKey}`.trim();
}

export function buildBaseItemSpec(title: string, typeKey: string, description?: string) {
    return parseItemSpec({
        version: "ItemSpecV2",
        identity: {
            title,
            typeKey,
            description,
        },
    });
}

export function normalizeRateType(rateType: string): "hour" | "day" | "flat" {
    if (rateType === "hour" || rateType === "day" || rateType === "flat") {
        return rateType;
    }
    return "hour";
}

export function buildMaterialSpec(line: Doc<"materialLines">) {
    return {
        id: line.itemMaterialId ?? line._id,
        category: line.category,
        label: line.label,
        description: line.description,
        qty: line.plannedQuantity,
        unit: line.unit,
        unitCostEstimate: line.plannedUnitCost,
        vendorName: line.vendorName,
        procurement: line.procurement,
        status: line.status,
        note: line.note,
    };
}

export function buildLaborSpec(line: Doc<"workLines">) {
    return {
        id: line.itemLaborId ?? line._id,
        workType: line.workType,
        role: line.role,
        rateType: normalizeRateType(line.rateType),
        quantity: line.plannedQuantity,
        unitCost: line.plannedUnitCost,
        description: line.description,
    };
}

export function buildSpecFromAccounting(args: {
    item: Doc<"projectItems">;
    section: Doc<"sections">;
    materials: Doc<"materialLines">[];
    workLines: Doc<"workLines">[];
    baseSpec?: ItemSpecV2;
}) {
    const base = args.baseSpec ?? buildBaseItemSpec(args.item.title, args.item.typeKey);
    return ItemSpecV2Schema.parse({
        ...base,
        identity: {
            ...base.identity,
            title: args.section.name,
            typeKey: base.identity.typeKey,
            description: args.section.description ?? base.identity.description,
            accountingGroup: args.section.group,
        },
        breakdown: {
            ...base.breakdown,
            materials: args.materials.map(buildMaterialSpec),
            labor: args.workLines.map(buildLaborSpec),
        },
    });
}
