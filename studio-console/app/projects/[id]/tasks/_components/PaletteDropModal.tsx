"use client";

import { useMemo, useState } from "react";
import type { PaletteElement } from "./ElementsPalette";

type PhaseOption = "ideation" | "planning" | "solutioning" | "tasks";

export function PaletteDropModal({
    element,
    defaultStatus,
    onClose,
    onConfirm,
}: {
    element: PaletteElement;
    defaultStatus: string;
    onClose: () => void;
    onConfirm: (args: {
        targetStatus: string;
        phase: PhaseOption;
        startDate: number | null;
        endDate: number | null;
    }) => void;
}) {
    const [targetStatus, setTargetStatus] = useState(defaultStatus);
    const [phase, setPhase] = useState<PhaseOption>(element.stageHint ?? "tasks");
    const defaultStart = useMemo(() => new Date().toISOString().slice(0, 10), []);
    const [startDate, setStartDate] = useState(defaultStart);
    const [endDate, setEndDate] = useState(defaultStart);

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-lg w-full max-w-lg">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div>
                        <div className="text-sm font-semibold text-gray-800">Confirm drop</div>
                        <div className="text-xs text-gray-500">
                            Prefill the required fields for where this element should land.
                        </div>
                    </div>
                    <button
                        type="button"
                        className="text-xs text-gray-500 hover:text-gray-700"
                        onClick={onClose}
                    >
                        Close
                    </button>
                </div>

                <div className="p-4 space-y-3 text-sm">
                    <div>
                        <div className="text-[11px] uppercase text-gray-500 font-semibold">Element</div>
                        <div className="font-semibold text-gray-900">{element.title}</div>
                        {element.description && <div className="text-xs text-gray-600">{element.description}</div>}
                    </div>

                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[11px] uppercase text-gray-500 font-semibold">Kanban column</span>
                        <select
                            value={targetStatus}
                            onChange={(e) => setTargetStatus(e.target.value)}
                            className="border rounded px-3 py-2 text-sm"
                        >
                            <option value="todo">To Do</option>
                            <option value="in_progress">In Progress</option>
                            <option value="blocked">Blocked</option>
                            <option value="done">Done</option>
                        </select>
                    </label>

                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[11px] uppercase text-gray-500 font-semibold">Studio phase</span>
                        <select
                            value={phase}
                            onChange={(e) => setPhase(e.target.value as PhaseOption)}
                            className="border rounded px-3 py-2 text-sm"
                        >
                            <option value="ideation">Ideation</option>
                            <option value="planning">Planning</option>
                            <option value="solutioning">Solutioning</option>
                            <option value="tasks">Tasks</option>
                        </select>
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-[11px] uppercase text-gray-500 font-semibold">Gantt start</span>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="border rounded px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-[11px] uppercase text-gray-500 font-semibold">Gantt end</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="border rounded px-3 py-2 text-sm"
                            />
                        </label>
                    </div>
                </div>

                <div className="flex justify-end gap-2 px-4 py-3 border-t bg-gray-50">
                    <button
                        type="button"
                        className="text-sm px-3 py-2 rounded border border-gray-200 text-gray-700"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="text-sm px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                        onClick={() =>
                            onConfirm({
                                targetStatus,
                                phase,
                                startDate: startDate ? new Date(startDate).getTime() : null,
                                endDate: endDate ? new Date(endDate).getTime() : null,
                            })
                        }
                    >
                        Create tasks
                    </button>
                </div>
            </div>
        </div>
    );
}
