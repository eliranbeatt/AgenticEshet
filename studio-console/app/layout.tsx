import type { Metadata } from "next";
// import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import ConvexClientProvider from "./ConvexClientProvider";
import { ThinkingModeProvider } from "./ThinkingModeContext";
import ThinkingModeToggle from "./ThinkingModeToggle";
import "./globals.css";

/*
const geistSans = Geist({
    subsets: ["latin"],
    variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
    subsets: ["latin"],
    variable: "--font-geist-mono",
});
*/

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
            <body className={`antialiased`}>
                <ConvexClientProvider>
                    <ThinkingModeProvider>
                        <div className="flex min-h-screen w-full bg-background text-foreground">
                            <aside className="w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col">
                                <div className="p-6 text-xl font-bold tracking-tight">
                                    Magnetic Studio
                                </div>
                                <nav className="flex-1 px-4 space-y-2 text-sm">
                                    <Link
                                        href="/projects"
                                        className="block rounded px-4 py-2 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                    >
                                        Projects
                                    </Link>
                                    <Link
                                        href="/rag-chat"
                                        className="block rounded px-4 py-2 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                    >
                                        RAG Chat
                                    </Link>
                                    <Link
                                        href="/ingestion"
                                        className="block rounded px-4 py-2 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                    >
                                        Ingestion
                                    </Link>
                                    <Link
                                        href="/management"
                                        className="block rounded px-4 py-2 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                    >
                                        Management
                                    </Link>
                                    <Link
                                        href="/admin"
                                        className="block rounded px-4 py-2 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                    >
                                        Admin
                                    </Link>
                                </nav>
                                <div className="border-t border-sidebar-border p-4 space-y-3">
                                    <ThinkingModeToggle />
                                    <div className="text-xs text-muted-foreground">
                                        Agentic Eshet v0.1
                                    </div>
                                </div>
                            </aside>
                            <main className="flex-1 overflow-auto bg-muted">
                                {children}
                            </main>
                        </div>
                    </ThinkingModeProvider>
                </ConvexClientProvider>
            </body>
        </html>
    );
}
