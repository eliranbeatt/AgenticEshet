export type ProjectStage = "ideation" | "planning" | "production" | "done";
export type BudgetTier = "low" | "medium" | "high" | "unknown";
export type ProjectType = "dressing" | "studio_build" | "print_install" | "big_install_takedown" | "photoshoot";

export type ProjectListFilters = {
    stage?: ProjectStage;
    budgetTier?: BudgetTier;
    projectTypesAny?: ProjectType[];
    status?: "lead" | "planning" | "production" | "archived";
    search?: string;
};

type ProjectRow = {
    name: string;
    clientName: string;
    stage?: ProjectStage;
    budgetTier?: BudgetTier;
    projectTypes?: ProjectType[];
    status: "lead" | "planning" | "production" | "archived";
};

export function filterProjects<TProject extends ProjectRow>(projects: TProject[], filters: ProjectListFilters) {
    const trimmedSearch = filters.search?.trim().toLowerCase();
    const activeTypes = (filters.projectTypesAny ?? []).filter(Boolean);

    return projects.filter((project) => {
        if (filters.stage && project.stage !== filters.stage) return false;
        if (filters.status && project.status !== filters.status) return false;
        if (filters.budgetTier && project.budgetTier !== filters.budgetTier) return false;
        if (activeTypes.length > 0) {
            const types = project.projectTypes ?? [];
            const hasAny = activeTypes.some((type) => types.includes(type));
            if (!hasAny) return false;
        }
        if (trimmedSearch) {
            const haystack = `${project.name} ${project.clientName}`.toLowerCase();
            if (!haystack.includes(trimmedSearch)) return false;
        }
        return true;
    });
}

