"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

type EntityType = "materialLine" | "task" | "quote";

export function ImagePicker({
    projectId,
    entityType,
    entityId,
}: {
    projectId: Id<"projects">;
    entityType: EntityType;
    entityId: string;
}) {
    const linked = useQuery(api.assets.listEntityAssets, { projectId, entityType, entityId });
    const allImages = useQuery(api.assets.listProjectAssets, { projectId, kind: "image" });

    const generateUploadUrl = useMutation(api.assets.generateUploadUrl);
    const createAssetFromUpload = useMutation(api.assets.createAssetFromUpload);
    const linkAsset = useMutation(api.assets.linkAsset);
    const unlinkAsset = useMutation(api.assets.unlinkAsset);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [selectedAssetId, setSelectedAssetId] = useState<Id<"projectAssets"> | "">("");

    const linkedIds = useMemo(() => new Set((linked ?? []).map((a) => a._id)), [linked]);
    const attachable = useMemo(() => {
        if (!allImages) return [];
        return allImages.filter((a) => !linkedIds.has(a._id));
    }, [allImages, linkedIds]);

    async function uploadAndAttach(file: File) {
        setIsUploading(true);
        try {
            const uploadUrl = await generateUploadUrl();
            const uploadResponse = await fetch(uploadUrl, {
                method: "POST",
                headers: { "Content-Type": file.type || "application/octet-stream" },
                body: file,
            });

            if (!uploadResponse.ok) {
                throw new Error(`Upload failed: ${uploadResponse.status}`);
            }

            const { storageId } = (await uploadResponse.json()) as { storageId: string };
            const { assetId } = await createAssetFromUpload({
                projectId,
                storageId,
                mimeType: file.type || "application/octet-stream",
                filename: file.name,
            });

            await linkAsset({
                projectId,
                assetId,
                entityType,
                entityId,
                role: "attachment",
            });
        } finally {
            setIsUploading(false);
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Images</div>
                <div className="flex items-center gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            void uploadAndAttach(file);
                            e.target.value = "";
                        }}
                    />
                    <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                    >
                        {isUploading ? "Uploading..." : "Upload"}
                    </button>
                </div>
            </div>

            {linked === undefined ? (
                <div className="text-sm text-gray-500">Loading images...</div>
            ) : linked.length === 0 ? (
                <div className="text-sm text-gray-500">No images attached yet.</div>
            ) : (
                <div className="grid grid-cols-3 gap-2">
                    {linked.map((asset) => (
                        <div key={asset._id} className="relative group border rounded overflow-hidden bg-gray-50">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={asset.url ?? ""}
                                alt={asset.filename ?? "image"}
                                className="w-full h-24 object-cover"
                            />
                            <button
                                type="button"
                                className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-white/90 border opacity-0 group-hover:opacity-100"
                                onClick={async () => {
                                    await unlinkAsset({ projectId, assetId: asset._id, entityType, entityId });
                                }}
                            >
                                Remove
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-center gap-2">
                <select
                    className="flex-1 border rounded px-2 py-1 text-sm bg-white"
                    value={selectedAssetId}
                    onChange={(e) => setSelectedAssetId(e.target.value as Id<"projectAssets"> | "")}
                    disabled={!attachable || attachable.length === 0}
                >
                    <option value="">Attach existing project image...</option>
                    {attachable.map((asset) => (
                        <option key={asset._id} value={asset._id}>
                            {asset.filename ?? asset._id}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    disabled={!selectedAssetId}
                    onClick={async () => {
                        if (!selectedAssetId) return;
                        await linkAsset({
                            projectId,
                            assetId: selectedAssetId,
                            entityType,
                            entityId,
                            role: "attachment",
                        });
                        setSelectedAssetId("");
                    }}
                >
                    Attach
                </button>
            </div>
        </div>
    );
}
