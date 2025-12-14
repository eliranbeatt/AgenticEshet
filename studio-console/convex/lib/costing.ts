import { Doc } from "../_generated/dataModel";

type Money = number;

export interface ProjectPricingDefaults {
    currency: string;
    overhead: number;
    risk: number;
    profit: number;
}

export interface SectionCostSnapshot {
    plannedMaterialsCostE: Money;
    plannedWorkCostS: Money;
    plannedDirectCost: Money;
    plannedOverhead: Money;
    plannedRisk: Money;
    plannedProfit: Money;
    plannedClientPrice: Money;

    actualMaterialsCostE: Money;
    actualWorkCostS: Money;
    actualDirectCost: Money;
    actualOverhead: Money;
    actualRisk: Money;
    actualProfit: Money;
    actualClientPrice: Money;

    varianceDirect: Money;
}

export function getProjectPricingDefaults(project: Doc<"projects">): ProjectPricingDefaults {
    return {
        currency: project.currency ?? "ILS",
        overhead: project.overheadPercent ?? 0.15,
        risk: project.riskPercent ?? 0.10,
        profit: project.profitPercent ?? 0.30,
    };
}

export function calculateSectionSnapshot(
    section: Doc<"sections">,
    materials: Doc<"materialLines">[],
    work: Doc<"workLines">[],
    projectDefaults: { overhead: number; risk: number; profit: number },
): SectionCostSnapshot {
    const overheadPct = section.overheadPercentOverride ?? projectDefaults.overhead;
    const riskPct = section.riskPercentOverride ?? projectDefaults.risk;
    const profitPct = section.profitPercentOverride ?? projectDefaults.profit;

    const plannedMaterialsCostE = materials.reduce(
        (sum, material) => sum + material.plannedQuantity * material.plannedUnitCost,
        0,
    );
    const plannedWorkCostS = work.reduce((sum, workLine) => {
        const cost =
            workLine.rateType === "flat"
                ? workLine.plannedUnitCost
                : workLine.plannedQuantity * workLine.plannedUnitCost;
        return sum + cost;
    }, 0);

    const plannedDirectCost = plannedMaterialsCostE + plannedWorkCostS;
    const plannedOverhead = plannedDirectCost * overheadPct;
    const plannedRisk = plannedDirectCost * riskPct;
    const plannedProfit = plannedDirectCost * profitPct;
    const plannedClientPrice = plannedDirectCost + plannedOverhead + plannedRisk + plannedProfit;

    const actualMaterialsCostE = materials.reduce((sum, material) => {
        const quantity = material.actualQuantity ?? material.plannedQuantity;
        const unitCost = material.actualUnitCost ?? material.plannedUnitCost;
        return sum + quantity * unitCost;
    }, 0);

    const actualWorkCostS = work.reduce((sum, workLine) => {
        const quantity = workLine.actualQuantity ?? workLine.plannedQuantity;
        const unitCost = workLine.actualUnitCost ?? workLine.plannedUnitCost;
        const cost = workLine.rateType === "flat" ? unitCost : quantity * unitCost;
        return sum + cost;
    }, 0);

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

