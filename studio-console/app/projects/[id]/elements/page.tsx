"use client";

import { ItemsTreeSidebar } from "../_components/items/ItemsTreeSidebar";
import { ElementsInspectorPanel } from "../_components/elements/ElementsInspectorPanel";

export default function ElementsPage() {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Elements</h2>
                    <p className="text-sm text-gray-500">
                        Elements are the spine. Attach tasks, costs, and quotes to each element.
                    </p>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] min-h-0">
                <ItemsTreeSidebar />
                <ElementsInspectorPanel />
            </div>
        </div>
    );
}
