import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
    turbopack: {
        root: __dirname,
        resolveAlias: {
            "@ungap/structured-clone": "./lib/structuredClonePolyfill.ts",
        },
    },
    webpack: (config) => {
        config.resolve ??= {};
        config.resolve.alias = {
            ...(config.resolve.alias ?? {}),
            "@ungap/structured-clone": path.resolve(__dirname, "lib/structuredClonePolyfill.ts"),
        };
        return config;
    },
};

export default nextConfig;
