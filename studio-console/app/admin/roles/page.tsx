"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

export default function RolesPage() {
    const roles = useQuery(api.admin.listRoles);
    const saveRole = useMutation(api.admin.saveRole);
    const deleteRole = useMutation(api.admin.deleteRole);

    const [editingId, setEditingId] = useState<Id<"roleCatalog"> | null>(null);
    const [formData, setFormData] = useState({
        roleName: "",
        defaultRatePerDay: 800,
        isInternalRole: true,
        isVendorRole: false,
    });

    const handleEdit = (role: any) => {
        setEditingId(role._id);
        setFormData({
            roleName: role.roleName,
            defaultRatePerDay: role.defaultRatePerDay,
            isInternalRole: role.isInternalRole,
            isVendorRole: role.isVendorRole,
        });
    };

    const handleCancel = () => {
        setEditingId(null);
        setFormData({
            roleName: "",
            defaultRatePerDay: 800,
            isInternalRole: true,
            isVendorRole: false,
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await saveRole({
                id: editingId ?? undefined,
                ...formData,
            });
            handleCancel();
        } catch (error) {
            console.error(error);
            alert("Failed to save role");
        }
    };

    const handleDelete = async (id: Id<"roleCatalog">) => {
        if (!confirm("Are you sure?")) return;
        await deleteRole({ id });
    };

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-8">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Role Catalog</h1>
                <p className="text-gray-600">Define global default rates for roles.</p>
            </div>

            <div className="bg-white border rounded-lg p-6 shadow-sm">
                <h2 className="text-lg font-semibold mb-4">{editingId ? "Edit Role" : "Add New Role"}</h2>
                <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Role Name</label>
                        <input
                            type="text"
                            required
                            className="mt-1 block w-48 border rounded px-3 py-2 text-sm"
                            value={formData.roleName}
                            onChange={(e) => setFormData({ ...formData, roleName: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Default Rate (ILS/Day)</label>
                        <input
                            type="number"
                            required
                            className="mt-1 block w-32 border rounded px-3 py-2 text-sm"
                            value={formData.defaultRatePerDay}
                            onChange={(e) => setFormData({ ...formData, defaultRatePerDay: Number(e.target.value) })}
                        />
                    </div>
                    <div className="flex items-center gap-2 pb-2">
                        <label className="text-sm text-gray-700 flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={formData.isInternalRole}
                                onChange={(e) => setFormData({ ...formData, isInternalRole: e.target.checked })}
                            />
                            Internal
                        </label>
                        <label className="text-sm text-gray-700 flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={formData.isVendorRole}
                                onChange={(e) => setFormData({ ...formData, isVendorRole: e.target.checked })}
                            />
                            Vendor
                        </label>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="submit"
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
                        >
                            {editingId ? "Update" : "Add"}
                        </button>
                        {editingId && (
                            <button
                                type="button"
                                onClick={handleCancel}
                                className="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-medium rounded hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </form>
            </div>

            <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Default Rate</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {roles?.map((role) => (
                            <tr key={role._id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {role.roleName}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    ₪{role.defaultRatePerDay.toLocaleString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <div className="flex gap-1">
                                        {role.isInternalRole && (
                                            <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-800">Internal</span>
                                        )}
                                        {role.isVendorRole && (
                                            <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800">Vendor</span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button
                                        onClick={() => handleEdit(role)}
                                        className="text-blue-600 hover:text-blue-900 mr-4"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDelete(role._id)}
                                        className="text-red-600 hover:text-red-900"
                                    >
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {roles?.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-6 py-8 text-center text-gray-500 text-sm">
                                    No roles defined yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
