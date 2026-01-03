import { mutation } from "./_generated/server";
import {
    accountingPrompt,
    architectPrompt,
    changeSetSchemaText,
    chatRules,
    clarificationPrompt,
    convertToItemPrompt,
    deepResearchPrompt,
    extractGuardrails,
    ideationPrompt,
    itemEditorPrompt,
    itemTypeDefinitions,
    planningPrompt,
    quotePrompt,
    sharedContextContract,
    solutioningPrompt,
    tasksPrompt,
} from "./prompts/itemsPromptPack";
import { seedAgentSkills } from "./skills/seed";

// Public mutation for UI button access
export const seedSkillsPublic = mutation({
    handler: async (ctx) => {
        const sharedPrefix = [sharedContextContract, extractGuardrails, chatRules, itemTypeDefinitions].join("\n\n");
        const changeSetPrefix = [sharedPrefix, changeSetSchemaText].join("\n\n");

        const skills = [
            {
                name: "ideation",
                type: "agent_system",
                content: [sharedPrefix, ideationPrompt].join("\n\n"),
                metadata: { phase: "ideation" },
            },
            {
                name: "convert_to_item",
                type: "agent_system",
                content: [changeSetPrefix, convertToItemPrompt].join("\n\n"),
                metadata: { phase: "convert" },
            },
            {
                name: "clarification",
                type: "agent_system",
                content: [sharedPrefix, clarificationPrompt].join("\n\n"),
                metadata: { phase: "clarification" },
            },
            {
                name: "planning",
                type: "agent_system",
                content: [changeSetPrefix, planningPrompt].join("\n\n"),
                metadata: { phase: "planning" },
            },
            {
                name: "solutioning",
                type: "agent_system",
                content: [changeSetPrefix, solutioningPrompt].join("\n\n"),
                metadata: { phase: "solutioning" },
            },
            {
                name: "accounting",
                type: "agent_system",
                content: [changeSetPrefix, accountingPrompt].join("\n\n"),
                metadata: { phase: "accounting" },
            },
            {
                name: "tasks",
                type: "agent_system",
                content: [changeSetPrefix, tasksPrompt].join("\n\n"),
                metadata: { phase: "tasks" },
            },
            {
                name: "quote",
                type: "agent_system",
                content: [sharedPrefix, quotePrompt].join("\n\n"),
                metadata: { phase: "quote" },
            },
            {
                name: "deep_research",
                type: "agent_system",
                content: [sharedPrefix, deepResearchPrompt].join("\n\n"),
                metadata: { phase: "deep_research" },
            },
            {
                name: "item_editor",
                type: "agent_system",
                content: [changeSetPrefix, itemEditorPrompt].join("\n\n"),
                metadata: { phase: "item_edit" },
            },
            {
                name: "architect",
                type: "agent_system",
                content: [sharedPrefix, architectPrompt].join("\n\n"),
                metadata: { phase: "tasks" },
            },
        ];

        for (const skill of skills) {
            const existing = await ctx.db
                .query("skills")
                .withIndex("by_name", (q) => q.eq("name", skill.name))
                .first();

            if (!existing) {
                await ctx.db.insert("skills", {
                    name: skill.name,
                    type: skill.type,
                    content: skill.content,
                    metadataJson: JSON.stringify(skill.metadata),
                });
            } else {
                await ctx.db.patch(existing._id, {
                    content: skill.content,
                    metadataJson: JSON.stringify(skill.metadata),
                });
            }
        }

        await seedAgentSkills(ctx);
    },
});

export const seedRefactorData = mutation({
    handler: async (ctx) => {
        // 1. Seed Role Catalog
        const roles = [
            { roleName: "איש ארט", defaultRatePerDay: 800, isInternalRole: true, isVendorRole: false },
            { roleName: "מעצב גרפי", defaultRatePerDay: 900, isInternalRole: true, isVendorRole: false },
            { roleName: "סט דראסר", defaultRatePerDay: 850, isInternalRole: true, isVendorRole: false },
            { roleName: "עובד התקנה", defaultRatePerDay: 850, isInternalRole: true, isVendorRole: false },
            { roleName: "בית דפוס", defaultRatePerDay: 0, isInternalRole: false, isVendorRole: true },
            { roleName: "נגריה", defaultRatePerDay: 0, isInternalRole: false, isVendorRole: true },
            { roleName: "חשמלאי", defaultRatePerDay: 0, isInternalRole: false, isVendorRole: true },
        ];

        for (const role of roles) {
            const existing = await ctx.db.query("roleCatalog").withIndex("by_roleName", q => q.eq("roleName", role.roleName)).first();
            if (!existing) {
                await ctx.db.insert("roleCatalog", role);
            } else {
                await ctx.db.patch(existing._id, role);
            }
        }

        // 2. Seed Templates (V1 Library)
        // Helper to construct template object
        const createTemplate = (
            id: string,
            name: string,
            kind: "deliverable" | "day" | "service",
            quotePattern: string,
            tasks: any[],
            materials: any[] = [],
            companionRules: any[] = []
        ) => ({
            templateId: id,
            version: 1,
            name,
            appliesToKind: kind,
            quotePattern,
            fields: [], // Simplified for seed
            tasks,
            materials,
            companionRules,
            status: "published" as const,
            createdAt: Date.now()
        });

        const templates = [
            // Day Items
            createTemplate("transport_day", "הובלה", "day", "שירותי הובלה לאתר ובחזרה", [
                { title: "תיאום הובלה", category: "Admin", role: "איש ארט", effortDays: 0.1 }
            ]),
            createTemplate("install_day", "התקנה", "day", "יום התקנה באתר", [
                { title: "הקמה והתקנה בשטח", category: "Logistics", role: "עובד התקנה", effortDays: 1 }
            ]),
            createTemplate("shoot_day", "יום צילום", "day", "ליווי יום צילום", [
                { title: "נוכחות ביום צילום", category: "Studio", role: "איש ארט", effortDays: 1 }
            ]),
            createTemplate("teardown_day", "פירוק", "day", "פירוק וקיפול ציוד מהאתר", [
                { title: "פירוק והחזרה למחסן", category: "Logistics", role: "עובד התקנה", effortDays: 0.5 }
            ]),
            createTemplate("management_day", "יום ניהול", "day", "ניהול והפקה", [
                { title: "ניהול פרויקט", category: "Admin", role: "איש ארט", effortDays: 1 }
            ]), // Note: Excluded logic is policy-based, not template-based

            // Deliverables
            createTemplate("studio_build", "בניה של אלמנט בסטודיו", "deliverable", "ייצור ובניית אלמנט ייחודי בסטודיו", [
                { title: "תכנון ושרטוט", category: "Creative", role: "איש ארט", effortDays: 0.25 },
                { title: "רכש חומרים", category: "Logistics", role: "איש ארט", effortDays: 0.25 },
                { title: "בנייה בסטודיו", category: "Studio", role: "איש ארט", effortDays: 1 }
            ], [
                { name: "חומרי גלם (עץ/זכוכית/פרזול)", defaultVendorRole: "נגריה" }
            ]),

            createTemplate("dressing", "דרסינג - השכרת פרופס וארט", "deliverable", "השכרה וליקוט אביזרים ופרופס", [
                { title: "חיפוש וליקוט ספקים", category: "Logistics", role: "סט דראסר", effortDays: 0.5 },
                { title: "איסוף והחזרה", category: "Logistics", role: "סט דראסר", effortDays: 0.25 }
            ], [
                { name: "השכרת ציוד/פרופס", defaultVendorRole: "ספקי משנה" }
            ]),

            createTemplate("pvc_floor", "רצפת PVC", "deliverable", "אספקה והתקנת רצפת PVC", [
                { title: "הזמנה וחיתוך", category: "Logistics", role: "איש ארט", effortDays: 0.25 }
            ], [
                { name: "יריעת PVC", unit: "מ״ר" }
            ], [
                { type: "suggestItem", templateId: "install_day", when: "always" }
            ]),

            createTemplate("print_house", "הדפסות בבית דפוס", "deliverable", "הפקת דפוס לפי מפרט", [
                { title: "בדיקת קבצים גרפיים", category: "Creative", role: "מעצב גרפי", effortDays: 0.5 }, // conditional logic handled in UI/Expansion
                { title: "סגירת מפרט מול דפוס", category: "Admin", role: "איש ארט", effortDays: 0.25 },
                { title: "איסוף ובקרת איכות", category: "Logistics", role: "איש ארט", effortDays: 0.5 }
            ], [
                { name: "הדפסה (שירות)", defaultVendorRole: "בית דפוס" }
            ]),

            createTemplate("subcontractor", "ספקי משנה", "service", "תיאום וניהול ספק משנה", [
                { title: "תיאום מול ספק", category: "Admin", role: "איש ארט", effortDays: 0.25 }
            ]),

            createTemplate("event_production", "אירוע", "deliverable", "הפקת אירוע מלא", [
                { title: "הקמה בשטח", category: "Logistics", role: "עובד התקנה", effortDays: 1 }
            ]),

            createTemplate("exhibit", "מיצג", "deliverable", "הקמת מיצג אומנותי", [
                { title: "תכנון המיצג", category: "Creative", role: "איש ארט", effortDays: 1 },
                { title: "הקמה", category: "Studio", role: "איש ארט", effortDays: 1 }
            ])
        ];

        for (const template of templates) {
            const existing = await ctx.db.query("templateDefinitions")
                .withIndex("by_templateId_version", q => q.eq("templateId", template.templateId).eq("version", 1))
                .first();

            if (!existing) {
                await ctx.db.insert("templateDefinitions", template);
            } else {
                await ctx.db.patch(existing._id, template);
            }
        }
    }
});
