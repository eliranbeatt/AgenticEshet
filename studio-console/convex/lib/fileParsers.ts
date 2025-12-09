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

export async function extractTextFromFile(buffer: ArrayBuffer, mimeType: string, filename: string): Promise<string> {
    const normalizedMime = mimeType.toLowerCase();

    if (normalizedMime === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
        return extractPdfText(buffer);
    }

    if (TEXT_MIME_TYPES.has(normalizedMime) || filename.toLowerCase().endsWith(".md") || filename.toLowerCase().endsWith(".txt")) {
        return new TextDecoder().decode(buffer);
    }

    if (DOCX_MIME_TYPES.has(normalizedMime) || filename.toLowerCase().endsWith(".docx")) {
        return extractDocxText(buffer);
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
