import { strFromU8, unzipSync } from "fflate";

const TEXT_MIME_TYPES = new Set([
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "application/json",
]);

const DOCX_MIME_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]);

const XLSX_MIME_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
]);

const PPTX_MIME_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
]);

export async function extractTextFromFile(buffer: ArrayBuffer, mimeType: string, filename: string): Promise<string> {
    const normalizedMime = mimeType.toLowerCase();
    const lowerFilename = filename.toLowerCase();

    if (normalizedMime === "application/pdf" || lowerFilename.endsWith(".pdf")) {
        return extractPdfText(buffer);
    }

    if (TEXT_MIME_TYPES.has(normalizedMime) || lowerFilename.endsWith(".md") || lowerFilename.endsWith(".txt")) {
        return new TextDecoder().decode(buffer);
    }

    if (DOCX_MIME_TYPES.has(normalizedMime) || lowerFilename.endsWith(".docx")) {
        return extractDocxText(buffer);
    }

    if (XLSX_MIME_TYPES.has(normalizedMime) || lowerFilename.endsWith(".xlsx")) {
        return extractXlsxText(buffer);
    }

    if (PPTX_MIME_TYPES.has(normalizedMime) || lowerFilename.endsWith(".pptx")) {
        return extractPptxText(buffer);
    }

    return new TextDecoder().decode(buffer);
}

function extractPdfText(buffer: ArrayBuffer): string {
    const content = new TextDecoder("latin1").decode(buffer);
    const pieces: string[] = [];

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        if (char === "(") {
            const { text, endIndex } = parsePdfLiteralString(content, i);
            const { token } = readNextToken(content, endIndex);
            if (token === "Tj") {
                pieces.push(text);
                i = endIndex;
                continue;
            }
        }

        if (char === "[") {
            const { texts, endIndex } = parsePdfArray(content, i);
            const { token } = readNextToken(content, endIndex);
            if (token === "TJ" && texts.length > 0) {
                pieces.push(texts.join(""));
                i = endIndex;
                continue;
            }
        }
    }

    return pieces.join("\n").replace(/\s+\n/g, "\n").trim();
}

function parsePdfLiteralString(source: string, startIndex: number): { text: string; endIndex: number } {
    let depth = 0;
    let output = "";
    let i = startIndex;

    if (source[i] !== "(") {
        throw new Error("Expected literal string");
    }

    i++;
    depth++;

    while (i < source.length && depth > 0) {
        const char = source[i];
        if (char === "\\") {
            const { value, offset } = decodePdfEscape(source, i);
            output += value;
            i += offset;
            continue;
        }

        if (char === "(") {
            depth++;
            output += char;
            i++;
            continue;
        }

        if (char === ")") {
            depth--;
            if (depth === 0) {
                i++;
                break;
            }
            output += ")";
            i++;
            continue;
        }

        output += char;
        i++;
    }

    return { text: output, endIndex: i };
}

function parsePdfArray(source: string, startIndex: number): { texts: string[]; endIndex: number } {
    const texts: string[] = [];
    let i = startIndex + 1;
    let depth = 1;

    while (i < source.length && depth > 0) {
        const char = source[i];
        if (char === "(") {
            const { text, endIndex } = parsePdfLiteralString(source, i);
            texts.push(text);
            i = endIndex;
            continue;
        }

        if (char === "[") {
            depth++;
            i++;
            continue;
        }

        if (char === "]") {
            depth--;
            i++;
            continue;
        }

        i++;
    }

    return { texts, endIndex: i };
}

function decodePdfEscape(source: string, index: number): { value: string; offset: number } {
    const next = source[index + 1];
    if (/[0-7]/.test(next)) {
        let octal = next;
        let offset = 2;
        for (let k = 0; k < 2; k++) {
            const char = source[index + offset];
            if (char && /[0-7]/.test(char)) {
                octal += char;
                offset++;
            } else {
                break;
            }
        }
        return { value: String.fromCharCode(parseInt(octal, 8)), offset };
    }

    if (next === "\n" || next === "\r") {
        let offset = 2;
        if (next === "\r" && source[index + 2] === "\n") {
            offset++;
        }
        return { value: "", offset };
    }

    const map: Record<string, string> = {
        "n": "\n",
        "r": "\r",
        "t": "\t",
        "b": "\b",
        "f": "\f",
        "\\": "\\",
        "(": "(",
        ")": ")",
    };

    return { value: map[next] ?? next, offset: 2 };
}

function readNextToken(source: string, startIndex: number): { token: string | null; index: number } {
    let i = startIndex;
    while (i < source.length) {
        const char = source[i];
        if (char === "%") {
            while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
                i++;
            }
            continue;
        }
        if (/\s/.test(char)) {
            i++;
            continue;
        }
        break;
    }

    const start = i;
    while (i < source.length && !/\s/.test(source[i])) {
        const char = source[i];
        if (char === "[" || char === "]" || char === "(" || char === ")") {
            if (i === start) {
                i++;
            }
            break;
        }
        i++;
    }

    const token = start === i ? null : source.slice(start, i);
    return { token, index: i };
}

function extractDocxText(buffer: ArrayBuffer): string {
    const archive = unzipSync(new Uint8Array(buffer));
    const xmlFile = archive["word/document.xml"];
    if (!xmlFile) {
        throw new Error("DOCX does not contain document.xml");
    }
    const xml = strFromU8(xmlFile);
    return cleanDocxXml(xml);
}

function cleanDocxXml(xml: string): string {
    const replaced = xml
        .replace(/<w:tab[^>]*\/>/gi, "\t")
        .replace(/<w:br[^>]*\/>/gi, "\n")
        .replace(/<\/w:p>/gi, "\n")
        .replace(/<w:p[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " ");

    return decodeXmlEntities(replaced)
        .replace(/\r/g, "")
        .replace(/\n{2,}/g, "\n")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+\n/g, "\n")
        .trim();
}

function decodeXmlEntities(value: string): string {
    return value.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (match, entity) => {
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
            const codePoint = parseInt(entity.slice(2), 16);
            return String.fromCodePoint(codePoint);
        }
        if (entity.startsWith("#")) {
            const codePoint = parseInt(entity.slice(1), 10);
            return String.fromCodePoint(codePoint);
        }
        const named: Record<string, string> = {
            amp: "&",
            lt: "<",
            gt: ">",
            quot: "\"",
            apos: "'",
        };
        return named[entity] ?? match;
    });
}

function extractXlsxText(buffer: ArrayBuffer): string {
    try {
        const archive = unzipSync(new Uint8Array(buffer));
        
        // 1. Parse Shared Strings
        const sharedStringsFile = archive["xl/sharedStrings.xml"];
        const sharedStrings: string[] = [];
        if (sharedStringsFile) {
            const xml = strFromU8(sharedStringsFile);
            const matches = xml.match(/<t[^>]*>([^<]*)<\/t>/g);
            if (matches) {
                for (const match of matches) {
                    const content = match.replace(/<[^>]+>/g, "");
                    sharedStrings.push(decodeXmlEntities(content));
                }
            }
        }

        // 2. Parse Sheets
        let output = "";
        const sheetFiles = Object.keys(archive).filter(k => k.match(/^xl\/worksheets\/sheet\d+\.xml$/));
        sheetFiles.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)![0]);
            const numB = parseInt(b.match(/\d+/)![0]);
            return numA - numB;
        });

        for (const filename of sheetFiles) {
            const xml = strFromU8(archive[filename]);
            const rows = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g);
            if (rows) {
                output += `[Sheet ${filename.match(/\d+/)![0]}]\n`;
                for (const row of rows) {
                    const cells = row.match(/<c[^>]*>[\s\S]*?<\/c>/g);
                    if (cells) {
                        for (const cell of cells) {
                            const rMatch = cell.match(/r="([^"]*)"/);
                            const cellRef = rMatch ? rMatch[1] : "?";

                            const isShared = cell.includes('t="s"');
                            const valueMatch = cell.match(/<v>([^<]*)<\/v>/);
                            let cellValue = "";

                            if (valueMatch) {
                                const val = valueMatch[1];
                                if (isShared) {
                                    const index = parseInt(val, 10);
                                    if (sharedStrings[index]) {
                                        cellValue = sharedStrings[index];
                                    }
                                } else {
                                    cellValue = val;
                                }
                            } else {
                                const inlineMatch = cell.match(/<t>([^<]*)<\/t>/);
                                if (inlineMatch) {
                                    cellValue = decodeXmlEntities(inlineMatch[1]);
                                }
                            }

                            if (cellValue) {
                                output += `${cellRef}: ${cellValue}\n`;
                            }
                        }
                    }
                }
                output += "\n";
            }
        }
        return output.trim();
    } catch (e) {
        console.error("XLSX parsing failed", e);
        return "";
    }
}

function extractPptxText(buffer: ArrayBuffer): string {
    try {
        const archive = unzipSync(new Uint8Array(buffer));
        let output = "";
        
        const slideFiles = Object.keys(archive).filter(k => k.match(/^ppt\/slides\/slide\d+\.xml$/));
        slideFiles.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)![0]);
            const numB = parseInt(b.match(/\d+/)![0]);
            return numA - numB;
        });

        for (const filename of slideFiles) {
            const xml = strFromU8(archive[filename]);
            const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g);
            if (matches) {
                const slideText = matches.map(m => decodeXmlEntities(m.replace(/<[^>]+>/g, ""))).join(" ");
                output += `[Slide ${filename.match(/\d+/)![0]}]\n${slideText}\n\n`;
            }
        }
        return output.trim();
    } catch (e) {
        console.error("PPTX parsing failed", e);
        return "";
    }
}
