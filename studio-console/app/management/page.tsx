"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id, type Doc } from "../../convex/_generated/dataModel";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";

type VendorFormState = {
    name: string;
    category: string;
    contactInfo: string;
    rating: string;
    description: string;
    tags: string;
};

type EmployeeFormState = {
    name: string;
    description: string;
    role: string;
    status: string;
    contactInfo: string;
    tags: string;
};

type MaterialFormState = {
    name: string;
    category: string;
    defaultUnit: string;
    lastPrice: string;
    vendorId: string;
    description: string;
    tags: string;
};

type PurchaseFormState = {
    itemName: string;
    description: string;
    vendorId: string;
    materialId: string;
    employeeId: string;
    amount: string;
    currency: string;
    status: string;
    tags: string;
    purchasedAt: string;
};

const emptyVendor: VendorFormState = {
    name: "",
    category: "",
    contactInfo: "",
    rating: "",
    description: "",
    tags: "",
};

const emptyEmployee: EmployeeFormState = {
    name: "",
    description: "",
    role: "",
    status: "",
    contactInfo: "",
    tags: "",
};

const emptyMaterial: MaterialFormState = {
    name: "",
    category: "General",
    defaultUnit: "unit",
    lastPrice: "",
    vendorId: "",
    description: "",
    tags: "",
};

const emptyPurchase: PurchaseFormState = {
    itemName: "",
    description: "",
    vendorId: "",
    materialId: "",
    employeeId: "",
    amount: "",
    currency: "ILS",
    status: "recorded",
    tags: "",
    purchasedAt: "",
};

const parseTags = (value: string) => value.split(",").map((tag) => tag.trim()).filter(Boolean);

export default function ManagementPage() {
    const data = useQuery(api.management.listManagementData, {});

    const createVendor = useMutation(api.management.createVendor);
    const updateVendor = useMutation(api.management.updateVendor);
    const deleteVendor = useMutation(api.management.deleteVendor);

    const createEmployee = useMutation(api.management.createEmployee);
    const updateEmployee = useMutation(api.management.updateEmployee);
    const deleteEmployee = useMutation(api.management.deleteEmployee);

    const createMaterial = useMutation(api.management.createMaterial);
    const updateMaterial = useMutation(api.management.updateMaterial);
    const deleteMaterial = useMutation(api.management.deleteMaterial);

    const createPurchase = useMutation(api.management.createPurchase);
    const updatePurchase = useMutation(api.management.updatePurchase);
    const deletePurchase = useMutation(api.management.deletePurchase);

    if (!data) {
        return <div className="p-8">Loading management tables...</div>;
    }

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm uppercase tracking-wide text-gray-500">Operations</p>
                    <h1 className="text-3xl font-bold">Management Hub</h1>
                    <p className="text-gray-600 mt-1 max-w-3xl">
                        Keep vendors, employees, materials, and purchases synchronized with accounting so agents can
                        reuse the same trusted records when they book work or buy materials.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <VendorManager
                    vendors={data.vendors}
                    onCreate={createVendor}
                    onUpdate={async (id, updates) => { await updateVendor({ id, updates: updates as any }); }}
                    onDelete={async (id) => { await deleteVendor({ id }); }}
                />
                <EmployeeManager
                    employees={data.employees}
                    onCreate={createEmployee}
                    onUpdate={async (id, updates) => { await updateEmployee({ id, updates: updates as any }); }}
                    onDelete={async (id) => { await deleteEmployee({ id }); }}
                />
                <MaterialManager
                    materials={data.materials}
                    vendors={data.vendors}
                    onCreate={createMaterial}
                    onUpdate={async (id, updates) => { await updateMaterial({ id, updates: updates as any }); }}
                    onDelete={async (id) => { await deleteMaterial({ id }); }}
                />
                <PurchaseManager
                    purchases={data.purchases}
                    vendors={data.vendors}
                    materials={data.materials}
                    employees={data.employees}
                    onCreate={createPurchase}
                    onUpdate={async (id, updates) => { await updatePurchase({ id, updates: updates as any }); }}
                    onDelete={async (id) => { await deletePurchase({ id }); }}
                />
            </div>
        </div>
    );
}

// Purchases -----------------------------------------------------------------

function PurchaseManager({
    purchases,
    vendors,
    materials,
    employees,
    onCreate,
    onUpdate,
    onDelete,
}: {
    purchases: Doc<"purchases">[];
    vendors: Doc<"vendors">[];
    materials: Doc<"materialCatalog">[];
    employees: Doc<"employees">[];
    onCreate: (input: {
        itemName: string;
        description?: string;
        vendorId?: Id<"vendors">;
        materialId?: Id<"materialCatalog">;
        employeeId?: Id<"employees">;
        amount: number;
        currency?: string;
        status?: string;
        tags?: string[];
        purchasedAt?: number;
    }) => Promise<Id<"purchases"> | void>;
    onUpdate: (id: Id<"purchases">, updates: Partial<Doc<"purchases">>) => Promise<void>;
    onDelete: (id: Id<"purchases">) => Promise<void>;
}) {
    const [form, setForm] = useState<PurchaseFormState>(emptyPurchase);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.itemName.trim()) return;
        const amount = Number(form.amount || "0");
        await onCreate({
            itemName: form.itemName.trim(),
            description: form.description.trim() || undefined,
            vendorId: form.vendorId ? (form.vendorId as Id<"vendors">) : undefined,
            materialId: form.materialId ? (form.materialId as Id<"materialCatalog">) : undefined,
            employeeId: form.employeeId ? (form.employeeId as Id<"employees">) : undefined,
            amount: Number.isNaN(amount) ? 0 : amount,
            currency: form.currency || "ILS",
            status: form.status || "recorded",
            tags: parseTags(form.tags),
            purchasedAt: form.purchasedAt ? new Date(form.purchasedAt).getTime() : undefined,
        });
        setForm(emptyPurchase);
    };

    return (
        <section className="bg-white border rounded-lg shadow-sm p-4 space-y-4">
            <header className="flex items-center justify-between">
                <div>
                    <p className="text-xs uppercase text-gray-500">Purchases</p>
                    <h2 className="text-xl font-semibold">Procurement Log</h2>
                    <p className="text-sm text-gray-500">Track manual purchases alongside accounting entries and mark status.</p>
                </div>
                <div className="text-sm text-gray-500">{purchases.length} records</div>
            </header>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-gray-50 p-3 rounded">
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Item name"
                    value={form.itemName}
                    onChange={(e) => setForm((prev) => ({ ...prev, itemName: e.target.value }))}
                    required
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Amount"
                    type="number"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    required
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Status"
                    value={form.status}
                    onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Currency"
                    value={form.currency}
                    onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
                />
                <select
                    className="border rounded px-3 py-2 text-sm"
                    value={form.vendorId}
                    onChange={(e) => setForm((prev) => ({ ...prev, vendorId: e.target.value }))}
                >
                    <option value="">Vendor</option>
                    {vendors.map((v) => (
                        <option key={v._id} value={v._id}>
                            {v.name}
                        </option>
                    ))}
                </select>
                <select
                    className="border rounded px-3 py-2 text-sm"
                    value={form.materialId}
                    onChange={(e) => setForm((prev) => ({ ...prev, materialId: e.target.value }))}
                >
                    <option value="">Material</option>
                    {materials.map((m) => (
                        <option key={m._id} value={m._id}>
                            {m.name}
                        </option>
                    ))}
                </select>
                <select
                    className="border rounded px-3 py-2 text-sm"
                    value={form.employeeId}
                    onChange={(e) => setForm((prev) => ({ ...prev, employeeId: e.target.value }))}
                >
                    <option value="">Handled by</option>
                    {employees.map((emp) => (
                        <option key={emp._id} value={emp._id}>
                            {emp.name}
                        </option>
                    ))}
                </select>
                <input
                    className="border rounded px-3 py-2 text-sm"
                    type="date"
                    value={form.purchasedAt}
                    onChange={(e) => setForm((prev) => ({ ...prev, purchasedAt: e.target.value }))}
                />
                <input
                    className="border rounded px-3 py-2 text-sm md:col-span-2"
                    placeholder="Description"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
                <div className="flex items-center gap-2">
                    <input
                        className="border rounded px-3 py-2 text-sm w-full"
                        placeholder="Tags (comma separated)"
                        value={form.tags}
                        onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                    />
                    <button
                        type="submit"
                        className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" /> Add
                    </button>
                </div>
            </form>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Item</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Description</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Tags</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Meta</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 w-28">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {purchases.map((purchase) => (
                            <PurchaseRow
                                key={purchase._id}
                                purchase={purchase}
                                vendors={vendors}
                                materials={materials}
                                employees={employees}
                                onUpdate={onUpdate}
                                onDelete={onDelete}
                            />
                        ))}
                        {purchases.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-sm">
                                    No purchases captured yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function PurchaseRow({
    purchase,
    vendors,
    materials,
    employees,
    onUpdate,
    onDelete,
}: {
    purchase: Doc<"purchases">;
    vendors: Doc<"vendors">[];
    materials: Doc<"materialCatalog">[];
    employees: Doc<"employees">[];
    onUpdate: (id: Id<"purchases">, updates: Partial<Doc<"purchases">>) => Promise<void>;
    onDelete: (id: Id<"purchases">) => Promise<void>;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState<PurchaseFormState>({
        itemName: purchase.itemName,
        description: purchase.description ?? "",
        vendorId: purchase.vendorId ?? "",
        materialId: purchase.materialId ?? "",
        employeeId: purchase.employeeId ?? "",
        amount: purchase.amount.toString(),
        currency: purchase.currency ?? "ILS",
        status: purchase.status ?? "recorded",
        tags: (purchase.tags ?? []).join(", "),
        purchasedAt: purchase.purchasedAt ? new Date(purchase.purchasedAt).toISOString().slice(0, 10) : "",
    });

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft({
            itemName: purchase.itemName,
            description: purchase.description ?? "",
            vendorId: purchase.vendorId ?? "",
            materialId: purchase.materialId ?? "",
            employeeId: purchase.employeeId ?? "",
            amount: purchase.amount.toString(),
            currency: purchase.currency ?? "ILS",
            status: purchase.status ?? "recorded",
            tags: (purchase.tags ?? []).join(", "),
            purchasedAt: purchase.purchasedAt ? new Date(purchase.purchasedAt).toISOString().slice(0, 10) : "",
        });
        setIsEditing(false);
    }, [purchase]);

    const handleSave = async () => {
        await onUpdate(purchase._id, {
            itemName: draft.itemName.trim() || purchase.itemName,
            description: draft.description.trim() || undefined,
            vendorId: draft.vendorId ? (draft.vendorId as Id<"vendors">) : undefined,
            materialId: draft.materialId ? (draft.materialId as Id<"materialCatalog">) : undefined,
            employeeId: draft.employeeId ? (draft.employeeId as Id<"employees">) : undefined,
            amount: Number(draft.amount || purchase.amount),
            currency: draft.currency || purchase.currency,
            status: draft.status || purchase.status,
            tags: parseTags(draft.tags),
            purchasedAt: draft.purchasedAt ? new Date(draft.purchasedAt).getTime() : purchase.purchasedAt,
        });
        setIsEditing(false);
    };

    const handleDelete = async () => {
        if (!confirm(`Delete purchase "${purchase.itemName}"?`)) return;
        await onDelete(purchase._id);
    };

    const vendorName = useMemo(
        () => vendors.find((v) => v._id === purchase.vendorId)?.name,
        [vendors, purchase.vendorId],
    );
    const materialName = useMemo(
        () => materials.find((m) => m._id === purchase.materialId)?.name,
        [materials, purchase.materialId],
    );
    const employeeName = useMemo(
        () => employees.find((e) => e._id === purchase.employeeId)?.name,
        [employees, purchase.employeeId],
    );

    return (
        <tr className="hover:bg-gray-50">
            <td className="px-3 py-2">
                {isEditing ? (
                    <div className="flex flex-col gap-1">
                        <input
                            className="border rounded px-2 py-1 w-full text-sm"
                            value={draft.itemName}
                            onChange={(e) => setDraft((prev) => ({ ...prev, itemName: e.target.value }))}
                        />
                        <input
                            className="border rounded px-2 py-1 w-full text-sm"
                            type="number"
                            step="0.01"
                            value={draft.amount}
                            onChange={(e) => setDraft((prev) => ({ ...prev, amount: e.target.value }))}
                        />
                    </div>
                ) : (
                    <>
                        <div className="font-medium text-gray-900">{purchase.itemName}</div>
                        <div className="text-xs text-gray-500">
                            {purchase.amount} {purchase.currency ?? "ILS"} · {purchase.status ?? "recorded"}
                        </div>
                    </>
                )}
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.description}
                        onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                        placeholder="Description"
                    />
                ) : (
                    <div className="text-sm text-gray-700">
                        {purchase.description || <span className="text-gray-400">-</span>}
                    </div>
                )}
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.tags}
                        onChange={(e) => setDraft((prev) => ({ ...prev, tags: e.target.value }))}
                        placeholder="Tags"
                    />
                ) : (
                    <TagList tags={purchase.tags} />
                )}
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <div className="grid grid-cols-2 gap-2">
                        <select
                            className="border rounded px-2 py-1 text-sm col-span-2"
                            value={draft.vendorId}
                            onChange={(e) => setDraft((prev) => ({ ...prev, vendorId: e.target.value }))}
                        >
                            <option value="">Vendor</option>
                            {vendors.map((v) => (
                                <option key={v._id} value={v._id}>
                                    {v.name}
                                </option>
                            ))}
                        </select>
                        <select
                            className="border rounded px-2 py-1 text-sm col-span-2"
                            value={draft.materialId}
                            onChange={(e) => setDraft((prev) => ({ ...prev, materialId: e.target.value }))}
                        >
                            <option value="">Material</option>
                            {materials.map((m) => (
                                <option key={m._id} value={m._id}>
                                    {m.name}
                                </option>
                            ))}
                        </select>
                        <select
                            className="border rounded px-2 py-1 text-sm col-span-2"
                            value={draft.employeeId}
                            onChange={(e) => setDraft((prev) => ({ ...prev, employeeId: e.target.value }))}
                        >
                            <option value="">Handled by</option>
                            {employees.map((emp) => (
                                <option key={emp._id} value={emp._id}>
                                    {emp.name}
                                </option>
                            ))}
                        </select>
                        <input
                            className="border rounded px-2 py-1 text-sm"
                            value={draft.currency}
                            onChange={(e) => setDraft((prev) => ({ ...prev, currency: e.target.value }))}
                            placeholder="Currency"
                        />
                        <input
                            className="border rounded px-2 py-1 text-sm"
                            value={draft.status}
                            onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}
                            placeholder="Status"
                        />
                        <input
                            className="border rounded px-2 py-1 text-sm col-span-2"
                            type="date"
                            value={draft.purchasedAt}
                            onChange={(e) => setDraft((prev) => ({ ...prev, purchasedAt: e.target.value }))}
                        />
                    </div>
                ) : (
                    <div className="text-xs text-gray-700 space-y-1">
                        <div>
                            {vendorName || "Vendor: -"} · {materialName || "Material: -"}
                        </div>
                        <div>{employeeName ? `Handled by ${employeeName}` : "Handled by -"} </div>
                        <div className="text-gray-500">
                            {purchase.purchasedAt ? new Date(purchase.purchasedAt).toLocaleDateString() : "No date"}
                        </div>
                    </div>
                )}
            </td>
            <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <button
                                className="text-green-600 hover:text-green-700"
                                title="Save"
                                onClick={handleSave}
                            >
                                <Save className="w-4 h-4" />
                            </button>
                            <button
                                className="text-gray-500 hover:text-gray-700"
                                title="Cancel"
                                onClick={() => setIsEditing(false)}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </>
                    ) : (
                        <button
                            className="text-blue-600 hover:text-blue-700"
                            title="Edit"
                            onClick={() => setIsEditing(true)}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        className="text-red-500 hover:text-red-600"
                        title="Delete"
                        onClick={handleDelete}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </td>
        </tr>
    );
}
// Materials -----------------------------------------------------------------

function MaterialManager({
    materials,
    vendors,
    onCreate,
    onUpdate,
    onDelete,
}: {
    materials: Doc<"materialCatalog">[];
    vendors: Doc<"vendors">[];
    onCreate: (input: {
        name: string;
        category: string;
        defaultUnit: string;
        lastPrice: number;
        vendorId?: Id<"vendors">;
        description?: string;
        tags?: string[];
    }) => Promise<Id<"materialCatalog"> | void>;
    onUpdate: (id: Id<"materialCatalog">, updates: Partial<Doc<"materialCatalog">>) => Promise<void>;
    onDelete: (id: Id<"materialCatalog">) => Promise<void>;
}) {
    const [form, setForm] = useState<MaterialFormState>(emptyMaterial);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        const price = Number(form.lastPrice || "0");
        await onCreate({
            name: form.name.trim(),
            category: form.category.trim() || "General",
            defaultUnit: form.defaultUnit.trim() || "unit",
            lastPrice: Number.isNaN(price) ? 0 : price,
            vendorId: form.vendorId ? (form.vendorId as Id<"vendors">) : undefined,
            description: form.description.trim() || undefined,
            tags: parseTags(form.tags),
        });
        setForm(emptyMaterial);
    };

    return (
        <section className="bg-white border rounded-lg shadow-sm p-4 space-y-4">
            <header className="flex items-center justify-between">
                <div>
                    <p className="text-xs uppercase text-gray-500">Catalog</p>
                    <h2 className="text-xl font-semibold">Materials Library</h2>
                    <p className="text-sm text-gray-500">Keep standard units, prices, and vendor references ready for estimates.</p>
                </div>
                <div className="text-sm text-gray-500">{materials.length} items</div>
            </header>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-gray-50 p-3 rounded">
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Material name"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Category"
                    value={form.category}
                    onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Default unit"
                    value={form.defaultUnit}
                    onChange={(e) => setForm((prev) => ({ ...prev, defaultUnit: e.target.value }))}
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Last price"
                    type="number"
                    step="0.01"
                    value={form.lastPrice}
                    onChange={(e) => setForm((prev) => ({ ...prev, lastPrice: e.target.value }))}
                />
                <select
                    className="border rounded px-3 py-2 text-sm"
                    value={form.vendorId}
                    onChange={(e) => setForm((prev) => ({ ...prev, vendorId: e.target.value }))}
                >
                    <option value="">Vendor (optional)</option>
                    {vendors.map((v) => (
                        <option key={v._id} value={v._id}>
                            {v.name}
                        </option>
                    ))}
                </select>
                <input
                    className="border rounded px-3 py-2 text-sm md:col-span-2"
                    placeholder="Description"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
                <div className="flex items-center gap-2">
                    <input
                        className="border rounded px-3 py-2 text-sm w-full"
                        placeholder="Tags (comma separated)"
                        value={form.tags}
                        onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                    />
                    <button
                        type="submit"
                        className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" /> Add
                    </button>
                </div>
            </form>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Name</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Description</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Tags</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Pricing</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 w-28">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {materials.map((material) => (
                            <MaterialRow
                                key={material._id}
                                material={material}
                                vendors={vendors}
                                onUpdate={onUpdate}
                                onDelete={onDelete}
                            />
                        ))}
                        {materials.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-sm">
                                    No materials saved yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function MaterialRow({
    material,
    vendors,
    onUpdate,
    onDelete,
}: {
    material: Doc<"materialCatalog">;
    vendors: Doc<"vendors">[];
    onUpdate: (id: Id<"materialCatalog">, updates: Partial<Doc<"materialCatalog">>) => Promise<void>;
    onDelete: (id: Id<"materialCatalog">) => Promise<void>;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState<MaterialFormState>({
        name: material.name,
        category: material.category,
        defaultUnit: material.defaultUnit,
        lastPrice: material.lastPrice.toString(),
        vendorId: material.vendorId ?? "",
        description: material.description ?? "",
        tags: (material.tags ?? []).join(", "),
    });

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft({
            name: material.name,
            category: material.category,
            defaultUnit: material.defaultUnit,
            lastPrice: material.lastPrice.toString(),
            vendorId: material.vendorId ?? "",
            description: material.description ?? "",
            tags: (material.tags ?? []).join(", "),
        });
        setIsEditing(false);
    }, [material]);

    const handleSave = async () => {
        await onUpdate(material._id, {
            name: draft.name.trim() || material.name,
            category: draft.category.trim() || "General",
            defaultUnit: draft.defaultUnit.trim() || "unit",
            lastPrice: Number(draft.lastPrice || material.lastPrice),
            vendorId: draft.vendorId ? (draft.vendorId as Id<"vendors">) : undefined,
            description: draft.description.trim() || undefined,
            tags: parseTags(draft.tags),
        });
        setIsEditing(false);
    };

    const handleDelete = async () => {
        if (!confirm(`Delete material "${material.name}"?`)) return;
        await onDelete(material._id);
    };

    const vendorName = useMemo(
        () => vendors.find((v) => v._id === material.vendorId)?.name,
        [vendors, material.vendorId],
    );

    return (
        <tr className="hover:bg-gray-50">
            <td className="px-3 py-2">
                {isEditing ? (
                    <div className="flex flex-col gap-1">
                        <input
                            className="border rounded px-2 py-1 w-full text-sm"
                            value={draft.name}
                            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                        />
                        <input
                            className="border rounded px-2 py-1 w-full text-sm"
                            value={draft.category}
                            onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))}
                            placeholder="Category"
                        />
                    </div>
                ) : (
                    <>
                        <div className="font-medium text-gray-900">{material.name}</div>
                        <div className="text-xs text-gray-500">{material.category}</div>
                    </>
                )}
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.description}
                        onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                        placeholder="Description"
                    />
                ) : (
                    <div className="text-sm text-gray-700">
                        {material.description || <span className="text-gray-400">-</span>}
                    </div>
                )}
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.tags}
                        onChange={(e) => setDraft((prev) => ({ ...prev, tags: e.target.value }))}
                        placeholder="Tags"
                    />
                ) : (
                    <TagList tags={material.tags} />
                )}
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <div className="grid grid-cols-2 gap-2">
                        <input
                            className="border rounded px-2 py-1 w-full text-sm"
                            value={draft.defaultUnit}
                            onChange={(e) => setDraft((prev) => ({ ...prev, defaultUnit: e.target.value }))}
                            placeholder="Unit"
                        />
                        <input
                            className="border rounded px-2 py-1 w-full text-sm"
                            value={draft.lastPrice}
                            type="number"
                            step="0.01"
                            onChange={(e) => setDraft((prev) => ({ ...prev, lastPrice: e.target.value }))}
                            placeholder="Price"
                        />
                        <select
                            className="border rounded px-2 py-1 text-sm col-span-2"
                            value={draft.vendorId}
                            onChange={(e) => setDraft((prev) => ({ ...prev, vendorId: e.target.value }))}
                        >
                            <option value="">Vendor</option>
                            {vendors.map((v) => (
                                <option key={v._id} value={v._id}>
                                    {v.name}
                                </option>
                            ))}
                        </select>
                    </div>
                ) : (
                    <div className="text-sm text-gray-700 space-y-1">
                        <div className="font-medium">
                            {material.lastPrice} / {material.defaultUnit}
                        </div>
                        <div className="text-xs text-gray-500">
                            {vendorName ? `Vendor: ${vendorName}` : "No vendor"}
                        </div>
                    </div>
                )}
            </td>
            <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <button
                                className="text-green-600 hover:text-green-700"
                                title="Save"
                                onClick={handleSave}
                            >
                                <Save className="w-4 h-4" />
                            </button>
                            <button
                                className="text-gray-500 hover:text-gray-700"
                                title="Cancel"
                                onClick={() => setIsEditing(false)}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </>
                    ) : (
                        <button
                            className="text-blue-600 hover:text-blue-700"
                            title="Edit"
                            onClick={() => setIsEditing(true)}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        className="text-red-500 hover:text-red-600"
                        title="Delete"
                        onClick={handleDelete}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </td>
        </tr>
    );
}
// Employees -----------------------------------------------------------------

function EmployeeManager({
    employees,
    onCreate,
    onUpdate,
    onDelete,
}: {
    employees: Doc<"employees">[];
    onCreate: (input: {
        name: string;
        description?: string;
        role?: string;
        status?: string;
        contactInfo?: string;
        tags?: string[];
    }) => Promise<Id<"employees"> | void>;
    onUpdate: (id: Id<"employees">, updates: Partial<Doc<"employees">>) => Promise<void>;
    onDelete: (id: Id<"employees">) => Promise<void>;
}) {
    const [form, setForm] = useState<EmployeeFormState>(emptyEmployee);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        await onCreate({
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            role: form.role.trim() || undefined,
            status: form.status.trim() || undefined,
            contactInfo: form.contactInfo.trim() || undefined,
            tags: parseTags(form.tags),
        });
        setForm(emptyEmployee);
    };

    return (
        <section className="bg-white border rounded-lg shadow-sm p-4 space-y-4">
            <header className="flex items-center justify-between">
                <div>
                    <p className="text-xs uppercase text-gray-500">People</p>
                    <h2 className="text-xl font-semibold">Employees &amp; Contractors</h2>
                    <p className="text-sm text-gray-500">Name, description, and strong-suit tags keep allocations clear.</p>
                </div>
                <div className="text-sm text-gray-500">{employees.length} total</div>
            </header>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-50 p-3 rounded">
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Name"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Role"
                    value={form.role}
                    onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Status (active, contractor...)"
                    value={form.status}
                    onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                />
                <input
                    className="border rounded px-3 py-2 text-sm md:col-span-2"
                    placeholder="Description (what they do best)"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
                <div className="flex items-center gap-2 md:col-span-1">
                    <input
                        className="border rounded px-3 py-2 text-sm w-full"
                        placeholder="Tags (comma separated)"
                        value={form.tags}
                        onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                    />
                    <button
                        type="submit"
                        className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" /> Add
                    </button>
                </div>
            </form>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Name</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Description</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Tags</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Role / Status</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 w-28">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {employees.map((employee) => (
                            <EmployeeRow
                                key={employee._id}
                                employee={employee}
                                onUpdate={onUpdate}
                                onDelete={onDelete}
                            />
                        ))}
                        {employees.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-sm">
                                    No employees recorded.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function EmployeeRow({
    employee,
    onUpdate,
    onDelete,
}: {
    employee: Doc<"employees">;
    onUpdate: (id: Id<"employees">, updates: Partial<Doc<"employees">>) => Promise<void>;
    onDelete: (id: Id<"employees">) => Promise<void>;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState<EmployeeFormState>({
        name: employee.name,
        description: employee.description ?? "",
        role: employee.role ?? "",
        status: employee.status ?? "",
        contactInfo: employee.contactInfo ?? "",
        tags: (employee.tags ?? []).join(", "),
    });

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft({
            name: employee.name,
            description: employee.description ?? "",
            role: employee.role ?? "",
            status: employee.status ?? "",
            contactInfo: employee.contactInfo ?? "",
            tags: (employee.tags ?? []).join(", "),
        });
        setIsEditing(false);
    }, [employee]);

    const handleSave = async () => {
        await onUpdate(employee._id, {
            name: draft.name.trim() || employee.name,
            description: draft.description.trim() || undefined,
            role: draft.role.trim() || undefined,
            status: draft.status.trim() || undefined,
            contactInfo: draft.contactInfo.trim() || undefined,
            tags: parseTags(draft.tags),
        });
        setIsEditing(false);
    };

    const handleDelete = async () => {
        if (!confirm(`Delete ${employee.name}?`)) return;
        await onDelete(employee._id);
    };

    return (
        <tr className="hover:bg-gray-50">
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.name}
                        onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                    />
                ) : (
                    <div className="font-medium text-gray-900">{employee.name}</div>
                )}
                <div className="text-xs text-gray-500">{employee.contactInfo}</div>
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.description}
                        onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                        placeholder="What they do"
                    />
                ) : (
                    <div className="text-sm text-gray-700">
                        {employee.description || <span className="text-gray-400">-</span>}
                    </div>
                )}
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.tags}
                        onChange={(e) => setDraft((prev) => ({ ...prev, tags: e.target.value }))}
                        placeholder="woodwork, electrics"
                    />
                ) : (
                    <TagList tags={employee.tags} />
                )}
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <div className="flex flex-col gap-1">
                        <input
                            className="border rounded px-2 py-1 w-full text-sm"
                            value={draft.role}
                            onChange={(e) => setDraft((prev) => ({ ...prev, role: e.target.value }))}
                            placeholder="Role"
                        />
                        <input
                            className="border rounded px-2 py-1 w-full text-sm"
                            value={draft.status}
                            onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}
                            placeholder="Status"
                        />
                    </div>
                ) : (
                    <div className="text-sm text-gray-700">
                        {employee.role || <span className="text-gray-400">Role?</span>} ·{" "}
                        {employee.status || <span className="text-gray-400">Status?</span>}
                    </div>
                )}
            </td>
            <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <button
                                className="text-green-600 hover:text-green-700"
                                title="Save"
                                onClick={handleSave}
                            >
                                <Save className="w-4 h-4" />
                            </button>
                            <button
                                className="text-gray-500 hover:text-gray-700"
                                title="Cancel"
                                onClick={() => setIsEditing(false)}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </>
                    ) : (
                        <button
                            className="text-blue-600 hover:text-blue-700"
                            title="Edit"
                            onClick={() => setIsEditing(true)}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        className="text-red-500 hover:text-red-600"
                        title="Delete"
                        onClick={handleDelete}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </td>
        </tr>
    );
}

function TagList({ tags }: { tags?: string[] }) {
    if (!tags || tags.length === 0) return <span className="text-xs text-gray-400">-</span>;
    return (
        <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
                <span
                    key={tag}
                    className="text-[10px] uppercase tracking-wide bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full"
                >
                    {tag}
                </span>
            ))}
        </div>
    );
}

// Vendors -------------------------------------------------------------------

function VendorManager({
    vendors,
    onCreate,
    onUpdate,
    onDelete,
}: {
    vendors: Doc<"vendors">[];
    onCreate: (input: {
        name: string;
        category?: string;
        contactInfo?: string;
        rating?: number;
        description?: string;
        tags?: string[];
    }) => Promise<Id<"vendors"> | void>;
    onUpdate: (id: Id<"vendors">, updates: Partial<Doc<"vendors">>) => Promise<void>;
    onDelete: (id: Id<"vendors">) => Promise<void>;
}) {
    const [form, setForm] = useState<VendorFormState>(emptyVendor);
    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        await onCreate({
            name: form.name.trim(),
            category: form.category.trim() || undefined,
            contactInfo: form.contactInfo.trim() || undefined,
            rating: form.rating ? Number(form.rating) : undefined,
            description: form.description.trim() || undefined,
            tags: parseTags(form.tags),
        });
        setForm(emptyVendor);
    };

    return (
        <section className="bg-white border rounded-lg shadow-sm p-4 space-y-4">
            <header className="flex items-center justify-between">
                <div>
                    <p className="text-xs uppercase text-gray-500">Vendors</p>
                    <h2 className="text-xl font-semibold">Supplier Directory</h2>
                    <p className="text-sm text-gray-500">Add descriptions and tags to reuse trusted partners during accounting.</p>
                </div>
                <div className="text-sm text-gray-500">{vendors.length} total</div>
            </header>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-50 p-3 rounded">
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Vendor name"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Category"
                    value={form.category}
                    onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Contact info"
                    value={form.contactInfo}
                    onChange={(e) => setForm((prev) => ({ ...prev, contactInfo: e.target.value }))}
                />
                <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Rating (1-5)"
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    value={form.rating}
                    onChange={(e) => setForm((prev) => ({ ...prev, rating: e.target.value }))}
                />
                <input
                    className="border rounded px-3 py-2 text-sm md:col-span-2"
                    placeholder="Description"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
                <div className="flex items-center gap-2">
                    <input
                        className="border rounded px-3 py-2 text-sm w-full"
                        placeholder="Tags (comma separated)"
                        value={form.tags}
                        onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                    />
                    <button
                        type="submit"
                        className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" /> Add
                    </button>
                </div>
            </form>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Name</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Description</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Tags</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Contact</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500 w-28">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {vendors.map((vendor) => (
                            <VendorRow key={vendor._id} vendor={vendor} onUpdate={onUpdate} onDelete={onDelete} />
                        ))}
                        {vendors.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-sm">
                                    No vendors yet. Add your first supplier.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function VendorRow({
    vendor,
    onUpdate,
    onDelete,
}: {
    vendor: Doc<"vendors">;
    onUpdate: (id: Id<"vendors">, updates: Partial<Doc<"vendors">>) => Promise<void>;
    onDelete: (id: Id<"vendors">) => Promise<void>;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState<VendorFormState>({
        name: vendor.name,
        category: vendor.category ?? "",
        contactInfo: vendor.contactInfo ?? "",
        rating: vendor.rating?.toString() ?? "",
        description: vendor.description ?? "",
        tags: (vendor.tags ?? []).join(", "),
    });

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft({
            name: vendor.name,
            category: vendor.category ?? "",
            contactInfo: vendor.contactInfo ?? "",
            rating: vendor.rating?.toString() ?? "",
            description: vendor.description ?? "",
            tags: (vendor.tags ?? []).join(", "),
        });
        setIsEditing(false);
    }, [vendor]);

    const handleSave = async () => {
        await onUpdate(vendor._id, {
            name: draft.name.trim() || vendor.name,
            category: draft.category.trim() || undefined,
            contactInfo: draft.contactInfo.trim() || undefined,
            rating: draft.rating ? Number(draft.rating) : undefined,
            description: draft.description.trim() || undefined,
            tags: parseTags(draft.tags),
        });
        setIsEditing(false);
    };

    const handleDelete = async () => {
        if (!confirm(`Delete vendor "${vendor.name}"?`)) return;
        await onDelete(vendor._id);
    };

    return (
        <tr className="hover:bg-gray-50">
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.name}
                        onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                    />
                ) : (
                    <div className="font-medium text-gray-900">{vendor.name}</div>
                )}
                <div className="text-xs text-gray-500">{vendor.category}</div>
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.description}
                        onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                        placeholder="Describe specialty"
                    />
                ) : (
                    <div className="text-sm text-gray-700">
                        {vendor.description || <span className="text-gray-400">-</span>}
                    </div>
                )}
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.tags}
                        onChange={(e) => setDraft((prev) => ({ ...prev, tags: e.target.value }))}
                        placeholder="lighting, carpentry"
                    />
                ) : (
                    <TagList tags={vendor.tags} />
                )}
            </td>
            <td className="px-3 py-2">
                {isEditing ? (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm"
                        value={draft.contactInfo}
                        onChange={(e) => setDraft((prev) => ({ ...prev, contactInfo: e.target.value }))}
                        placeholder="phone/email"
                    />
                ) : (
                    <div className="text-sm text-gray-700">
                        {vendor.contactInfo || <span className="text-gray-400">-</span>}
                    </div>
                )}
                {isEditing && (
                    <input
                        className="border rounded px-2 py-1 w-full text-sm mt-1"
                        type="number"
                        min="0"
                        max="5"
                        step="0.1"
                        value={draft.rating}
                        onChange={(e) => setDraft((prev) => ({ ...prev, rating: e.target.value }))}
                        placeholder="Rating"
                    />
                )}
            </td>
            <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <button
                                className="text-green-600 hover:text-green-700"
                                title="Save"
                                onClick={handleSave}
                            >
                                <Save className="w-4 h-4" />
                            </button>
                            <button
                                className="text-gray-500 hover:text-gray-700"
                                title="Cancel"
                                onClick={() => setIsEditing(false)}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </>
                    ) : (
                        <button
                            className="text-blue-600 hover:text-blue-700"
                            title="Edit"
                            onClick={() => setIsEditing(true)}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        className="text-red-500 hover:text-red-600"
                        title="Delete"
                        onClick={handleDelete}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </td>
        </tr>
    );
}
