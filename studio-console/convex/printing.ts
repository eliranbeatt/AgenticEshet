import { v } from "convex/values";
import { query } from "./_generated/server";

// 3. Printing Module Implementation

export type PrintFileMetadata = {
    widthPx?: number;
    heightPx?: number;
    dpi?: number;
    colorMode?: "cmyk" | "rgb" | "grayscale";
    pageCount?: number;
};

export type PrintSpec = {
    minDpi: number;
    widthCm: number;
    heightCm: number;
    requiredColorMode?: "cmyk" | "rgb";
};

export type PrintQaVerdict = "APPROVED" | "NEEDS_FIXES" | "REJECTED";

export type PrintQaFinding = {
    ruleId: string;
    severity: "info" | "warn" | "fail";
    message: string;
    suggestion?: string;
    measurements?: Record<string, unknown>;
};

export type PrintQaResult = {
    verdict: PrintQaVerdict;
    score: number;
    findings: PrintQaFinding[];
    summary: string;
};

// 1. Metadata Extraction (Simulated)
// In a real implementation, this would use a library like 'sharp' or 'pdf-lib'
export async function extractMetadata(fileUrl: string, fileType: string): Promise<PrintFileMetadata> {
    // Stub for testing
    // We can't really analyze files in this environment easily without external libs.
    // We will assume the file upload metadata might contain some of this, 
    // or this function is called by a Node.js action that has access to 'fs'/'buffer'.
    
    return {
        widthPx: 1000,
        heightPx: 1000,
        dpi: 72,
        colorMode: "rgb"
    };
}

// 2. Spec Validation Logic (Pure Function)
export function validateSpec(fileMeta: PrintFileMetadata, spec: PrintSpec): PrintQaResult {
    const findings: PrintQaFinding[] = [];
    let criticalErrors = 0;
    let warnings = 0;

    // A. Size Check
    // Convert px to cm: (px / dpi) * 2.54
    // If dpi is unknown, we can't check size accurately unless we assume 72 or 300.
    // If we have DPI:
    if (fileMeta.widthPx && fileMeta.heightPx && fileMeta.dpi) {
        const widthCm = (fileMeta.widthPx / fileMeta.dpi) * 2.54;
        const heightCm = (fileMeta.heightPx / fileMeta.dpi) * 2.54;
        
        // Tolerance 10%?
        const tolerance = 0.1;
        if (Math.abs(widthCm - spec.widthCm) > spec.widthCm * tolerance) {
             findings.push({
                 ruleId: "SIZE_MISMATCH",
                 severity: "fail",
                 message: `Detected width ${widthCm.toFixed(1)}cm != expected ${spec.widthCm}cm`,
             });
             criticalErrors++;
        }
    }

    // B. DPI Check
    // If raster, we need > minDpi at final size.
    // If the file dpi is set, check it.
    // Note: 'dpi' in metadata is often just a header. Real effective DPI depends on scaling.
    // We assume file is at 100% scale.
    if (fileMeta.dpi && fileMeta.dpi < spec.minDpi) {
        findings.push({
            ruleId: "DPI_TOO_LOW",
            severity: "fail",
            message: `File DPI ${fileMeta.dpi} is below minimum ${spec.minDpi}`,
            measurements: { dpi: fileMeta.dpi, min: spec.minDpi }
        });
        criticalErrors++;
    }

    // C. Color Mode
    if (spec.requiredColorMode && fileMeta.colorMode) {
        if (fileMeta.colorMode.toLowerCase() !== spec.requiredColorMode.toLowerCase()) {
            const severity = spec.requiredColorMode.toLowerCase() === "cmyk" ? "warn" : "info";
            findings.push({
                ruleId: "COLOR_MODE_MISMATCH",
                severity: severity,
                message: `File is ${fileMeta.colorMode}, expected ${spec.requiredColorMode}`,
                suggestion: "Convert to CMYK to ensure color accuracy."
            });
            if (severity === "warn") warnings++;
        }
    }

    let verdict: PrintQaVerdict = "APPROVED";
    let score = 100;

    if (criticalErrors > 0) {
        verdict = "REJECTED";
        score = 0;
    } else if (warnings > 0) {
        verdict = "NEEDS_FIXES"; // or Approved with warnings
        score = 80;
    }

    return {
        verdict,
        score,
        findings,
        summary: `Analysis complete: ${criticalErrors} errors, ${warnings} warnings.`
    };
}

export const getSummary = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const groups = await ctx.db
            .query("printFileGroups")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .collect();
        const files = await ctx.db
            .query("printFiles")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .collect();
        const latestQa = await ctx.db
            .query("printQaRuns")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .first();

        return {
            groupCount: groups.length,
            fileCount: files.length,
            lastQaRun: latestQa,
        };
    },
});
