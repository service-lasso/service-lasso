import { defineConfig } from "@playwright/test";

const artifactDir = process.env.SERVICE_LASSO_NEWCOMER_PLAYWRIGHT_DIR ?? "playwright-newcomer-results";

export default defineConfig({
  testDir: ".",
  testMatch: "newcomer-proof.browser.spec.mjs",
  fullyParallel: false,
  workers: 1,
  outputDir: `${artifactDir}/test-results`,
  timeout: 90_000,
  reporter: [
    ["list"],
    ["json", { outputFile: `${artifactDir}/playwright-results.json` }],
  ],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1024 },
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});
