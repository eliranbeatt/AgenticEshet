"use client";

import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { Grip, Plus, Sparkles } from "lucide-react";

export type PaletteElement = {
    id: string;
    title: string;
    description?: string;
    source: "preset" | "template" | "custom";
    stageHint?: "ideation" | "planning" | "solutioning" | "tasks";
    tasks: Array<{
        title: string;
        category?: string;
        priority?: string;
        estimatedMinutes?: number;
        steps?: string[];
    }>;
};

function PaletteCard({
    element,
    onSelect,
    isActive,
}: {
    element: PaletteElement;
    onSelect: (element: PaletteElement) => void;
    isActive: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: element.id,
        data: { presetId: element.id, preset: element },
    });

    const style = {
        transform: transform ? CSS.Transform.toString(transform) : undefined,
        opacity: isDragging ? 0.6 : 1,
    } as React.CSSProperties;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`border rounded-lg p-3 bg-white shadow-sm hover:shadow cursor-grab transition relative ${
                isActive ? "ring-2 ring-purple-400" : ""
            }`}
            {...attributes}
            {...listeners}
        >
            <div className="flex items-start gap-2">
                <div className="flex-none text-gray-400 mt-0.5">
                    <Grip size={14} />
                </div>
                <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="font-semibold text-sm text-gray-900 truncate">{element.title}</div>
                        <span
                            className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide ${
                                element.source === "template"
                                    ? "bg-blue-50 text-blue-700"
                                    : element.source === "custom"
                                        ? "bg-emerald-50 text-emerald-700"
                                        : "bg-purple-50 text-purple-700"
                            }`}
                        >
                            {element.source === "template" ? "Template" : element.source === "custom" ? "Custom" : "Preset"}
                        </span>
                    </div>
                    {element.description && (
                        <div className="text-xs text-gray-600 line-clamp-2">{element.description}</div>
                    )}
                    <div className="text-[10px] text-gray-500 flex items-center gap-1">
                        <Sparkles size={12} />
                        {element.tasks.length} task{element.tasks.length === 1 ? "" : "s"}
                        {element.stageHint ? ` · ${element.stageHint}` : null}
                    </div>
                </div>
            </div>
            <div className="mt-3">
                <button
                    type="button"
                    className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                    onClick={() => onSelect(element)}
                >
                    <Plus size={12} /> Quick drop
                </button>
            </div>
        </div>
    );
}

export function ElementsPalette({
    elements,
    onSelect,
    activePresetId,
}: {
    elements: PaletteElement[];
    onSelect: (element: PaletteElement) => void;
    activePresetId: string | null;
}) {
    return (
        <div className="border rounded-lg bg-gray-50 p-3 space-y-3">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Elements palette
                    </div>
                    <div className="text-[11px] text-gray-500">
                        Drag presets into any column or click Quick drop to open the context modal.
                    </div>
                </div>
                <div className="text-[10px] bg-white border rounded-full px-2 py-1 text-gray-600">
                    Reusable templates & checklists
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {elements.map((element) => (
                    <PaletteCard
                        key={element.id}
                        element={element}
                        onSelect={onSelect}
                        isActive={activePresetId === element.id}
                    />
                ))}
                {elements.length === 0 && (
                    <div className="text-xs text-gray-500">No palette entries yet. Save a task as a reusable element.</div>
                )}
            </div>
        </div>
    );
}
