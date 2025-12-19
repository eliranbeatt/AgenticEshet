import { describe, expect, it } from "vitest";
import { filterProjects } from "./projects";

describe("filterProjects", () => {
    const projects = [
        {
            name: "Tel Aviv showroom",
            clientName: "Client A",
            status: "lead" as const,
            stage: "ideation" as const,
            budgetTier: "low" as const,
            projectTypes: ["studio_build"] as const,
        },
        {
            name: "Fashion shoot",
            clientName: "Client B",
            status: "planning" as const,
            stage: "planning" as const,
            budgetTier: "high" as const,
            projectTypes: ["photoshoot", "dressing"] as const,
        },
        {
            name: "Archived install",
            clientName: "Client C",
            status: "archived" as const,
            stage: "done" as const,
            budgetTier: "unknown" as const,
            projectTypes: ["big_install_takedown"] as const,
        },
    ];

    it("filters by stage", () => {
        expect(filterProjects(projects, { stage: "planning" }).map((p) => p.name)).toEqual(["Fashion shoot"]);
    });

    it("filters by any project type", () => {
        expect(
            filterProjects(projects, { projectTypesAny: ["dressing", "print_install"] }).map((p) => p.name)
        ).toEqual(["Fashion shoot"]);
    });

    it("filters by search across name+client", () => {
        expect(filterProjects(projects, { search: "client c" }).map((p) => p.name)).toEqual(["Archived install"]);
    });
});

