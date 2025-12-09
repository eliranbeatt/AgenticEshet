import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ConvexClientProvider from "./ConvexClientProvider";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "Magnetic Studio Console",
    description: "Agentic Eshet Project Management",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={inter.className}>
                <ConvexClientProvider>
                    <div className="flex h-screen w-full bg-gray-100 text-gray-900">
                        {/* Sidebar */}
                        <aside className="w-64 bg-gray-900 text-white flex flex-col">
                            <div className="p-6 text-xl font-bold tracking-tight">
                                Magnetic Studio
                            </div>
                            <nav className="flex-1 px-4 space-y-2">
                                <Link
                                    href="/projects"
                                    className="block px-4 py-2 rounded hover:bg-gray-800 transition"
                                >
                                    Projects
                                </Link>
                                <Link
                                    href="/ingestion"
                                    className="block px-4 py-2 rounded hover:bg-gray-800 transition"
                                >
                                    Ingestion
                                </Link>
                                <Link
                                    href="/admin"
                                    className="block px-4 py-2 rounded hover:bg-gray-800 transition"
                                >
                                    Admin
                                </Link>
                            </nav>
                            <div className="p-4 text-xs text-gray-500 border-t border-gray-800">
                                Agentic Eshet v0.1
                            </div>
                        </aside>

                        {/* Main Content */}
                        <main className="flex-1 overflow-auto">
                            {children}
                        </main>
                    </div>
                </ConvexClientProvider>
            </body>
        </html>
    );
}
