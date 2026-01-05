"use client";

import * as React from "react";

export type ArtifactInspectorTab = {
    key: string;
    label: string;
    content: React.ReactNode;
};

export function ArtifactInspector({
    activeTab,
    onChangeTab,
    tabs,
    className,
}: {
    activeTab: string;
    onChangeTab: (next: string) => void;
    tabs: ArtifactInspectorTab[];
    className?: string;
}) {
    const active = tabs.find((t) => t.key === activeTab) ?? tabs[0];

    return (
        <div className={className ?? "flex flex-col h-full bg-white border-l w-[360px]"}>
            <div className="flex border-b text-xs overflow-x-auto">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        className={`px-3 py-2 font-medium ${
                            tab.key === active?.key
                                ? "border-b-2 border-blue-500 text-blue-600"
                                : "text-gray-500 hover:text-gray-800"
                        }`}
                        onClick={() => onChangeTab(tab.key)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">{active?.content ?? null}</div>
        </div>
    );
}
