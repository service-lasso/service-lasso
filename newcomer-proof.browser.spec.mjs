import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runServiceAdminTour, parseCaptureArguments } from "./scripts/capture-service-admin-tour.mjs";

const adminUrl = process.env.SERVICE_LASSO_NEWCOMER_ADMIN_URL;
const screenshotDir = process.env.SERVICE_LASSO_NEWCOMER_SCREENSHOT_DIR;
if (!adminUrl || !screenshotDir) throw new Error("Newcomer browser suite requires its owned Admin URL and screenshot directory.");

test("first-run handoff, persistent acknowledgement, and complete ops tour", async ({ page }) => {
  test.setTimeout(1_500_000);
  const observations = [];
  // Categories only: browser messages and DOM snapshots can expose credentials.
  page.on("pageerror", () => observations.push({ kind: "pageerror" }));
  page.on("response", (response) => {
    if (response.status() >= 400) observations.push({ kind: "http", status: response.status() });
  });
  const scenarios = [];
  try {
    await test.step("first-run credentials stay gated until acknowledged", async () => {
      await page.goto(adminUrl, { waitUntil: "domcontentloaded" });
      const proceed = page.getByRole("button", { name: "Continue after saving", exact: true });
      await expect(proceed).toBeVisible({ timeout: 30_000 });
      await expect(proceed).toBeDisabled();
      // Do not print, snapshot, persist, or assert the secret values.
      const tokenPresent = (await page.getByRole("textbox", { name: "Local-admin token", exact: true }).inputValue()).length > 0;
      const passwordPresent = (await page.getByRole("textbox", { name: "Lasso-local password", exact: true }).inputValue()).length > 0;
      expect(tokenPresent && passwordPresent, "first-run credentials must be supplied").toBe(true);
      await page.getByRole("checkbox", { name: "I saved this token", exact: true }).check();
      await expect(proceed).toBeEnabled();
      await proceed.click();
      await expect(proceed).toHaveCount(0, { timeout: 30_000 });
      scenarios.push({ scenario: "first-run acknowledgement gate", result: "Verified" });
    });

    await test.step("acknowledgement persists and credentials cannot be re-read", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      const security = await page.request.get(new URL("/api/runtime/security", adminUrl).toString());
      expect(security.status()).toBe(200);
      const policy = (await security.json()).auth.policy;
      expect(policy.firstRunPending).toBe(false);
      expect(policy.credentialsAcknowledged).toBe(true);
      const firstRun = await page.request.get(new URL("/api/runtime/auth/first-run", adminUrl).toString());
      expect(firstRun.status()).toBe(404);
      scenarios.push({ scenario: "acknowledgement persistence and credential re-read denial", result: "Verified" });
    });

    await test.step("ops toolset audits every route and captures redacted screens", async () => {
      const receipt = await runServiceAdminTour(parseCaptureArguments([
        "--url=" + adminUrl,
        "--output-dir=" + path.join(screenshotDir, "ops-tour"),
        "--no-promote",
        "--dashboard-public-policy=dashboard-public-safe-v1",
      ]));
      expect(receipt.ok).toBe(true);
      expect(receipt.auditFailures).toEqual([]);
      expect(receipt.auditedRoutes.length).toBe(receipt.auditScope.total);
      expect(receipt.captures.length).toBe(receipt.captureScope.total);
      scenarios.push({ scenario: "complete ops route audit and redacted screenshots", result: "Verified", routeCount: receipt.auditedRoutes.length, captureCount: receipt.captures.length });
    });
  } finally {
    await mkdir(screenshotDir, { recursive: true });
    await writeFile(path.join(screenshotDir, "browser-scenarios.json"), JSON.stringify({ scenarios, observations }, null, 2));
  }
});
