"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

const navItems = [
    { href: "/admin/skills", label: "Skills" },
    { href: "/admin/enrichment", label: "Enrichment Profiles" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
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
