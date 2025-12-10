import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { calculateHash } from "../../convex/lib/hash";

describe("calculateHash", () => {
    it("produces the same digest as native sha256", async () => {
        const payload = {
            status: "todo",
            priority: "High",
            title: "Sync lighting vendor",
            metadata: { category: "Logistics" },
        };

        const expected = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        await expect(calculateHash(payload)).resolves.toEqual(expected);
    });

    it("changes output when payload changes", async () => {
        const base = { title: "Task A", status: "todo" };
        const updated = { title: "Task A", status: "done" };

        const baseHash = await calculateHash(base);
        const updatedHash = await calculateHash(updated);

        expect(baseHash).not.toEqual(updatedHash);
    });
});
