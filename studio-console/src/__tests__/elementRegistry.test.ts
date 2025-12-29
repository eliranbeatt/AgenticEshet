import { describe, expect, it } from "vitest";
import {
    COMMON_FIELDS_V1,
    FREE_TEXT_BUCKETS_V1,
    ELEMENT_TYPES_V1,
    isValidFieldPath,
    isValidBucketKey,
} from "../../convex/lib/elementRegistry";

describe("elementRegistry", () => {
    it("contains required meta fields", () => {
        const paths = COMMON_FIELDS_V1.map((field) => field.path);
        expect(paths).toContain("meta.title");
        expect(paths).toContain("meta.typeKey");
    });

    it("validates known field paths", () => {
        expect(isValidFieldPath("dimensions.widthCm")).toBe(true);
        expect(isValidFieldPath("unknown.field")).toBe(false);
    });

    it("validates known bucket keys", () => {
        expect(isValidBucketKey("designNotes")).toBe(true);
        expect(isValidBucketKey("missing")).toBe(false);
    });

    it("exports element types", () => {
        expect(ELEMENT_TYPES_V1.length).toBeGreaterThan(0);
    });

    it("exports free text buckets", () => {
        expect(FREE_TEXT_BUCKETS_V1.length).toBeGreaterThan(0);
    });
});
