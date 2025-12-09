export function chunkText(text: string, chunkSize = 1000, overlap = 150): string[] {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return [];

    const chunks: string[] = [];
    for (let i = 0; i < cleaned.length; i += chunkSize - overlap) {
        const slice = cleaned.slice(i, i + chunkSize);
        chunks.push(slice);
        if (i + chunkSize >= cleaned.length) {
            break;
        }
    }
    return chunks;
}
