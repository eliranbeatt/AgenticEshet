import { webcrypto } from "node:crypto";

if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto;
}

if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-key";
}

if (typeof window !== "undefined") {
    await import("@testing-library/jest-dom/vitest");
}
