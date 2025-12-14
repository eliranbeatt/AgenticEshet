import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getDriveAccount = query({
    args: { ownerUserId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("connectorAccounts")
            .withIndex("by_owner_type", (q) =>
                q.eq("ownerUserId", args.ownerUserId).eq("type", "drive")
            )
            .first();
    },
});

export const upsertDriveAccountFromOAuth = mutation({
    args: {
        ownerUserId: v.string(),
        accessToken: v.string(),
        refreshToken: v.optional(v.string()),
        expiryDate: v.optional(v.number()),
        email: v.optional(v.string()),
        googleUserId: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("connectorAccounts")
            .withIndex("by_owner_type", (q) =>
                q.eq("ownerUserId", args.ownerUserId).eq("type", "drive")
            )
            .first();

        const now = Date.now();
        if (existing) {
            await ctx.db.patch(existing._id, {
                status: "connected",
                auth: {
                    ...existing.auth,
                    accessToken: args.accessToken,
                    refreshToken: args.refreshToken ?? existing.auth.refreshToken,
                    expiryDate: args.expiryDate,
                    email: args.email ?? existing.auth.email,
                    googleUserId: args.googleUserId,
                },
                updatedAt: now,
            });
            return existing._id;
        }

        return await ctx.db.insert("connectorAccounts", {
            type: "drive",
            ownerUserId: args.ownerUserId,
            status: "connected",
            auth: {
                accessToken: args.accessToken,
                refreshToken: args.refreshToken,
                expiryDate: args.expiryDate,
                email: args.email,
                googleUserId: args.googleUserId,
            },
            createdAt: now,
            updatedAt: now,
        });
    },
});

export const updateDriveTokens = mutation({
    args: {
        accountId: v.id("connectorAccounts"),
        accessToken: v.string(),
        expiryDate: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const account = await ctx.db.get(args.accountId);
        if (!account) throw new Error("Account not found");

        await ctx.db.patch(args.accountId, {
            auth: {
                ...account.auth,
                accessToken: args.accessToken,
                expiryDate: args.expiryDate,
            },
            status: "connected",
            updatedAt: Date.now(),
        });
    },
});

export const disconnectDriveAccount = mutation({
    args: { accountId: v.id("connectorAccounts") },
    handler: async (ctx, args) => {
        const account = await ctx.db.get(args.accountId);
        if (!account) return;

        await ctx.db.patch(args.accountId, {
            status: "disconnected",
            auth: {
                email: account.auth.email,
                googleUserId: account.auth.googleUserId,
            },
            updatedAt: Date.now(),
        });
    },
});

export const listWatchesByProject = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("connectorWatches")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();
    },
});

export const getWatch = query({
    args: { watchId: v.id("connectorWatches") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.watchId);
    },
});

export const watchDriveFolder = mutation({
    args: {
        projectId: v.id("projects"),
        ownerUserId: v.optional(v.string()),
        folderId: v.string(),
        folderName: v.string(),
    },
    handler: async (ctx, args) => {
        const ownerUserId = args.ownerUserId ?? "system";
        const account = await ctx.db
            .query("connectorAccounts")
            .withIndex("by_owner_type", (q) =>
                q.eq("ownerUserId", ownerUserId).eq("type", "drive")
            )
            .first();

        if (!account || account.status !== "connected") {
            throw new Error("Drive account not connected");
        }

        const existing = await ctx.db
            .query("connectorWatches")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .filter((q) =>
                q.and(
                    q.eq(q.field("accountId"), account._id),
                    q.eq(q.field("type"), "driveFolder"),
                    q.eq(q.field("externalId"), args.folderId)
                )
            )
            .first();

        const now = Date.now();
        if (existing) {
            await ctx.db.patch(existing._id, {
                name: args.folderName,
                enabled: true,
                updatedAt: now,
            });
            return existing._id;
        }

        return await ctx.db.insert("connectorWatches", {
            projectId: args.projectId,
            accountId: account._id,
            type: "driveFolder",
            externalId: args.folderId,
            name: args.folderName,
            enabled: true,
            cursorState: {
                pageToken: undefined,
                lastSyncAt: undefined,
            },
            createdAt: now,
            updatedAt: now,
        });
    },
});

export const setWatchEnabled = mutation({
    args: {
        watchId: v.id("connectorWatches"),
        enabled: v.boolean(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.watchId, {
            enabled: args.enabled,
            updatedAt: Date.now(),
        });
    },
});

export const updateWatchCursor = mutation({
    args: {
        watchId: v.id("connectorWatches"),
        cursorState: v.object({
            pageToken: v.optional(v.string()),
            lastSyncAt: v.optional(v.number()),
        }),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.watchId, {
            cursorState: args.cursorState,
            updatedAt: Date.now(),
        });
    },
});
