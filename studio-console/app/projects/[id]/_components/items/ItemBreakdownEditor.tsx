"use client";

import { ItemSpecV2, LaborSpec, MaterialSpec, SubtaskSpec } from "../../../../../lib/items";

function createId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ItemBreakdownEditor({
    spec,
    onChange,
}: {
    spec: ItemSpecV2;
    onChange: (spec: ItemSpecV2) => void;
}) {
    const updateMaterials = (materials: MaterialSpec[]) => {
        onChange({
            ...spec,
            breakdown: {
                ...spec.breakdown,
                materials,
            },
        });
    };

    const updateLabor = (labor: LaborSpec[]) => {
        onChange({
            ...spec,
            breakdown: {
                ...spec.breakdown,
                labor,
            },
        });
    };

    const updateSubtasks = (subtasks: SubtaskSpec[]) => {
        onChange({
            ...spec,
            breakdown: {
                ...spec.breakdown,
                subtasks,
            },
        });
    };

    return (
        <div className="space-y-6">
            <SectionTitle title="Subtasks" />
            <div className="space-y-3">
                {spec.breakdown.subtasks.length === 0 ? (
                    <div className="text-sm text-gray-500">No subtasks yet.</div>
                ) : (
                    spec.breakdown.subtasks.map((task, index) => (
                        <div key={task.id} className="border rounded p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-semibold text-gray-600">Subtask {index + 1}</div>
                                <button
                                    type="button"
                                    className="text-xs text-red-600 hover:text-red-800"
                                    onClick={() => {
                                        updateSubtasks(spec.breakdown.subtasks.filter((t) => t.id !== task.id));
                                    }}
                                >
                                    Remove
                                </button>
                            </div>
                            <input
                                className="w-full border rounded px-2 py-1 text-sm"
                                value={task.title}
                                onChange={(e) => {
                                    const next = spec.breakdown.subtasks.map((t) =>
                                        t.id === task.id ? { ...t, title: e.target.value } : t,
                                    );
                                    updateSubtasks(next);
                                }}
                                placeholder="Title"
                            />
                            <textarea
                                className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[80px]"
                                value={task.description ?? ""}
                                onChange={(e) => {
                                    const next = spec.breakdown.subtasks.map((t) =>
                                        t.id === task.id ? { ...t, description: e.target.value } : t,
                                    );
                                    updateSubtasks(next);
                                }}
                                placeholder="Description"
                            />
                            <div className="grid gap-2 md:grid-cols-2">
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={task.status ?? ""}
                                    onChange={(e) => {
                                        const next = spec.breakdown.subtasks.map((t) =>
                                            t.id === task.id ? { ...t, status: e.target.value } : t,
                                        );
                                        updateSubtasks(next);
                                    }}
                                    placeholder="Status (todo, in_progress...)"
                                />
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={task.estMinutes?.toString() ?? ""}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        const next = spec.breakdown.subtasks.map((t) =>
                                            t.id === task.id
                                                ? { ...t, estMinutes: value ? Number(value) : undefined }
                                                : t,
                                        );
                                        updateSubtasks(next);
                                    }}
                                    placeholder="Estimated minutes"
                                />
                            </div>
                        </div>
                    ))
                )}
                <button
                    type="button"
                    className="text-sm px-3 py-2 rounded border bg-white hover:bg-gray-50"
                    onClick={() => {
                        const next: SubtaskSpec = {
                            id: createId("ST"),
                            title: "New subtask",
                        };
                        updateSubtasks([...spec.breakdown.subtasks, next]);
                    }}
                >
                    Add subtask
                </button>
            </div>

            <SectionTitle title="Materials" />
            <div className="space-y-3">
                {spec.breakdown.materials.length === 0 ? (
                    <div className="text-sm text-gray-500">No materials yet.</div>
                ) : (
                    spec.breakdown.materials.map((material, index) => (
                        <div key={material.id} className="border rounded p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-semibold text-gray-600">Material {index + 1}</div>
                                <button
                                    type="button"
                                    className="text-xs text-red-600 hover:text-red-800"
                                    onClick={() => {
                                        updateMaterials(spec.breakdown.materials.filter((m) => m.id !== material.id));
                                    }}
                                >
                                    Remove
                                </button>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={material.label}
                                    onChange={(e) => {
                                        const next = spec.breakdown.materials.map((m) =>
                                            m.id === material.id ? { ...m, label: e.target.value } : m,
                                        );
                                        updateMaterials(next);
                                    }}
                                    placeholder="Label"
                                />
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={material.category ?? ""}
                                    onChange={(e) => {
                                        const next = spec.breakdown.materials.map((m) =>
                                            m.id === material.id ? { ...m, category: e.target.value } : m,
                                        );
                                        updateMaterials(next);
                                    }}
                                    placeholder="Category"
                                />
                            </div>
                            <textarea
                                className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[80px]"
                                value={material.description ?? ""}
                                onChange={(e) => {
                                    const next = spec.breakdown.materials.map((m) =>
                                        m.id === material.id ? { ...m, description: e.target.value } : m,
                                    );
                                    updateMaterials(next);
                                }}
                                placeholder="Description"
                            />
                            <div className="grid gap-2 md:grid-cols-4">
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={material.qty?.toString() ?? ""}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        const next = spec.breakdown.materials.map((m) =>
                                            m.id === material.id ? { ...m, qty: value ? Number(value) : undefined } : m,
                                        );
                                        updateMaterials(next);
                                    }}
                                    placeholder="Qty"
                                />
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={material.unit ?? ""}
                                    onChange={(e) => {
                                        const next = spec.breakdown.materials.map((m) =>
                                            m.id === material.id ? { ...m, unit: e.target.value } : m,
                                        );
                                        updateMaterials(next);
                                    }}
                                    placeholder="Unit"
                                />
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={material.unitCostEstimate?.toString() ?? ""}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        const next = spec.breakdown.materials.map((m) =>
                                            m.id === material.id
                                                ? { ...m, unitCostEstimate: value ? Number(value) : undefined }
                                                : m,
                                        );
                                        updateMaterials(next);
                                    }}
                                    placeholder="Unit cost"
                                />
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={material.vendorName ?? ""}
                                    onChange={(e) => {
                                        const next = spec.breakdown.materials.map((m) =>
                                            m.id === material.id ? { ...m, vendorName: e.target.value } : m,
                                        );
                                        updateMaterials(next);
                                    }}
                                    placeholder="Vendor"
                                />
                            </div>
                        </div>
                    ))
                )}
                <button
                    type="button"
                    className="text-sm px-3 py-2 rounded border bg-white hover:bg-gray-50"
                    onClick={() => {
                        const next: MaterialSpec = {
                            id: createId("MAT"),
                            label: "New material",
                        };
                        updateMaterials([...spec.breakdown.materials, next]);
                    }}
                >
                    Add material
                </button>
            </div>

            <SectionTitle title="Labor" />
            <div className="space-y-3">
                {spec.breakdown.labor.length === 0 ? (
                    <div className="text-sm text-gray-500">No labor yet.</div>
                ) : (
                    spec.breakdown.labor.map((labor, index) => (
                        <div key={labor.id} className="border rounded p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-semibold text-gray-600">Labor {index + 1}</div>
                                <button
                                    type="button"
                                    className="text-xs text-red-600 hover:text-red-800"
                                    onClick={() => {
                                        updateLabor(spec.breakdown.labor.filter((l) => l.id !== labor.id));
                                    }}
                                >
                                    Remove
                                </button>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={labor.workType}
                                    onChange={(e) => {
                                        const next = spec.breakdown.labor.map((l) =>
                                            l.id === labor.id ? { ...l, workType: e.target.value } : l,
                                        );
                                        updateLabor(next);
                                    }}
                                    placeholder="Work type"
                                />
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={labor.role}
                                    onChange={(e) => {
                                        const next = spec.breakdown.labor.map((l) =>
                                            l.id === labor.id ? { ...l, role: e.target.value } : l,
                                        );
                                        updateLabor(next);
                                    }}
                                    placeholder="Role"
                                />
                            </div>
                            <div className="grid gap-2 md:grid-cols-3">
                                <select
                                    className="border rounded px-2 py-1 text-sm"
                                    value={labor.rateType}
                                    onChange={(e) => {
                                        const next = spec.breakdown.labor.map((l) =>
                                            l.id === labor.id
                                                ? { ...l, rateType: e.target.value as LaborSpec["rateType"] }
                                                : l,
                                        );
                                        updateLabor(next);
                                    }}
                                >
                                    <option value="hour">Hourly</option>
                                    <option value="day">Daily</option>
                                    <option value="flat">Flat</option>
                                </select>
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={labor.quantity?.toString() ?? ""}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        const next = spec.breakdown.labor.map((l) =>
                                            l.id === labor.id ? { ...l, quantity: value ? Number(value) : undefined } : l,
                                        );
                                        updateLabor(next);
                                    }}
                                    placeholder="Quantity"
                                />
                                <input
                                    className="border rounded px-2 py-1 text-sm"
                                    value={labor.unitCost?.toString() ?? ""}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        const next = spec.breakdown.labor.map((l) =>
                                            l.id === labor.id ? { ...l, unitCost: value ? Number(value) : undefined } : l,
                                        );
                                        updateLabor(next);
                                    }}
                                    placeholder="Unit cost"
                                />
                            </div>
                            <textarea
                                className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[70px]"
                                value={labor.description ?? ""}
                                onChange={(e) => {
                                    const next = spec.breakdown.labor.map((l) =>
                                        l.id === labor.id ? { ...l, description: e.target.value } : l,
                                    );
                                    updateLabor(next);
                                }}
                                placeholder="Description"
                            />
                        </div>
                    ))
                )}
                <button
                    type="button"
                    className="text-sm px-3 py-2 rounded border bg-white hover:bg-gray-50"
                    onClick={() => {
                        const next: LaborSpec = {
                            id: createId("LAB"),
                            workType: "general",
                            role: "General labor",
                            rateType: "hour",
                        };
                        updateLabor([...spec.breakdown.labor, next]);
                    }}
                >
                    Add labor
                </button>
            </div>
        </div>
    );
}

function SectionTitle({ title }: { title: string }) {
    return <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{title}</div>;
}
