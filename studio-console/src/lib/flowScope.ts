import type { Id } from "@/convex/_generated/dataModel";

export type FlowTab = "ideation" | "planning" | "solutioning";
export type FlowScopeType = "allProject" | "singleItem" | "multiItem";

export function buildFlowScopeKey(args: {
    scopeType: FlowScopeType;
    scopeItemIds?: Array<Id<"projectItems">> | null;
}) {
    if (args.scopeType === "allProject") return "allProject";

    const ids = (args.scopeItemIds ?? []).map(String).filter(Boolean).sort();
    if (args.scopeType === "singleItem") {
        if (ids.length !== 1) throw new Error("singleItem scope requires exactly 1 itemId");
        return `singleItem:${ids[0]}`;
    }

    if (!ids.length) throw new Error("multiItem scope requires at least 1 itemId");
    return `multiItem:${ids.join(",")}`;
}
