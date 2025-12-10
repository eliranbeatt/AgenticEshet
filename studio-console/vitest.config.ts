import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        setupFiles: ["./tests/setupTests.ts"],
        include: ["tests/**/*.test.ts", "app/**/*.test.ts?(x)", "src/**/*.test.ts?(x)", "convex/**/*.test.ts"],
        environmentMatchGlobs: [
            ["app/**/*.test.ts?(x)", "jsdom"],
            ["src/**/*.test.ts?(x)", "jsdom"],
        ],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
        },
    },
});
