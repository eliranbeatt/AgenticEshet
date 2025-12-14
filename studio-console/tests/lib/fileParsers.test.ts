import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractTextFromFile } from "../../convex/lib/fileParsers";
import * as fflate from "fflate";

// Mock fflate
vi.mock("fflate", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fflate")>();
    return {
        ...actual,
        unzipSync: vi.fn(),
        strFromU8: (arr: Uint8Array) => new TextDecoder().decode(arr),
    };
});

describe("extractTextFromFile", () => {
    const mockUnzipSync = fflate.unzipSync as unknown as ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("extracts text from plain text files", async () => {
        const content = "Hello World";
        const buffer = new TextEncoder().encode(content).buffer;
        const result = await extractTextFromFile(buffer, "text/plain", "test.txt");
        expect(result).toBe(content);
    });

    it("extracts text from DOCX files", async () => {
        const xmlContent = `
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                <w:body>
                    <w:p><w:r><w:t>Hello</w:t></w:r></w:p>
                    <w:p><w:r><w:t>World</w:t></w:r></w:p>
                </w:body>
            </w:document>
        `;
        
        mockUnzipSync.mockReturnValue({
            "word/document.xml": new TextEncoder().encode(xmlContent),
        });

        const buffer = new ArrayBuffer(10); // Dummy buffer
        const result = await extractTextFromFile(buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "test.docx");
        
        expect(result).toContain("Hello");
        expect(result).toContain("World");
    });

    it("extracts text from XLSX files (shared strings)", async () => {
        const sharedStringsXml = `
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                <si><t>Cell1</t></si>
                <si><t>Cell2</t></si>
            </sst>
        `;
        
        const sheetXml = `
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                <sheetData>
                    <row>
                        <c t="s"><v>0</v></c>
                        <c t="s"><v>1</v></c>
                    </row>
                </sheetData>
            </worksheet>
        `;

        mockUnzipSync.mockReturnValue({
            "xl/sharedStrings.xml": new TextEncoder().encode(sharedStringsXml),
            "xl/worksheets/sheet1.xml": new TextEncoder().encode(sheetXml),
        });

        const buffer = new ArrayBuffer(10);
        const result = await extractTextFromFile(buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "test.xlsx");
        
        expect(result).toContain("Cell1");
        expect(result).toContain("Cell2");
    });

    it("extracts text from PPTX files (slides)", async () => {
        const slideXml = `
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:t>Slide Title</a:t>
                <a:t>Slide Content</a:t>
            </p:sld>
        `;
        
        mockUnzipSync.mockReturnValue({
            "ppt/slides/slide1.xml": new TextEncoder().encode(slideXml),
            "ppt/slides/slide2.xml": new TextEncoder().encode(slideXml.replace("Title", "Title2")),
        });

        const buffer = new ArrayBuffer(10);
        const result = await extractTextFromFile(buffer, "application/vnd.openxmlformats-officedocument.presentationml.presentation", "test.pptx");
        
        expect(result).toContain("Slide Title");
        expect(result).toContain("Slide Content");
        expect(result).toContain("Slide Title2");
    });
});
