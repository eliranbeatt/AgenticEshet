"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { type Doc } from "../../convex/_generated/dataModel";
import { Trash2 } from "lucide-react";

type ProjectStage = "ideation" | "planning" | "production" | "done";
type BudgetTier = "low" | "medium" | "high" | "unknown";
type ProjectType = "dressing" | "studio_build" | "print_install" | "big_install_takedown" | "photoshoot";

const stageOptions: Array<{ value: ProjectStage; label: string }> = [
    { value: "ideation", label: "Ideation" },
    { value: "planning", label: "Planning" },
    { value: "production", label: "Production" },
    { value: "done", label: "Done" },
];

const budgetTierOptions: Array<{ value: BudgetTier; label: string }> = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "unknown", label: "Unknown" },
];

const projectTypeOptions: Array<{ value: ProjectType; label: string }> = [
    { value: "dressing", label: "Dressing" },
    { value: "studio_build", label: "Studio build" },
    { value: "print_install", label: "Print / install" },
    { value: "big_install_takedown", label: "Big install / takedown" },
    { value: "photoshoot", label: "Photoshoot" },
];

export default function ProjectsPage() {
    const [search, setSearch] = useState("");
    const [stageFilter, setStageFilter] = useState<ProjectStage | "all">("all");
    const [budgetFilter, setBudgetFilter] = useState<BudgetTier | "all">("all");
    const [selectedTypes, setSelectedTypes] = useState<ProjectType[]>([]);
    const [showArchived, setShowArchived] = useState(false);

    const projectsQuery = useQuery(api.projects.listProjects, {
        stage: stageFilter === "all" ? undefined : stageFilter,
        budgetTier: budgetFilter === "all" ? undefined : budgetFilter,
        projectTypesAny: selectedTypes.length === 0 ? undefined : selectedTypes,
        search: search.trim() ? search.trim() : undefined,
    });

    // Client-side filtering for archive status
    const projects = (projectsQuery || []).filter(p =>
        showArchived ? p.status === "archived" : p.status !== "archived"
    );
    const createProject = useMutation(api.projects.createProject);
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);
    const [projectToDelete, setProjectToDelete] = useState<Doc<"projects"> | null>(null);

    const archiveProject = useMutation(api.projects.archiveProject);
    const deleteProject = useMutation(api.projects.deleteProject);

    const handleTrashClick = (e: React.MouseEvent, project: Doc<"projects">) => {
        e.preventDefault();
        e.stopPropagation();
        setProjectToDelete(project);
    };

    const handleArchive = async () => {
        if (!projectToDelete) return;
        try {
            await archiveProject({ projectId: projectToDelete._id });
        } catch (e) {
            console.error("Failed to archive project", e);
            alert("Failed to archive project");
        }
        setProjectToDelete(null);
    };

    const handleDelete = async () => {
        if (!projectToDelete) return;
        try {
            await deleteProject({ projectId: projectToDelete._id });
        } catch (e) {
            console.error("Failed to delete project", e);
            alert("Failed to delete project");
        }
        setProjectToDelete(null);
    };

    // --- Dev Tool: Seeding ---
    const seedSkills = useMutation(api.seed.seedSkillsPublic);
    const handleSeed = async () => {
        if (!confirm("Initialize system skills? (Run once)")) return;
        try {
            await seedSkills();
            alert("System initialized successfully!");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            alert("Seeding failed: " + message);
        }
    };
    // -------------------------

    const handleCreate = async () => {
        setIsCreating(true);
        try {
            const id = await createProject({
                name: "New Project " + new Date().toLocaleTimeString(),
                clientName: "New Client",
                details: {},
            });
            router.push(`/projects/${id}/overview`);
        } catch (e) {
            console.error(e);
            alert("Failed to create project");
        } finally {
            setIsCreating(false);
        }
    };

    if (projectsQuery === undefined) {
        return <div className="p-8">Loading projects...</div>;
    }

    return (
        <div className="p-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold">Projects {showArchived && " (Archived)"}</h1>
                <div className="flex gap-2">
                    <button
                        onClick={handleSeed}
                        className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300 text-sm font-medium"
                    >
                        Initialize System
                    </button>
                    <button
                        onClick={() => setShowArchived(!showArchived)}
                        className={`px-4 py-2 rounded text-sm font-medium border transition-colors ${showArchived ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                    >
                        {showArchived ? "Show Active" : "Show Archived"}
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={isCreating}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isCreating ? "Creating..." : "New Project"}
                    </button>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Search</label>
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Project or client…"
                            className="w-full border rounded px-3 py-2 text-sm"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Stage</label>
                        <select
                            value={stageFilter}
                            onChange={(event) => setStageFilter(event.target.value as ProjectStage | "all")}
                            className="w-full border rounded px-3 py-2 text-sm bg-white"
                        >
                            <option value="all">All</option>
                            {stageOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Budget</label>
                        <select
                            value={budgetFilter}
                            onChange={(event) => setBudgetFilter(event.target.value as BudgetTier | "all")}
                            className="w-full border rounded px-3 py-2 text-sm bg-white"
                        >
                            <option value="all">All</option>
                            {budgetTierOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="mt-4">
                    <div className="text-xs font-semibold text-gray-600 uppercase mb-2">Types</div>
                    <div className="flex flex-wrap gap-3">
                        {projectTypeOptions.map((opt) => {
                            const checked = selectedTypes.includes(opt.value);
                            return (
                                <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(event) => {
                                            if (event.target.checked) {
                                                setSelectedTypes((prev) => [...prev, opt.value]);
                                            } else {
                                                setSelectedTypes((prev) => prev.filter((t) => t !== opt.value));
                                            }
                                        }}
                                    />
                                    <span>{opt.label}</span>
                                </label>
                            );
                        })}
                        {selectedTypes.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setSelectedTypes([])}
                                className="text-sm text-blue-700 hover:underline"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map((p: Doc<"projects">) => (
                    <Link
                        key={p._id}
                        href={`/projects/${p._id}/overview`}
                        className="block bg-white p-6 rounded-lg shadow hover:shadow-md transition border border-gray-200 relative group"
                    >
                        <button
                            onClick={(e) => handleTrashClick(e, p)}
                            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors opacity-0 group-hover:opacity-100 z-10"
                            title="Delete Project"
                        >
                            <Trash2 size={18} />
                        </button>
                        <div className="flex justify-between items-start mb-2">
                            <h2 className="text-xl font-semibold">{p.name}</h2>
                            <span className={`px-2 py-1 text-xs rounded-full uppercase font-medium ${p.status === "lead" ? "bg-yellow-100 text-yellow-800" :
                                p.status === "planning" ? "bg-blue-100 text-blue-800" :
                                    p.status === "production" ? "bg-green-100 text-green-800" :
                                        "bg-gray-100 text-gray-800"
                                }`}>
                                {p.status}
                            </span>
                        </div>
                        <p className="text-gray-600 mb-4">{p.clientName}</p>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {p.stage && (
                                <span className="px-2 py-1 text-xs rounded-full bg-purple-50 text-purple-800 border border-purple-100">
                                    {p.stage}
                                </span>
                            )}
                            {p.budgetTier && (
                                <span className="px-2 py-1 text-xs rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                    budget: {p.budgetTier}
                                </span>
                            )}
                            {(p.projectTypes ?? []).slice(0, 2).map((type) => (
                                <span
                                    key={type}
                                    className="px-2 py-1 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-100"
                                >
                                    {type}
                                </span>
                            ))}
                            {(p.projectTypes?.length ?? 0) > 2 && (
                                <span className="px-2 py-1 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                                    +{(p.projectTypes?.length ?? 0) - 2}
                                </span>
                            )}
                        </div>
                        <div className="text-sm text-gray-500">
                            Created: {new Date(p.createdAt).toLocaleDateString()}
                        </div>
                    </Link>
                ))}

                {projects.length === 0 && (
                    <div className="col-span-full text-center py-12 text-gray-500 bg-white rounded-lg border border-dashed border-gray-300">
                        No projects found. Create one to get started.
                    </div>
                )}
            </div>

            {projectToDelete && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center gap-3 text-red-600 mb-4">
                            <div className="p-2 bg-red-100 rounded-full">
                                <Trash2 size={24} />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900">Delete Project?</h3>
                        </div>

                        <p className="text-gray-600 mb-6">
                            What would you like to do with <span className="font-semibold text-gray-900">{projectToDelete.name}</span>?
                        </p>

                        <div className="flex flex-col gap-3">
                            <button
                                onClick={handleArchive}
                                className="w-full py-3 px-4 bg-yellow-50 text-yellow-800 hover:bg-yellow-100 border border-yellow-200 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center"
                            >
                                Archive Project
                                <span className="ml-2 text-yellow-600/70 font-normal">(Hide from list, keep data)</span>
                            </button>

                            <button
                                onClick={handleDelete}
                                className="w-full py-3 px-4 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center"
                            >
                                Delete Permanently
                                <span className="ml-2 text-red-600/70 font-normal">(Remove all data)</span>
                            </button>

                            <button
                                onClick={() => setProjectToDelete(null)}
                                className="w-full py-3 px-4 bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200 rounded-lg text-sm font-semibold mt-2 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
