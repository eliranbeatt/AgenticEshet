import type { ElementSnapshot } from "./zodSchemas";

/**
 * Deterministically converts an approved element snapshot into human-readable Markdown text in Hebrew.
 * Original English proper nouns are preserved where appropriate.
 */
export function serializeElementSnapshot(snapshot: ElementSnapshot): string {
    const lines: string[] = [];

    // Header - Short Description
    if (snapshot.descriptions.short) {
        lines.push(`### תיאור קצר`);
        lines.push(snapshot.descriptions.short);
        lines.push("");
    }

    // Long Description / Purpose
    if (snapshot.descriptions.long) {
        lines.push(`### פירוט ומטרה`);
        lines.push(snapshot.descriptions.long);
        lines.push("");
    }

    // Requirements / Constraints
    if (snapshot.freeText.constraints) {
        lines.push(`### דרישות ומגבלות`);
        lines.push(snapshot.freeText.constraints);
        lines.push("");
    }

    // Preferences
    if (snapshot.freeText.preferences) {
        lines.push(`### העדפות`);
        lines.push(snapshot.freeText.preferences);
        lines.push("");
    }

    // Materials
    if (snapshot.materials && snapshot.materials.length > 0) {
        lines.push(`### חומרים`);
        // Sort by key for determinism
        const sortedMaterials = [...snapshot.materials].sort((a, b) => a.materialKey.localeCompare(b.materialKey));
        for (const mat of sortedMaterials) {
            let line = `- **${mat.name}**: ${mat.spec} (${mat.qty} ${mat.unit})`;
            if (mat.needPurchase) {
                line += ` [נדרש רכש]`
            }
            if (mat.notes) {
                line += ` - ${mat.notes}`
            }
            lines.push(line);
        }
        lines.push("");
    }

    // Labor
    if (snapshot.labor && snapshot.labor.length > 0) {
        lines.push(`### כוח אדם וביצוע`);
        // Sort by key for determinism
        const sortedLabor = [...snapshot.labor].sort((a, b) => a.laborKey.localeCompare(b.laborKey));
        for (const lab of sortedLabor) {
            let line = `- **${lab.role}**: ${lab.qty} ${lab.unit}`;
            if (lab.notes) {
                line += ` - ${lab.notes}`;
            }
            lines.push(line);
        }
        lines.push("");
    }

    // Installation
    if (snapshot.freeText.installation) {
        lines.push(`### התקנה ושטח`);
        lines.push(snapshot.freeText.installation);
        lines.push("");
    }

    // Building / Production
    if (snapshot.freeText.building) {
        lines.push(`### בנייה וייצור`);
        lines.push(snapshot.freeText.building);
        lines.push("");
    }

    // Risks
    if (snapshot.freeText.risks) {
        lines.push(`### סיכונים`);
        lines.push(snapshot.freeText.risks);
        lines.push("");
    }

    // Open Questions
    if (snapshot.freeText.openQuestions) {
        lines.push(`### שאלות פתוחות`);
        lines.push(snapshot.freeText.openQuestions);
        lines.push("");
    }

    return lines.join("\n").trim();
}
