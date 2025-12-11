import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./tests/setupTests.ts"],
        include: [
            "tests/**/*.test.ts?(x)",
            "app/**/*.test.ts?(x)",
            "src/**/*.test.ts?(x)",
            "convex/**/*.test.ts",
        ],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
        },
    },
});
