import type { ElementSnapshot } from "./zodSchemas";

function linesFromText(label: string, text?: string) {
    const value = (text ?? "").trim();
    if (!value) return [];
    return [`## ${label}`, value, ""];
}

export function buildElementDigest(snapshot: ElementSnapshot) {
    const lines: string[] = [];

    lines.push(...linesFromText("Summary", snapshot.descriptions.short));
    lines.push(...linesFromText("Description", snapshot.descriptions.long));
    lines.push(...linesFromText("Constraints", snapshot.freeText.constraints));
    lines.push(...linesFromText("Preferences", snapshot.freeText.preferences));
    lines.push(...linesFromText("Notes", snapshot.freeText.notes));
    lines.push(...linesFromText("Installation", snapshot.freeText.installation));
    lines.push(...linesFromText("Building", snapshot.freeText.building));
    lines.push(...linesFromText("Risks", snapshot.freeText.risks));
    lines.push(...linesFromText("Open Questions", snapshot.freeText.openQuestions));

    if (snapshot.materials && snapshot.materials.length > 0) {
        lines.push("## Materials");
        const sorted = [...snapshot.materials].sort((a, b) => a.materialKey.localeCompare(b.materialKey));
        for (const mat of sorted) {
            const parts = [`${mat.name}: ${mat.spec}`, `(${mat.qty} ${mat.unit})`];
            if (mat.needPurchase) parts.push("[purchase]");
            if (mat.notes) parts.push(`- ${mat.notes}`);
            lines.push(`- ${parts.join(" ")}`.replace(/\s+/g, " ").trim());
        }
        lines.push("");
    }

    if (snapshot.labor && snapshot.labor.length > 0) {
        lines.push("## Labor");
        const sorted = [...snapshot.labor].sort((a, b) => a.laborKey.localeCompare(b.laborKey));
        for (const lab of sorted) {
            const parts = [`${lab.role}: ${lab.qty} ${lab.unit}`];
            if (lab.notes) parts.push(`- ${lab.notes}`);
            lines.push(`- ${parts.join(" ")}`.replace(/\s+/g, " ").trim());
        }
        lines.push("");
    }

    if (snapshot.tasks && snapshot.tasks.length > 0) {
        lines.push("## Tasks");
        const sorted = [...snapshot.tasks].sort((a, b) => a.taskKey.localeCompare(b.taskKey));
        for (const task of sorted) {
            const parts = [task.title];
            if (task.estimate) parts.push(`(${task.estimate})`);
            if (task.details) parts.push(`- ${task.details}`);
            lines.push(`- ${parts.join(" ")}`.replace(/\s+/g, " ").trim());
        }
        lines.push("");
    }

    return lines.join("\n").trim();
}
