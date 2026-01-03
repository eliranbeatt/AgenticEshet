"use client";

import GanttView from "../../gantt/_components/GanttView";

export default function TasksGantt() {
    return (
        <div className="h-full flex flex-col bg-white rounded shadow-sm overflow-hidden">
            <GanttView />
        </div>
    );
}
