import ttsc from "@ttsc/unplugin/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [ttsc()],
    test: {
        clearMocks: true,
        environment: "node",
        include: ["tests/**/*.test.ts"],
        // maxConcurrency: 10,
        testTimeout: 18000,
        coverage: {
            provider: "v8",
            include: ["src/**"],
            reporter: ["text", "json", "json-summary"],
            reportOnFailure: true,
        },
    },
});
