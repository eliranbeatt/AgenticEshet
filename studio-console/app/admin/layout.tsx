"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useMemo, useState } from "react";

const navItems = [
    { href: "/admin/skills", label: "Skills" },
    { href: "/admin/enrichment", label: "Enrichment Profiles" },
    { href: "/admin/settings", label: "Settings" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const requiredKey = process.env.NEXT_PUBLIC_ADMIN_KEY;
    const [enteredKey, setEnteredKey] = useState(() => {
        if (typeof window === "undefined") return "";
        return window.localStorage.getItem("adminKey") ?? "";
    });
    const [draftKey, setDraftKey] = useState("");

    const unlocked = useMemo(() => {
        if (!requiredKey) return true;
        return enteredKey === requiredKey;
    }, [enteredKey, requiredKey]);

    if (!unlocked) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
                <div className="bg-white border rounded-lg shadow-sm p-6 w-full max-w-md space-y-4">
                    <div>
                        <h1 className="text-xl font-semibold text-gray-900">Admin access</h1>
                        <p className="text-sm text-gray-600 mt-1">Enter the admin key to continue.</p>
                    </div>
                    <input
                        className="w-full border rounded px-3 py-2 text-sm"
                        placeholder="Admin key"
                        value={draftKey}
                        onChange={(e) => setDraftKey(e.target.value)}
                    />
                    <button
                        type="button"
                        className="w-full bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                        disabled={!draftKey.trim()}
                        onClick={() => {
                            const next = draftKey.trim();
                            window.localStorage.setItem("adminKey", next);
                            setEnteredKey(next);
                            setDraftKey("");
                        }}
                    >
                        Unlock
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-6xl mx-auto py-10 px-6 space-y-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Admin Console</h1>
                    <p className="text-sm text-gray-500">Manage prompts, skills, and ingestion profiles.</p>
                </div>
                <div className="flex gap-4 border-b">
                    {navItems.map((item) => {
                        const active = pathname.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`pb-2 text-sm font-semibold border-b-2 ${active ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </div>
                <div>{children}</div>
            </div>
        </div>
    );
}
