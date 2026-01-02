import { describe, expect, it } from "vitest";
import { serializeElementSnapshot } from "../../convex/lib/elementSerializer";
import type { ElementSnapshot } from "../../convex/lib/zodSchemas";

describe("serializeElementSnapshot", () => {
    it("serializes a minimal snapshot correctly", () => {
        const minimal: ElementSnapshot = {
            schemaVersion: "element-snapshot/v1",
            descriptions: {
                short: "תיאור קצר לדוגמה",
                long: "",
            },
            freeText: {
                preferences: "",
                risks: "",
                openQuestions: "",
                installation: "",
                building: "",
                constraints: "",
                notes: "Should be ignored",
            },
            materials: [],
            labor: [],
            tasks: [],
            tombstones: {
                taskKeys: [],
                materialKeys: [],
                laborKeys: [],
            },
        };

        const result = serializeElementSnapshot(minimal);
        expect(result).toContain("### תיאור קצר");
        expect(result).toContain("תיאור קצר לדוגמה");
        expect(result).not.toContain("Should be ignored");
        expect(result).not.toContain("### חומרים");
    });

    it("serializes a typical snapshot correctly", () => {
        const typical: ElementSnapshot = {
            schemaVersion: "element-snapshot/v1",
            descriptions: {
                short: "Stage build for photoshot",
                long: "Detailed plan for the stage build including lighting and backdrop.",
            },
            freeText: {
                preferences: "Cold lighting preferred",
                risks: "Weather may affect outdoor setup",
                openQuestions: "Is there power at the location?",
                installation: "On-site setup on Monday morning",
                building: "Studio pre-build required",
                constraints: "Budget limit 5000 ILS",
                notes: "Internal admin notes",
            },
            materials: [
                {
                    materialKey: "mat_12345678",
                    name: "Plywood",
                    spec: "12mm thick",
                    qty: 5,
                    unit: "sheets",
                    needPurchase: true,
                    bucketKey: "main",
                }
            ],
            labor: [
                {
                    laborKey: "lab_12345678",
                    role: "Carpenter",
                    qty: 2,
                    unit: "days",
                    rate: 1500,
                    bucketKey: "main",
                }
            ],
            tasks: [],
            tombstones: {
                taskKeys: [],
                materialKeys: [],
                laborKeys: [],
            },
        };

        const result = serializeElementSnapshot(typical);
        expect(result).toContain("### תיאור קצר");
        expect(result).toContain("Stage build for photoshot");
        expect(result).toContain("### פירוט ומטרה");
        expect(result).toContain("Detailed plan for the stage build");
        expect(result).toContain("### העדפות");
        expect(result).toContain("Cold lighting preferred");
        expect(result).toContain("### חומרים");
        expect(result).toContain("Plywood");
        expect(result).toContain("[נדרש רכש]");
        expect(result).toContain("### כוח אדם וביצוע");
        expect(result).toContain("Carpenter");
        expect(result).toContain("### התקנה ושטח");
        expect(result).toContain("Monday morning");
        expect(result).toContain("### סיכונים");
        expect(result).toContain("Weather");
        expect(result).toContain("### שאלות פתוחות");
        expect(result).toContain("power at the location");
        expect(result).not.toContain("Internal admin notes");
    });

    it("ensures deterministic output by sorting collections", () => {
        const snapshot1: ElementSnapshot = {
            schemaVersion: "element-snapshot/v1",
            descriptions: { short: "Test", long: "" },
            freeText: { preferences: "", risks: "", openQuestions: "", installation: "", building: "", constraints: "", notes: "" },
            materials: [
                { materialKey: "mat_b", name: "B", spec: "spec", qty: 1, unit: "u", needPurchase: false, bucketKey: "k" },
                { materialKey: "mat_a", name: "A", spec: "spec", qty: 1, unit: "u", needPurchase: false, bucketKey: "k" },
            ],
            labor: [],
            tasks: [],
            tombstones: { taskKeys: [], materialKeys: [], laborKeys: [] },
        };

        const snapshot2: ElementSnapshot = {
            ...snapshot1,
            materials: [
                { materialKey: "mat_a", name: "A", spec: "spec", qty: 1, unit: "u", needPurchase: false, bucketKey: "k" },
                { materialKey: "mat_b", name: "B", spec: "spec", qty: 1, unit: "u", needPurchase: false, bucketKey: "k" },
            ],
        };

        expect(serializeElementSnapshot(snapshot1)).toBe(serializeElementSnapshot(snapshot2));
    });
});
