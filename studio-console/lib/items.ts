export type PurchaseNeed = {
    id?: string;
    label: string;
    qty?: number;
    unit?: string;
    notes?: string;
};

export type MaterialSpec = {
    id: string;
    category?: string;
    label: string;
    description?: string;
    qty?: number;
    unit?: string;
    unitCostEstimate?: number;
    vendorName?: string;
    procurement?: "in_stock" | "local" | "abroad" | "either";
    status?: string;
    note?: string;
};

export type LaborSpec = {
    id: string;
    workType: string;
    role: string;
    rateType: "hour" | "day" | "flat";
    quantity?: number;
    unitCost?: number;
    description?: string;
};

export type SubtaskSpec = {
    id: string;
    title: string;
    description?: string;
    status?: string;
    estMinutes?: number;
    children?: SubtaskSpec[];
    taskProjection?: {
        createTask: boolean;
        titleOverride?: string;
    };
};

export type AlternativeSpec = {
    title: string;
    description?: string;
    tradeoffs?: string[];
};

export type ItemSpecV2 = {
    version: "ItemSpecV2";
    identity: {
        title: string;
        typeKey: string;
        description?: string;
        tags?: string[];
        accountingGroup?: string;
    };
    quality?: {
        tier: "low" | "medium" | "high";
        notes?: string;
    };
    budgeting?: {
        estimate?: {
            amount?: number;
            currency: "ILS";
            confidence?: number;
        };
        range?: {
            min?: number;
            max?: number;
        };
        notes?: string;
    };
    procurement?: {
        required: boolean;
        channel: "none" | "local" | "abroad" | "both";
        leadTimeDays?: number;
        purchaseList?: PurchaseNeed[];
    };
    studioWork?: {
        required: boolean;
        workTypes?: string[];
        estMinutes?: number;
        buildPlanMarkdown?: string;
        buildPlanJson?: string;
    };
    logistics?: {
        transportRequired: boolean;
        packagingNotes?: string;
        storageRequired?: boolean;
    };
    onsite?: {
        installDays?: number;
        shootDays?: number;
        teardownDays?: number;
        operatorDuringEvent?: boolean;
    };
    safety?: {
        publicInteraction?: boolean;
        electrical?: boolean;
        weightBearing?: boolean;
        notes?: string;
    };
    breakdown: {
        subtasks: SubtaskSpec[];
        materials: MaterialSpec[];
        labor: LaborSpec[];
    };
    attachments?: {
        links?: Array<{
            url: string;
            label?: string;
        }>;
    };
    state: {
        openQuestions: string[];
        assumptions: string[];
        decisions: string[];
        alternatives?: AlternativeSpec[];
    };
    quote?: {
        includeInQuote: boolean;
        clientTextOverride?: string;
        milestones?: Array<{
            name: string;
            date?: string;
        }>;
    };
};

export type ItemUpdateOutput = {
    itemId: string;
    proposedData: ItemSpecV2;
    summaryMarkdown: string;
    changeReason?: string;
};

export function createEmptyItemSpec(title: string, typeKey: string): ItemSpecV2 {
    return {
        version: "ItemSpecV2",
        identity: { title, typeKey },
        breakdown: { subtasks: [], materials: [], labor: [] },
        state: { openQuestions: [], assumptions: [], decisions: [] },
        quote: { includeInQuote: true },
    };
}
