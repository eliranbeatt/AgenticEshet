import { Doc, Id } from "../_generated/dataModel";
import { QueryCtx } from "../_generated/server";

export type ProjectPricingPolicy = Doc<"projectPricingPolicy">;
export type RoleCatalog = Doc<"roleCatalog">;
export type ProjectRoleRate = Doc<"projectRoleRates">;

/**
 * Fetches the project's pricing policy or returns defaults.
 * Defaults: Overhead 15%, Risk 10%, Profit 30% (multiplier ~1.55)
 */
export async function getProjectPricingPolicy(
    ctx: QueryCtx,
    projectId: Id<"projects">
): Promise<ProjectPricingPolicy> {
    const policy = await ctx.db
        .query("projectPricingPolicy")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .unique();

    if (policy) return policy;

    // Return default policy if none exists
    return {
        _id: "default" as Id<"projectPricingPolicy">,
        _creationTime: 0,
        projectId,
        overheadPct: 0.15,
        riskPct: 0.10,
        profitPct: 0.30,
        currency: "ILS",
    };
}

/**
 * Helper to get the effective rate for a role in a project.
 * Hierarchy: Project Override > Global Catalog > Default (0)
 */
export async function getEffectiveRoleRates(
    ctx: QueryCtx,
    projectId: Id<"projects">
): Promise<Map<string, number>> {
    const [globalRoles, projectRates] = await Promise.all([
        ctx.db.query("roleCatalog").collect(),
        ctx.db
            .query("projectRoleRates")
            .withIndex("by_project_role", (q) => q.eq("projectId", projectId))
            .collect(),
    ]);

    const rateMap = new Map<string, number>();

    // 1. Fill with global defaults
    for (const role of globalRoles) {
        rateMap.set(role.roleName, role.defaultRatePerDay);
    }

    // 2. Override with project specific rates
    for (const pRate of projectRates) {
        rateMap.set(pRate.roleName, pRate.ratePerDay);
    }

    return rateMap;
}

/**
 * Calculates the total client price based on base cost and policy.
 * Formula: Cost * (1 + Overhead + Risk + Profit)
 */
export function calculateClientPrice(
    baseCost: number,
    policy: ProjectPricingPolicy
): number {
    const multiplier = 1 + policy.overheadPct + policy.riskPct + policy.profitPct;
    return baseCost * multiplier;
}
