"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useEffect, useMemo, useState } from "react";

type DriveConfigResponse = {
    clientId: string | null;
    redirectUri: string;
    hasClientSecret: boolean;
};

export default function ConnectorsPage() {
    const projects = useQuery(api.projects.listProjects, {});

    const [projectId, setProjectId] = useState<Id<"projects"> | "">("");
    const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
    const [foldersError, setFoldersError] = useState<string | null>(null);
    const [isLoadingFolders, setIsLoadingFolders] = useState(false);
    const [syncingWatchIds, setSyncingWatchIds] = useState<Set<string>>(new Set());
    const [lastSyncResult, setLastSyncResult] = useState<Record<string, { ingestionJobId: string | null }>>({});
    const [driveConfig, setDriveConfig] = useState<DriveConfigResponse | null>(null);
    const [driveConfigDraft, setDriveConfigDraft] = useState({
        clientId: "",
        clientSecret: "",
        redirectUri: "",
    });
    const [savingDriveConfig, setSavingDriveConfig] = useState(false);

    const driveAccount = useQuery(api.drive.getDriveAccount, { ownerUserId: "system" });
    const watches = useQuery(
        api.drive.listWatchesByProject,
        projectId ? { projectId } : "skip"
    );

    const isDriveConnected = driveAccount?.status === "connected";
    const driveEmail = driveAccount?.auth.email ?? null;
    const isDriveConfigured = Boolean(driveConfig?.clientId) && Boolean(driveConfig?.hasClientSecret);

    const watchDriveFolder = useMutation(api.drive.watchDriveFolder);
    const setWatchEnabled = useMutation(api.drive.setWatchEnabled);

    const selectedProject = useMemo(() => {
        if (!projectId || !projects) return null;
        return projects.find((p) => p._id === projectId) ?? null;
    }, [projectId, projects]);

    useEffect(() => {
        if (!projects) return;
        const params = new URLSearchParams(window.location.search);
        const incoming = params.get("projectId");
        if (!incoming) return;
        const exists = projects.some((p) => p._id === incoming);
        if (exists) setProjectId(incoming as Id<"projects">);
    }, [projects]);

    useEffect(() => {
        const load = async () => {
            try {
                const response = await fetch("/api/google-drive/config");
                const json = (await response.json()) as DriveConfigResponse;
                setDriveConfig(json);
                setDriveConfigDraft((prev) => ({
                    ...prev,
                    clientId: json.clientId ?? "",
                    redirectUri: json.redirectUri ?? prev.redirectUri,
                }));
            } catch {
                setDriveConfig(null);
            }
        };
        void load();
    }, []);

    const handleConnectDrive = () => {
        if (!projectId) {
            alert("Select a project first.");
            return;
        }
        if (!isDriveConfigured) {
            alert("Configure Google Drive OAuth first.");
            return;
        }
        const returnTo = "/ingestion/connectors";
        const url = `/api/google-drive/auth/start?projectId=${encodeURIComponent(projectId)}&returnTo=${encodeURIComponent(returnTo)}`;
        window.location.href = url;
    };

    const handleDisconnectDrive = async () => {
        if (!confirm("Disconnect Google Drive?")) return;
        await fetch("/api/google-drive/disconnect", { method: "POST" });
        setFolders([]);
        setFoldersError(null);
    };

    const handleSaveDriveConfig = async () => {
        setSavingDriveConfig(true);
        try {
            const response = await fetch("/api/google-drive/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clientId: driveConfigDraft.clientId,
                    clientSecret: driveConfigDraft.clientSecret,
                    redirectUri: driveConfigDraft.redirectUri,
                }),
            });
            const json = (await response.json()) as DriveConfigResponse & { error?: string };
            if (!response.ok) throw new Error(json.error || "Failed to save config");
            setDriveConfig(json);
            setDriveConfigDraft((prev) => ({ ...prev, clientSecret: "" }));
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to save config";
            alert(message);
        } finally {
            setSavingDriveConfig(false);
        }
    };

    const handleLoadFolders = async () => {
        setIsLoadingFolders(true);
        setFoldersError(null);
        try {
            const response = await fetch("/api/google-drive/folders", { method: "GET" });
            const json = (await response.json()) as { folders?: Array<{ id: string; name: string }>; error?: string };
            if (!response.ok) throw new Error(json.error || "Failed to load folders");
            setFolders(json.folders ?? []);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load folders";
            setFoldersError(message);
        } finally {
            setIsLoadingFolders(false);
        }
    };

    const handleWatchFolder = async (folder: { id: string; name: string }) => {
        if (!projectId) return;
        try {
            await watchDriveFolder({
                projectId,
                ownerUserId: "system",
                folderId: folder.id,
                folderName: folder.name,
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to add watch";
            alert(message);
        }
    };

    const handleSyncWatch = async (watchId: string) => {
        setSyncingWatchIds((prev) => new Set(prev).add(watchId));
        try {
            const response = await fetch("/api/google-drive/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ watchId }),
            });
            const json = (await response.json()) as { ingestionJobId: string | null; error?: string };
            if (!response.ok) throw new Error(json.error || "Sync failed");
            setLastSyncResult((prev) => ({ ...prev, [watchId]: { ingestionJobId: json.ingestionJobId } }));
        } catch (e) {
            const message = e instanceof Error ? e.message : "Sync failed";
            alert(message);
        } finally {
            setSyncingWatchIds((prev) => {
                const next = new Set(prev);
                next.delete(watchId);
                return next;
            });
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <h1 className="text-3xl font-bold mb-8">Data Connectors</h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Google Drive Card */}
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
                    <div className="flex items-center mb-4">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                            <span className="text-blue-600 font-bold">GD</span>
                        </div>
                        <h2 className="text-xl font-semibold">Google Drive</h2>
                    </div>
                    <p className="text-gray-600 mb-4">
                        Connect a Google Drive folder to automatically ingest documents.
                    </p>

                    <div className="mb-6 border border-gray-200 rounded p-3">
                        <div className="text-sm font-medium text-gray-800 mb-2">OAuth setup (local dev)</div>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Client ID</label>
                                <input
                                    type="text"
                                    value={driveConfigDraft.clientId}
                                    onChange={(e) => setDriveConfigDraft((p) => ({ ...p, clientId: e.target.value }))}
                                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                                    placeholder="xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Client Secret</label>
                                <input
                                    type="password"
                                    value={driveConfigDraft.clientSecret}
                                    onChange={(e) => setDriveConfigDraft((p) => ({ ...p, clientSecret: e.target.value }))}
                                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                                    placeholder={driveConfig?.hasClientSecret ? "•••••••• (already set)" : "Enter secret"}
                                />
                                <div className="mt-1 text-[11px] text-gray-500">
                                    Saves to <code>.env.local</code> on this machine; don’t use this flow in production.
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Redirect URI</label>
                                <input
                                    type="text"
                                    value={driveConfigDraft.redirectUri}
                                    onChange={(e) => setDriveConfigDraft((p) => ({ ...p, redirectUri: e.target.value }))}
                                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                                    placeholder="http://localhost:3000/api/google-drive/auth/callback"
                                />
                            </div>
                            <button
                                onClick={handleSaveDriveConfig}
                                disabled={savingDriveConfig}
                                className="w-full bg-gray-900 text-white px-4 py-2 rounded hover:bg-black disabled:opacity-50"
                            >
                                {savingDriveConfig ? "Saving..." : "Save OAuth config"}
                            </button>
                            <div className="text-xs text-gray-600">
                                Status:{" "}
                                {isDriveConfigured ? (
                                    <span className="font-medium text-green-700">configured</span>
                                ) : (
                                    <span className="font-medium text-gray-700">missing</span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                        <select
                            value={projectId}
                            onChange={(e) => setProjectId((e.target.value as Id<"projects">) || "")}
                            className="w-full border border-gray-300 rounded px-3 py-2"
                        >
                            <option value="">Select a project...</option>
                            {projects?.map((p) => (
                                <option key={p._id} value={p._id}>
                                    {p.name} ({p.clientName})
                                </option>
                            ))}
                        </select>
                        {selectedProject ? (
                            <div className="mt-1 text-xs text-gray-500">
                                Status: <span className="capitalize">{selectedProject.status}</span>
                            </div>
                        ) : null}
                    </div>

                    <div className="mb-4 text-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-700">Connection</span>
                            {isDriveConnected ? (
                                <span className="text-green-700 font-medium">Connected</span>
                            ) : (
                                <span className="text-gray-600">Not connected</span>
                            )}
                        </div>
                        {isDriveConnected && driveEmail ? (
                            <div className="text-xs text-gray-500 mt-1">Signed in as {driveEmail}</div>
                        ) : null}
                    </div>

                    <div className="flex gap-2 mb-4">
                        <button
                            onClick={handleConnectDrive}
                            disabled={isDriveConnected || !projectId || !isDriveConfigured}
                            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                            Connect
                        </button>
                        <button
                            onClick={handleDisconnectDrive}
                            disabled={!isDriveConnected}
                            className="flex-1 bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
                        >
                            Disconnect
                        </button>
                    </div>

                    {isDriveConnected && isDriveConfigured ? (
                        <div className="space-y-3">
                            <button
                                onClick={handleLoadFolders}
                                disabled={isLoadingFolders}
                                className="w-full bg-white text-blue-700 border border-blue-200 px-4 py-2 rounded hover:bg-blue-50 disabled:opacity-50"
                            >
                                {isLoadingFolders ? "Loading folders..." : "Load folders"}
                            </button>
                            {foldersError ? (
                                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2">
                                    {foldersError}
                                </div>
                            ) : null}
                            {folders.length > 0 ? (
                                <div className="border border-gray-200 rounded">
                                    <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-200">
                                        Select a folder to watch
                                    </div>
                                    <div className="max-h-56 overflow-auto">
                                        {folders.map((f) => (
                                            <button
                                                key={f.id}
                                                onClick={() => handleWatchFolder(f)}
                                                disabled={!projectId}
                                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                {f.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {projectId && watches ? (
                        <div className="mt-6">
                            <h3 className="text-sm font-medium text-gray-800 mb-2">Watched folders</h3>
                            {watches.length === 0 ? (
                                <div className="text-xs text-gray-500">No watched folders yet.</div>
                            ) : (
                                <div className="space-y-2">
                                    {watches.map((w) => (
                                        <div key={w._id} className="border border-gray-200 rounded p-3">
                                            <div className="flex items-center justify-between">
                                                <div className="text-sm font-medium text-gray-900">{w.name}</div>
                                                <button
                                                    onClick={() => setWatchEnabled({ watchId: w._id, enabled: !w.enabled })}
                                                    className="text-xs text-gray-600 hover:text-gray-900"
                                                >
                                                    {w.enabled ? "Disable" : "Enable"}
                                                </button>
                                            </div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                Last sync:{" "}
                                                {w.cursorState.lastSyncAt
                                                    ? new Date(w.cursorState.lastSyncAt).toLocaleString()
                                                    : "never"}
                                            </div>
                                            <div className="flex items-center gap-2 mt-3">
                                                <button
                                                    onClick={() => handleSyncWatch(w._id)}
                                                    disabled={!w.enabled || syncingWatchIds.has(w._id)}
                                                    className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                                                >
                                                    {syncingWatchIds.has(w._id) ? "Syncing..." : "Sync now"}
                                                </button>
                                                {lastSyncResult[w._id]?.ingestionJobId ? (
                                                    <a
                                                        className="text-sm text-blue-700 hover:underline"
                                                        href={`/ingestion/${lastSyncResult[w._id].ingestionJobId}`}
                                                    >
                                                        Open ingestion job
                                                    </a>
                                                ) : null}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>

                {/* Email Card */}
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200 opacity-75">
                    <div className="flex items-center mb-4">
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mr-3">
                            <span className="text-green-600 font-bold">@</span>
                        </div>
                        <h2 className="text-xl font-semibold">Email Inbound</h2>
                    </div>
                    <p className="text-gray-600 mb-4">
                        Forward emails to <code>project-ID@inbound.yourdomain.com</code>
                    </p>
                    <button disabled className="w-full bg-gray-100 text-gray-500 px-4 py-2 rounded cursor-not-allowed">
                        Active by Default
                    </button>
                </div>

                {/* WhatsApp Card */}
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200 opacity-50">
                    <div className="flex items-center mb-4">
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mr-3">
                            <span className="text-green-600 font-bold">WA</span>
                        </div>
                        <h2 className="text-xl font-semibold">WhatsApp</h2>
                    </div>
                    <p className="text-gray-600 mb-4">
                        Connect WhatsApp Business API.
                    </p>
                    <button disabled className="w-full bg-gray-100 text-gray-500 px-4 py-2 rounded cursor-not-allowed">
                        Coming Soon
                    </button>
                </div>
            </div>
        </div>
    );
}
