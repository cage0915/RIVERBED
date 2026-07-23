import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: false,
    retries: process.env.CI ? 2 : 0,
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:4322",
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    webServer: {
        command: "npm run preview -- --host 127.0.0.1 --port 4322",
        url: "http://127.0.0.1:4322",
        reuseExistingServer: false,
    },
});
