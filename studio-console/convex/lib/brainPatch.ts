type BulletInput = {
    text: string;
    tags?: string[];
    status?: "accepted" | "proposed" | "tombstoned";
    confidence?: "high" | "medium" | "low";
};

type AddBulletOp = {
    op: "add_bullet";
    target: {
        scope: "project" | "element" | "unmapped";
        section?: "overview" | "preferences" | "constraints" | "timeline" | "stakeholders";
        elementId?: string;
    };
    bullet: BulletInput;
};

type AddConflictOp = {
    op: "add_conflict";
    conflict: any;
};

type AddRecentUpdateOp = {
    op: "add_recent_update";
    text: string;
};

type BrainPatchOp = AddBulletOp | AddConflictOp | AddRecentUpdateOp;

function randomId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function applyBrainPatchOps(args: {
    brain: any;
    patchOps: BrainPatchOp[];
    eventId: string;
    eventType: string;
}) {
    const next = JSON.parse(JSON.stringify(args.brain ?? {}));
    const now = Date.now();
    const withTag = (tags: string[], tag: string) => (tags.includes(tag) ? tags : [...tags, tag]);

    const tagBulletById = (bulletId: string, tag: string) => {
        const applyToList = (list?: any[]) => {
            if (!Array.isArray(list)) return false;
            const idx = list.findIndex((b) => b?.id === bulletId);
            if (idx === -1) return false;
            const bullet = list[idx];
            const tags = Array.isArray(bullet.tags) ? bullet.tags : [];
            if (!tags.includes(tag)) {
                list[idx] = { ...bullet, tags: [...tags, tag], updatedAt: now };
            }
            return true;
        };

        const sections = Object.values(next.project ?? {});
        for (const list of sections) {
            if (applyToList(list)) return true;
        }

        if (applyToList(next.unmapped)) return true;

        const elementNotes = next.elementNotes ?? {};
        for (const entry of Object.values(elementNotes)) {
            if (applyToList((entry as any)?.notes)) return true;
        }

        return false;
    };

    for (const op of args.patchOps) {
        if (op.op === "add_bullet") {
            let tags = op.bullet.tags ?? [];
            const section = op.target.scope === "project" ? op.target.section ?? "overview" : undefined;
            if (op.target.scope === "project" && !op.target.section) {
                tags = withTag(tags, "missing_section");
            }
            const bullet = {
                id: randomId("bullet"),
                text: op.bullet.text,
                tags,
                status: op.bullet.status ?? "accepted",
                confidence: op.bullet.confidence ?? "medium",
                source: { eventId: args.eventId, type: args.eventType },
                createdAt: now,
                updatedAt: now,
            };

            if (op.target.scope === "project") {
                next.project = next.project ?? {};
                next.project[section] = next.project[section] ?? [];
                next.project[section].push(bullet);
            } else if (op.target.scope === "element") {
                if (!op.target.elementId) {
                    next.unmapped = next.unmapped ?? [];
                    next.unmapped.push({ ...bullet, tags: withTag(bullet.tags, "missing_element") });
                    continue;
                }
                next.elementNotes = next.elementNotes ?? {};
                next.elementNotes[op.target.elementId] = next.elementNotes[op.target.elementId] ?? {
                    notes: [],
                    conflicts: [],
                };
                next.elementNotes[op.target.elementId].notes.push(bullet);
            } else if (op.target.scope === "unmapped") {
                next.unmapped = next.unmapped ?? [];
                next.unmapped.push(bullet);
            }
        } else if (op.op === "add_conflict") {
            next.conflicts = next.conflicts ?? [];
            const conflictId = op.conflict?.id ?? randomId("conflict");
            const conflict = {
                ...op.conflict,
                id: conflictId,
                createdAt: op.conflict?.createdAt ?? now,
            };
            next.conflicts.push(conflict);
            if (conflict.bulletAId) {
                tagBulletById(conflict.bulletAId, `conflict:${conflictId}`);
            }
            if (conflict.bulletBId) {
                tagBulletById(conflict.bulletBId, `conflict:${conflictId}`);
            }
        } else if (op.op === "add_recent_update") {
            next.recentUpdates = next.recentUpdates ?? [];
            next.recentUpdates.push({
                id: randomId("update"),
                text: op.text,
                createdAt: now,
            });
        }
    }

    next.version = (next.version ?? 0) + 1;
    next.updatedAt = now;
    return next;
}
