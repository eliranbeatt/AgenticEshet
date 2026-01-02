type Bullet = { id?: string; text?: string; status?: string; confidence?: string };

function formatBullets(label: string, bullets: Bullet[]) {
    const lines: string[] = [];
    lines.push(`## ${label}`);
    if (!bullets || bullets.length === 0) {
        lines.push("(none)");
        return lines.join("\n");
    }
    for (const bullet of bullets) {
        const id = bullet.id ?? "unknown";
        const status = bullet.status ?? "accepted";
        const confidence = bullet.confidence ?? "medium";
        const text = bullet.text ?? "";
        lines.push(`- [${id}] (${status}/${confidence}) ${text}`);
    }
    return lines.join("\n");
}

export function buildBrainContext(brain: any) {
    const lines: string[] = [];
    lines.push("# Project Brain");
    lines.push(formatBullets("Overview", brain?.project?.overview ?? []));
    lines.push(formatBullets("Preferences", brain?.project?.preferences ?? []));
    lines.push(formatBullets("Constraints", brain?.project?.constraints ?? []));
    lines.push(formatBullets("Timeline", brain?.project?.timeline ?? []));
    lines.push(formatBullets("Stakeholders", brain?.project?.stakeholders ?? []));

    const elementNotes = brain?.elementNotes ?? {};
    lines.push("## Element Notes");
    const elementIds = Object.keys(elementNotes);
    if (elementIds.length === 0) {
        lines.push("(none)");
    } else {
        for (const elementId of elementIds) {
            const notes = elementNotes[elementId]?.notes ?? [];
            lines.push(`### ${elementId}`);
            lines.push(formatBullets("Notes", notes));
        }
    }

    lines.push(formatBullets("Unmapped", brain?.unmapped ?? []));

    lines.push("## Conflicts");
    const conflicts = brain?.conflicts ?? [];
    if (!conflicts.length) {
        lines.push("(none)");
    } else {
        for (const conflict of conflicts) {
            lines.push(`- ${conflict.id ?? "conflict"}: ${conflict.reason ?? "conflict"}`);
        }
    }

    lines.push("## Recent Updates");
    const updates = brain?.recentUpdates ?? [];
    if (!updates.length) {
        lines.push("(none)");
    } else {
        for (const update of updates.slice(-10)) {
            lines.push(`- ${update.text ?? ""}`);
        }
    }

    return lines.join("\n");
}
