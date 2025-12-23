"use client";

import { type Doc } from "@/convex/_generated/dataModel";

export type SectionStats = {
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

export type ProjectAccountingSection = {
    section: Doc<"sections">;
    materials: Doc<"materialLines">[];
    work: Doc<"workLines">[];
    stats: SectionStats;
    item?: Doc<"projectItems"> | null;
};

export type ProjectAccountingData = {
    project: Doc<"projects">;
    sections: ProjectAccountingSection[];
    totals: {
        plannedDirect: number;
        plannedClientPrice: number;
        actualDirect: number;
    };
};


