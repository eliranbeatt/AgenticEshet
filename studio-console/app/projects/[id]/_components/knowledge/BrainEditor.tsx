"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { ApprovedElementsView } from "./ApprovedElementsView";

type Bullet = {
    id: string;
    text: string;
    tags?: string[];
    status: "accepted" | "proposed" | "tombstoned";
    confidence: "high" | "medium" | "low";
    source?: { eventId: string; type: string; ref?: string };
    locked?: boolean;
    createdAt?: number;
    updatedAt?: number;
};

type BrainState = {
    projectId: Id<"projects">;
    version: number;
    updatedAt: number;
    project: {
        overview: Bullet[];
        preferences: Bullet[];
        constraints: Bullet[];
        timeline: Bullet[];
        stakeholders: Bullet[];
    };
    elementNotes: Record<string, { notes: Bullet[]; conflicts: any[] }>;
    unmapped: Bullet[];
    conflicts: any[];
    recentUpdates: Array<{ id: string; text: string; createdAt: number }>;
};

const sectionLabels = {
    overview: "Project Overview",
    preferences: "Preferences",
    constraints: "Constraints",
    timeline: "Timeline",
    stakeholders: "Stakeholders",
} as const;

function createBullet(text = ""): Bullet {
    const now = Date.now();
    return {
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `bullet_${now}`,
        text,
        tags: [],
        status: "proposed",
        confidence: "medium",
        source: { eventId: "manual_edit", type: "manual_edit" },
        locked: false,
        createdAt: now,
        updatedAt: now,
    };
}

function findBulletById(state: BrainState, bulletId?: string) {
    if (!bulletId) return null;
    const sections = Object.values(state.project ?? {});
    for (const list of sections) {
        if (!Array.isArray(list)) continue;
        const hit = list.find((b) => b?.id === bulletId);
        if (hit) return hit;
    }
    const elementNotes = state.elementNotes ?? {};
    for (const entry of Object.values(elementNotes)) {
        const notes = entry?.notes ?? [];
        const hit = notes.find((b) => b?.id === bulletId);
        if (hit) return hit;
    }
    const unmapped = state.unmapped ?? [];
    const hit = unmapped.find((b) => b?.id === bulletId);
    if (hit) return hit;
    return null;
}

export function BrainEditor({ projectId }: { projectId: Id<"projects"> }) {
    const brain = useQuery(api.projectBrain.getCurrent, { projectId });
    const elements = useQuery(api.items.listSidebarTree, { projectId, includeDrafts: true });
    const saveManualEdit = useMutation(api.projectBrain.saveManualEdit);
    const initEmpty = useMutation(api.projectBrain.initEmpty);

    const [draft, setDraft] = useState<BrainState | null>(null);
    const [dirty, setDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!brain || dirty) return;
        setDraft(brain as BrainState);
    }, [brain, dirty]);

    const elementOptions = useMemo(() => {
        const items = elements?.items ?? [];
        return items.map((item: any) => ({
            id: item._id,
            name: item.title || item.name || "Untitled element",
        }));
    }, [elements]);
    const projectSectionOptions = useMemo(
        () => (Object.keys(sectionLabels) as Array<keyof typeof sectionLabels>),
        []
    );

    const updateDraft = (next: BrainState) => {
        setDraft(next);
        setDirty(true);
    };

    const updateBullet = (path: string[], index: number, nextBullet: Bullet) => {
        if (!draft) return;
        const cloned = structuredClone(draft);
        let cursor: any = cloned;
        for (const key of path) {
            cursor[key] = cursor[key] ?? {};
            cursor = cursor[key];
        }
        if (!Array.isArray(cursor)) return;
        cursor[index] = { ...nextBullet, updatedAt: Date.now() };
        updateDraft(cloned);
    };

    const addBullet = (path: string[]) => {
        if (!draft) return;
        const cloned = structuredClone(draft);
        let cursor: any = cloned;
        for (const key of path) {
            cursor[key] = cursor[key] ?? {};
            cursor = cursor[key];
        }
        if (!Array.isArray(cursor)) return;
        cursor.push(createBullet());
        updateDraft(cloned);
    };

    const moveBullet = (fromPath: string[], index: number, toPath: string[]) => {
        if (!draft) return;
        const cloned = structuredClone(draft);
        let fromCursor: any = cloned;
        for (const key of fromPath) {
            fromCursor = fromCursor[key];
        }
        if (!Array.isArray(fromCursor)) return;
        const [removed] = fromCursor.splice(index, 1);
        if (!removed) return;
        let toCursor: any = cloned;
        for (const key of toPath) {
            toCursor[key] = toCursor[key] ?? {};
            toCursor = toCursor[key];
        }
        if (!Array.isArray(toCursor)) return;
        toCursor.push({ ...removed, updatedAt: Date.now() });
        updateDraft(cloned);
    };

    const moveBulletWithin = (path: string[], index: number, direction: -1 | 1) => {
        if (!draft) return;
        const cloned = structuredClone(draft);
        let cursor: any = cloned;
        for (const key of path) {
            cursor = cursor[key];
        }
        if (!Array.isArray(cursor)) return;
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= cursor.length) return;
        const now = Date.now();
        const temp = cursor[nextIndex];
        cursor[nextIndex] = { ...cursor[index], updatedAt: now };
        cursor[index] = { ...temp, updatedAt: now };
        updateDraft(cloned);
    };

    const resolveConflict = (conflictId: string, tombstoneBulletId: string) => {
        if (!draft) return;
        const cloned = structuredClone(draft);
        const now = Date.now();
        const updateList = (list?: Bullet[]) => {
            if (!Array.isArray(list)) return false;
            const idx = list.findIndex((b) => b?.id === tombstoneBulletId);
            if (idx === -1) return false;
            const bullet = list[idx];
            list[idx] = { ...bullet, status: "tombstoned", updatedAt: now };
            return true;
        };

        let updated = false;
        const projectSections = Object.values(cloned.project ?? {});
        for (const list of projectSections) {
            updated = updateList(list as Bullet[]) || updated;
        }
        updated = updateList(cloned.unmapped) || updated;
        const elementNotes = cloned.elementNotes ?? {};
        for (const entry of Object.values(elementNotes)) {
            updated = updateList(entry?.notes) || updated;
        }

        const conflicts = Array.isArray(cloned.conflicts) ? cloned.conflicts : [];
        const conflictIndex = conflicts.findIndex((conflict: any) => conflict?.id === conflictId);
        if (conflictIndex >= 0) {
            const conflict = conflicts[conflictIndex];
            conflicts[conflictIndex] = {
                ...conflict,
                resolved: {
                    byUserId: "user",
                    tombstonedBulletId,
                    at: now,
                },
            };
            updated = true;
        }

        if (!updated) return;
        cloned.conflicts = conflicts;
        updateDraft(cloned);
    };

    const handleSave = async () => {
        if (!draft) return;
        setIsSaving(true);
        setError(null);
        try {
            await saveManualEdit({
                projectId,
                brain: draft,
                expectedVersion: draft.version,
            });
            setDirty(false);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to save Brain";
            setError(message);
        } finally {
            setIsSaving(false);
        }
    };

    if (!draft) {
        if (brain === null) {
            return (
                <div className="space-y-4">
                    <div className="text-sm text-gray-500">No Brain exists for this project yet.</div>
                    <button
                        onClick={() => initEmpty({ projectId })}
                        className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold"
                    >
                        Initialize Brain
                    </button>
                </div>
            );
        }
        return <div className="text-sm text-gray-500">Loading Brain...</div>;
    }

    return (
        <div className="max-w-6xl mx-auto space-y-10 pb-24">
            <section className="space-y-4">
                <div className="flex items-end justify-between px-1">
                    <div>
                        <h2 className="text-2xl font-black text-gray-900 tracking-tight">Project Brain</h2>
                        <p className="text-sm text-gray-500">Structured, curated project memory.</p>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !dirty}
                        className="bg-blue-600 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg shadow-blue-200 disabled:opacity-30 hover:bg-blue-700 transition-all active:scale-95"
                    >
                        {isSaving ? "Saving..." : "Save Brain"}
                    </button>
                </div>
                {error && <div className="text-sm text-red-600 px-1">{error}</div>}
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(Object.keys(sectionLabels) as Array<keyof typeof sectionLabels>).map((sectionKey) => (
                    <div key={sectionKey} className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black uppercase tracking-widest text-gray-500">{sectionLabels[sectionKey]}</h3>
                            <button
                                onClick={() => addBullet(["project", sectionKey])}
                                className="text-xs font-semibold text-blue-600 underline"
                            >
                                Add bullet
                            </button>
                        </div>
                        <BulletList
                            bullets={draft.project[sectionKey]}
                            onChange={(index, nextBullet) => updateBullet(["project", sectionKey], index, nextBullet)}
                            onMoveToUnmapped={(index) => moveBullet(["project", sectionKey], index, ["unmapped"])}
                            onMoveToElement={(index, elementId) =>
                                moveBullet(["project", sectionKey], index, ["elementNotes", elementId, "notes"])
                            }
                            onMoveWithin={(index, direction) => moveBulletWithin(["project", sectionKey], index, direction)}
                            elementOptions={elementOptions}
                        />
                    </div>
                ))}
            </section>

            <section className="space-y-6">
                <div className="px-1">
                    <h2 className="text-2xl font-black text-gray-900 tracking-tight">Approved Elements (Read-only)</h2>
                    <p className="text-sm text-gray-500">Derived from approved snapshots.</p>
                </div>
                <ApprovedElementsView projectId={projectId} />
            </section>

            <section className="space-y-4">
                <div className="flex items-center justify-between px-1">
                    <div>
                        <h2 className="text-xl font-black text-gray-900 tracking-tight">Element Notes</h2>
                        <p className="text-sm text-gray-500">Proposed notes linked to elements.</p>
                    </div>
                </div>
                <div className="space-y-6">
                    {elementOptions.length === 0 && (
                        <div className="text-sm text-gray-400 italic">No elements yet.</div>
                    )}
                    {elementOptions.map((element) => (
                        <div key={element.id} className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-bold text-gray-800">{element.name}</div>
                                <button
                                    onClick={() => addBullet(["elementNotes", element.id, "notes"])}
                                    className="text-xs font-semibold text-blue-600 underline"
                                >
                                    Add note
                                </button>
                            </div>
                            <BulletList
                                bullets={draft.elementNotes?.[element.id]?.notes ?? []}
                                onChange={(index, nextBullet) =>
                                    updateBullet(["elementNotes", element.id, "notes"], index, nextBullet)
                                }
                                onMoveToUnmapped={(index) =>
                                    moveBullet(["elementNotes", element.id, "notes"], index, ["unmapped"])
                                }
                                onMoveToProjectSection={(index, section) =>
                                    moveBullet(["elementNotes", element.id, "notes"], index, ["project", section])
                                }
                                onMoveWithin={(index, direction) =>
                                    moveBulletWithin(["elementNotes", element.id, "notes"], index, direction)
                                }
                                projectSectionOptions={projectSectionOptions}
                            />
                        </div>
                    ))}
                </div>
            </section>

            <section className="space-y-4">
                <div className="flex items-center justify-between px-1">
                    <div>
                        <h2 className="text-xl font-black text-gray-900 tracking-tight">Unmapped</h2>
                        <p className="text-sm text-gray-500">Holding area for facts not yet mapped to an element.</p>
                    </div>
                    <button
                        onClick={() => addBullet(["unmapped"])}
                        className="text-xs font-semibold text-blue-600 underline"
                    >
                        Add bullet
                    </button>
                </div>
                <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
                    <BulletList
                        bullets={draft.unmapped ?? []}
                        onChange={(index, nextBullet) => updateBullet(["unmapped"], index, nextBullet)}
                        onMoveToElement={(index, elementId) =>
                            moveBullet(["unmapped"], index, ["elementNotes", elementId, "notes"])
                        }
                        onMoveToProjectSection={(index, section) =>
                            moveBullet(["unmapped"], index, ["project", section])
                        }
                        onMoveWithin={(index, direction) => moveBulletWithin(["unmapped"], index, direction)}
                        elementOptions={elementOptions}
                        projectSectionOptions={projectSectionOptions}
                    />
                </div>
            </section>

            <section className="space-y-4">
                <div className="px-1">
                    <h2 className="text-xl font-black text-gray-900 tracking-tight">Conflicts</h2>
                    <p className="text-sm text-gray-500">Conflicts are never auto-resolved.</p>
                </div>
                <div className="bg-white rounded-xl border shadow-sm p-5 space-y-2 text-sm text-gray-700">
                    {(draft.conflicts ?? []).length === 0 && (
                        <div className="text-gray-400 italic">No conflicts recorded.</div>
                    )}
                    {(draft.conflicts ?? []).map((conflict: any) => (
                        <div key={conflict.id ?? JSON.stringify(conflict)} className="border rounded p-3">
                            <div className="font-semibold text-gray-800">{conflict.reason ?? "Conflict"}</div>
                            <div className="text-xs text-gray-500">Scope: {conflict.scope ?? "unknown"}</div>
                            <div className="mt-3 space-y-2 text-sm">
                                {conflict.bulletAId && (
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="text-gray-700">
                                            A: {findBulletById(draft, conflict.bulletAId)?.text ?? conflict.bulletAId}
                                        </div>
                                        <button
                                            onClick={() => resolveConflict(conflict.id, conflict.bulletAId)}
                                            className="text-xs text-red-600 underline"
                                            type="button"
                                        >
                                            Tombstone A
                                        </button>
                                    </div>
                                )}
                                {conflict.bulletBId && (
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="text-gray-700">
                                            B: {findBulletById(draft, conflict.bulletBId)?.text ?? conflict.bulletBId}
                                        </div>
                                        <button
                                            onClick={() => resolveConflict(conflict.id, conflict.bulletBId)}
                                            className="text-xs text-red-600 underline"
                                            type="button"
                                        >
                                            Tombstone B
                                        </button>
                                    </div>
                                )}
                                {conflict.resolved && (
                                    <div className="text-xs text-green-700">
                                        Resolved (tombstoned: {conflict.resolved.tombstonedBulletId})
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="space-y-4">
                <div className="px-1">
                    <h2 className="text-xl font-black text-gray-900 tracking-tight">Recent Updates</h2>
                    <p className="text-sm text-gray-500">Append-only change log.</p>
                </div>
                <div className="bg-white rounded-xl border shadow-sm p-5 space-y-2 text-sm text-gray-700">
                    {(draft.recentUpdates ?? []).length === 0 && (
                        <div className="text-gray-400 italic">No updates yet.</div>
                    )}
                    {(draft.recentUpdates ?? []).map((update) => (
                        <div key={update.id} className="border rounded p-3">
                            <div className="text-xs text-gray-500">{new Date(update.createdAt).toLocaleString()}</div>
                            <div>{update.text}</div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

function BulletList(props: {
    bullets: Bullet[];
    onChange: (index: number, bullet: Bullet) => void;
    onMoveToUnmapped?: (index: number) => void;
    onMoveToElement?: (index: number, elementId: string) => void;
    onMoveToProjectSection?: (index: number, section: keyof typeof sectionLabels) => void;
    onMoveWithin?: (index: number, direction: -1 | 1) => void;
    elementOptions?: Array<{ id: string; name: string }>;
    projectSectionOptions?: Array<keyof typeof sectionLabels>;
}) {
    const { bullets, onChange, onMoveToUnmapped, onMoveToElement, onMoveToProjectSection, onMoveWithin, elementOptions, projectSectionOptions } = props;

    if (!bullets || bullets.length === 0) {
        return <div className="text-xs text-gray-400 italic">No bullets yet.</div>;
    }

    return (
        <div className="space-y-3">
            {bullets.map((bullet, index) => (
                <div key={bullet.id ?? `${bullet.text}-${index}`} className="border rounded-lg p-3 space-y-2">
                    <div className="flex flex-col gap-2">
                        <input
                            value={bullet.text}
                            onChange={(e) => onChange(index, { ...bullet, text: e.target.value })}
                            className="w-full border rounded px-3 py-2 text-sm"
                            placeholder="Bullet text"
                        />
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <select
                                value={bullet.status}
                                onChange={(e) => onChange(index, { ...bullet, status: e.target.value as Bullet["status"] })}
                                className="border rounded px-2 py-1 text-xs"
                            >
                                <option value="accepted">accepted</option>
                                <option value="proposed">proposed</option>
                                <option value="tombstoned">tombstoned</option>
                            </select>
                            <select
                                value={bullet.confidence}
                                onChange={(e) => onChange(index, { ...bullet, confidence: e.target.value as Bullet["confidence"] })}
                                className="border rounded px-2 py-1 text-xs"
                            >
                                <option value="high">high</option>
                                <option value="medium">medium</option>
                                <option value="low">low</option>
                            </select>
                            <input
                                value={(bullet.tags ?? []).join(", ")}
                                onChange={(e) =>
                                    onChange(index, {
                                        ...bullet,
                                        tags: e.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                                    })
                                }
                                className="border rounded px-2 py-1 text-xs"
                                placeholder="tags"
                            />
                            <label className="flex items-center gap-2 text-xs text-gray-600">
                                <input
                                    type="checkbox"
                                    checked={Boolean(bullet.locked)}
                                    onChange={(e) => onChange(index, { ...bullet, locked: e.target.checked })}
                                />
                                Locked
                            </label>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                            {onMoveWithin && (
                                <>
                                    <button
                                        onClick={() => onMoveWithin(index, -1)}
                                        className="text-blue-600 underline"
                                        type="button"
                                        disabled={index === 0}
                                    >
                                        Move up
                                    </button>
                                    <button
                                        onClick={() => onMoveWithin(index, 1)}
                                        className="text-blue-600 underline"
                                        type="button"
                                        disabled={index === bullets.length - 1}
                                    >
                                        Move down
                                    </button>
                                </>
                            )}
                            {onMoveToUnmapped && (
                                <button
                                    onClick={() => onMoveToUnmapped(index)}
                                    className="text-blue-600 underline"
                                    type="button"
                                >
                                    Move to Unmapped
                                </button>
                            )}
                            {onMoveToElement && elementOptions && elementOptions.length > 0 && (
                                <label className="flex items-center gap-2">
                                    <span>Move to Element</span>
                                    <select
                                        onChange={(e) => {
                                            if (e.target.value) onMoveToElement(index, e.target.value);
                                            e.currentTarget.value = "";
                                        }}
                                        className="border rounded px-2 py-1 text-xs"
                                        defaultValue=""
                                    >
                                        <option value="">Select element</option>
                                        {elementOptions.map((element) => (
                                            <option key={element.id} value={element.id}>
                                                {element.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            {onMoveToProjectSection && projectSectionOptions && projectSectionOptions.length > 0 && (
                                <label className="flex items-center gap-2">
                                    <span>Move to Project</span>
                                    <select
                                        onChange={(e) => {
                                            if (e.target.value) {
                                                onMoveToProjectSection(index, e.target.value as keyof typeof sectionLabels);
                                            }
                                            e.currentTarget.value = "";
                                        }}
                                        className="border rounded px-2 py-1 text-xs"
                                        defaultValue=""
                                    >
                                        <option value="">Select section</option>
                                        {projectSectionOptions.map((section) => (
                                            <option key={section} value={section}>
                                                {sectionLabels[section]}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
