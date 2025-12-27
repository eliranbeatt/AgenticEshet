import type { Doc } from "@/convex/_generated/dataModel";

export type QuoteVisibility = "include" | "exclude" | "optional";

export type CostingOptions = {
    includeManagement: boolean;
    includeOptional: boolean;
    respectVisibility: boolean;
};

type ProjectDefaults = {
    overhead: number;
    risk: number;
    profit: number;
};

export type SectionTotals = {
    plannedMaterialsCostE: number;
    plannedWorkCostS: number;
    plannedDirectCost: number;
    plannedOverhead: number;
    plannedRisk: number;
    plannedProfit: number;
    plannedClientPrice: number;
    actualMaterialsCostE: number;
    actualWorkCostS: number;
    actualDirectCost: number;
    actualOverhead: number;
    actualRisk: number;
    actualProfit: number;
    actualClientPrice: number;
    varianceDirect: number;
};

function shouldIncludeLine(
    line: { isManagement?: boolean; quoteVisibility?: QuoteVisibility | null },
    options: CostingOptions
) {
    if (!options.includeManagement && line.isManagement) return false;
    if (!options.respectVisibility) return true;
    const visibility = line.quoteVisibility ?? "include";
    if (visibility === "exclude") return false;
    if (visibility === "optional" && !options.includeOptional) return false;
    return true;
}

function plannedMaterialCost(line: Doc<"materialLines">) {
    return line.plannedQuantity * line.plannedUnitCost;
}

function actualMaterialCost(line: Doc<"materialLines">) {
    const quantity = line.actualQuantity ?? line.plannedQuantity;
    const unitCost = line.actualUnitCost ?? line.plannedUnitCost;
    return quantity * unitCost;
}

function plannedWorkCost(line: Doc<"workLines">) {
    if (line.rateType === "flat") return line.plannedUnitCost;
    return line.plannedQuantity * line.plannedUnitCost;
}

function actualWorkCost(line: Doc<"workLines">) {
    const quantity = line.actualQuantity ?? line.plannedQuantity;
    const unitCost = line.actualUnitCost ?? line.plannedUnitCost;
    if (line.rateType === "flat") return unitCost;
    return quantity * unitCost;
}

export function calculateSectionStats(
    section: Doc<"sections">,
    materials: Doc<"materialLines">[],
    work: Doc<"workLines">[],
    defaults: ProjectDefaults,
    options: CostingOptions
): SectionTotals {
    const overheadPct = section.overheadPercentOverride ?? defaults.overhead;
    const riskPct = section.riskPercentOverride ?? defaults.risk;
    const profitPct = section.profitPercentOverride ?? defaults.profit;

    const plannedMaterialsCostE = materials.reduce(
        (sum, line) => (shouldIncludeLine(line, options) ? sum + plannedMaterialCost(line) : sum),
        0
    );
    const plannedWorkCostS = work.reduce(
        (sum, line) => (shouldIncludeLine(line, options) ? sum + plannedWorkCost(line) : sum),
        0
    );

    const plannedDirectCost = plannedMaterialsCostE + plannedWorkCostS;
    const plannedOverhead = plannedDirectCost * overheadPct;
    const plannedRisk = plannedDirectCost * riskPct;
    const plannedProfit = plannedDirectCost * profitPct;
    const plannedClientPrice = plannedDirectCost + plannedOverhead + plannedRisk + plannedProfit;

    const actualMaterialsCostE = materials.reduce(
        (sum, line) => (shouldIncludeLine(line, options) ? sum + actualMaterialCost(line) : sum),
        0
    );
    const actualWorkCostS = work.reduce(
        (sum, line) => (shouldIncludeLine(line, options) ? sum + actualWorkCost(line) : sum),
        0
    );

    const actualDirectCost = actualMaterialsCostE + actualWorkCostS;
    const actualOverhead = actualDirectCost * overheadPct;
    const actualRisk = actualDirectCost * riskPct;
    const actualProfit = actualDirectCost * profitPct;
    const actualClientPrice = actualDirectCost + actualOverhead + actualRisk + actualProfit;

    return {
        plannedMaterialsCostE,
        plannedWorkCostS,
        plannedDirectCost,
        plannedOverhead,
        plannedRisk,
        plannedProfit,
        plannedClientPrice,
        actualMaterialsCostE,
        actualWorkCostS,
        actualDirectCost,
        actualOverhead,
        actualRisk,
        actualProfit,
        actualClientPrice,
        varianceDirect: actualDirectCost - plannedDirectCost,
    };
}
