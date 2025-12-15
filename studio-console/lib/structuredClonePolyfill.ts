export default function structuredClonePolyfill<T>(value: T): T {
    const maybeStructuredClone = (globalThis as unknown as { structuredClone?: (input: unknown) => unknown }).structuredClone;
    if (typeof maybeStructuredClone === "function") {
        return maybeStructuredClone(value) as T;
    }

    return JSON.parse(JSON.stringify(value)) as T;
}

