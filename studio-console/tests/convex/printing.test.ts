
import { describe, it, expect } from "vitest";
import { extractMetadata, validateSpec } from "../../convex/printing"; // Function to be implemented

describe("Printing Module", () => {
    
  describe("Spec Validation", () => {
    it("should pass when DPI and Size are correct", () => {
        const fileMeta = { widthPx: 3000, heightPx: 3000, dpi: 300, colorMode: "CMYK" };
        const spec = { minDpi: 150, widthCm: 25.4, heightCm: 25.4, requiredColorMode: "CMYK" };
        
        // 3000px / 300dpi = 10 inch = 25.4 cm. Exact match.
        const result = validateSpec(fileMeta, spec);
        expect(result.verdict).toBe("APPROVED");
    });

    it("should fail when DPI is too low", () => {
        const fileMeta = { widthPx: 100, heightPx: 100, dpi: 72, colorMode: "RGB" };
        const spec = { minDpi: 300, widthCm: 10, heightCm: 10 };
        
        const result = validateSpec(fileMeta, spec);
        expect(result.verdict).toBe("REJECTED");
        expect(result.findings).toContainEqual(expect.objectContaining({ ruleId: "DPI_TOO_LOW" }));
    });

    it("should warn on RGB color mode if CMYK requested", () => {
        // 1 inch at 300 DPI = 300px = 2.54cm
        const fileMeta = { widthPx: 300, heightPx: 300, dpi: 300, colorMode: "RGB" };
        const spec = { minDpi: 150, widthCm: 2.54, heightCm: 2.54, requiredColorMode: "CMYK" };

        const result = validateSpec(fileMeta as any, spec);
        expect(result.verdict).toBe("NEEDS_FIXES"); // Or WARN depending on logic
        expect(result.findings).toContainEqual(expect.objectContaining({ ruleId: "COLOR_MODE_MISMATCH" }));
    });
  });
});
