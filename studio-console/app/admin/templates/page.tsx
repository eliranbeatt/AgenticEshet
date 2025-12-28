"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

type TemplateDef = any; // Simplifying for UI code, type is inferred from schema normally

export default function TemplatesPage() {
    const templates = useQuery(api.admin.listTemplates);
    const saveTemplate = useMutation(api.admin.saveTemplate);
    const deleteTemplate = useMutation(api.admin.deleteTemplate);

    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState<TemplateDef | null>(null);

    const handleCreate = () => {
        setEditData({
            templateId: "",
            version: 1,
            name: "",
            appliesToKind: "deliverable",
            status: "draft",
            fields: [],
            tasks: [],
            materials: [],
            companionRules: [],
            quotePattern: "",
        });
        setIsEditing(true);
    };

    const handleEdit = (tpl: TemplateDef) => {
        setEditData({ ...tpl });
        setIsEditing(true);
    };

    const handleSave = async (data: any) => {
        try {
            await saveTemplate(data);
            setIsEditing(false);
            setEditData(null);
        } catch (e) {
            console.error(e);
            alert("Failed to save template: " + String(e));
        }
    };

    const handleDelete = async (id: Id<"templateDefinitions">) => {
        if (!confirm("Delete this template?")) return;
        await deleteTemplate({ id });
    };

    if (isEditing && editData) {
        return <TemplateEditor initialData={editData} onSave={handleSave} onCancel={() => setIsEditing(false)} />;
    }

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Templates Library</h1>
                    <p className="text-gray-600">Define standard work packages and rules.</p>
                </div>
                <button
                    onClick={handleCreate}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                >
                    + Create Template
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {templates?.map((t) => (
                    <div key={t._id} className="bg-white border rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                            <h3 className="text-lg font-bold text-gray-900">{t.name}</h3>
                            <span className={`px-2 py-0.5 text-xs rounded uppercase font-bold tracking-wide ${
                                t.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                                {t.status} v{t.version}
                            </span>
                        </div>
                        <div className="text-sm text-gray-500 mb-4 font-mono">{t.templateId}</div>
                        
                        <div className="space-y-1 text-sm text-gray-600 mb-4">
                            <div>Type: <span className="font-medium">{t.appliesToKind}</span></div>
                            <div>Tasks: {t.tasks?.length ?? 0}</div>
                            <div>Materials: {t.materials?.length ?? 0}</div>
                        </div>

                        <div className="flex gap-2 mt-4 pt-4 border-t">
                            <button
                                onClick={() => handleEdit(t)}
                                className="flex-1 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 text-sm"
                            >
                                Edit
                            </button>
                            <button
                                onClick={() => handleDelete(t._id)}
                                className="px-3 py-1.5 text-red-600 hover:bg-red-50 rounded text-sm"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function TemplateEditor({ initialData, onSave, onCancel }: { initialData: any, onSave: (data: any) => void, onCancel: () => void }) {
    const [data, setData] = useState(initialData);

    const updateField = (key: string, val: any) => setData({ ...data, [key]: val });

    // Helper for array fields
    const addToArray = (key: string, item: any) => setData({ ...data, [key]: [...(data[key] || []), item] });
    const removeFromArray = (key: string, idx: number) => {
        const arr = [...(data[key] || [])];
        arr.splice(idx, 1);
        setData({ ...data, [key]: arr });
    };
    const updateInArray = (key: string, idx: number, field: string, val: any) => {
        const arr = [...(data[key] || [])];
        arr[idx] = { ...arr[idx], [field]: val };
        setData({ ...data, [key]: arr });
    };

    return (
        <div className="p-6 max-w-5xl mx-auto bg-white min-h-screen">
            <div className="flex justify-between items-center mb-6 border-b pb-4">
                <h2 className="text-xl font-bold">Editor: {data.name || "New Template"}</h2>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                    <button onClick={() => onSave(data)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save Template</button>
                </div>
            </div>

            <div className="space-y-8">
                {/* Basic Info */}
                <section className="grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium mb-1">Template Name (Hebrew)</label>
                        <input className="w-full border rounded px-3 py-2" value={data.name} onChange={e => updateField("name", e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">ID (Stable, English)</label>
                        <input className="w-full border rounded px-3 py-2 font-mono" value={data.templateId} onChange={e => updateField("templateId", e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Kind</label>
                        <select className="w-full border rounded px-3 py-2" value={data.appliesToKind} onChange={e => updateField("appliesToKind", e.target.value)}>
                            <option value="deliverable">Deliverable</option>
                            <option value="day">Day</option>
                            <option value="service">Service</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Status</label>
                        <select className="w-full border rounded px-3 py-2" value={data.status} onChange={e => updateField("status", e.target.value)}>
                            <option value="draft">Draft</option>
                            <option value="published">Published</option>
                        </select>
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium mb-1">Quote Pattern</label>
                        <input className="w-full border rounded px-3 py-2" placeholder="e.g. הפקת הדפסות..." value={data.quotePattern || ""} onChange={e => updateField("quotePattern", e.target.value)} />
                    </div>
                </section>

                {/* Tasks */}
                <section>
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-lg font-semibold">Tasks</h3>
                        <button 
                            onClick={() => addToArray("tasks", { title: "New Task", category: "Studio", role: "איש ארט", effortDays: 0.5 })}
                            className="text-sm text-blue-600 hover:underline"
                        >
                            + Add Task
                        </button>
                    </div>
                    <div className="space-y-3">
                        {data.tasks?.map((t: any, i: number) => (
                            <div key={i} className="flex gap-3 items-start border p-3 rounded bg-gray-50">
                                <div className="flex-1 grid grid-cols-4 gap-3">
                                    <input className="border rounded px-2 py-1" placeholder="Title" value={t.title} onChange={e => updateInArray("tasks", i, "title", e.target.value)} />
                                    <input className="border rounded px-2 py-1" placeholder="Category" value={t.category} onChange={e => updateInArray("tasks", i, "category", e.target.value)} />
                                    <input className="border rounded px-2 py-1" placeholder="Role" value={t.role} onChange={e => updateInArray("tasks", i, "role", e.target.value)} />
                                    <div className="flex gap-2 items-center">
                                        <input type="number" step="0.1" className="w-20 border rounded px-2 py-1" placeholder="Days" value={t.effortDays} onChange={e => updateInArray("tasks", i, "effortDays", Number(e.target.value))} />
                                        <span className="text-sm text-gray-500">days</span>
                                    </div>
                                </div>
                                <button onClick={() => removeFromArray("tasks", i)} className="text-red-500 hover:text-red-700">×</button>
                            </div>
                        ))}
                        {data.tasks?.length === 0 && <div className="text-gray-500 italic text-sm">No tasks defined.</div>}
                    </div>
                </section>

                {/* Materials */}
                <section>
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-lg font-semibold">Materials</h3>
                        <button 
                            onClick={() => addToArray("materials", { name: "New Material", qty: 1, unit: "units" })}
                            className="text-sm text-blue-600 hover:underline"
                        >
                            + Add Material
                        </button>
                    </div>
                    <div className="space-y-3">
                        {data.materials?.map((m: any, i: number) => (
                            <div key={i} className="flex gap-3 items-start border p-3 rounded bg-gray-50">
                                <div className="flex-1 grid grid-cols-4 gap-3">
                                    <input className="border rounded px-2 py-1 col-span-2" placeholder="Name/Label" value={m.name} onChange={e => updateInArray("materials", i, "name", e.target.value)} />
                                    <input type="number" className="border rounded px-2 py-1" placeholder="Qty" value={m.qty} onChange={e => updateInArray("materials", i, "qty", Number(e.target.value))} />
                                    <input className="border rounded px-2 py-1" placeholder="Unit" value={m.unit} onChange={e => updateInArray("materials", i, "unit", e.target.value)} />
                                </div>
                                <button onClick={() => removeFromArray("materials", i)} className="text-red-500 hover:text-red-700">×</button>
                            </div>
                        ))}
                        {data.materials?.length === 0 && <div className="text-gray-500 italic text-sm">No materials defined.</div>}
                    </div>
                </section>

                {/* Companion Rules */}
                <section>
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-lg font-semibold">Rules</h3>
                        <button 
                            onClick={() => addToArray("companionRules", { type: "suggestItem", templateId: "", when: "always" })}
                            className="text-sm text-blue-600 hover:underline"
                        >
                            + Add Rule
                        </button>
                    </div>
                    <div className="space-y-3">
                        {data.companionRules?.map((r: any, i: number) => (
                            <div key={i} className="flex gap-3 items-start border p-3 rounded bg-gray-50">
                                <div className="flex-1 grid grid-cols-3 gap-3">
                                    <select className="border rounded px-2 py-1" value={r.type} onChange={e => updateInArray("companionRules", i, "type", e.target.value)}>
                                        <option value="suggestItem">Suggest Item</option>
                                        <option value="autoAddItem">Auto Add Item</option>
                                    </select>
                                    <input className="border rounded px-2 py-1" placeholder="Target Template ID" value={r.templateId} onChange={e => updateInArray("companionRules", i, "templateId", e.target.value)} />
                                    <input className="border rounded px-2 py-1" placeholder="When (e.g. 'always')" value={r.when} onChange={e => updateInArray("companionRules", i, "when", e.target.value)} />
                                </div>
                                <button onClick={() => removeFromArray("companionRules", i)} className="text-red-500 hover:text-red-700">×</button>
                            </div>
                        ))}
                        {(!data.companionRules || data.companionRules.length === 0) && <div className="text-gray-500 italic text-sm">No rules defined.</div>}
                    </div>
                </section>
            </div>
        </div>
    );
}
