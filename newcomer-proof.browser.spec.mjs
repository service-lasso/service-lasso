import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runServiceAdminTour, parseCaptureArguments, passwordFieldMaskOptions, localPathCaptureMask } from "./scripts/capture-service-admin-tour.mjs";

const adminUrl = process.env.SERVICE_LASSO_NEWCOMER_ADMIN_URL;
const screenshotDir = process.env.SERVICE_LASSO_NEWCOMER_SCREENSHOT_DIR;
if (!adminUrl || !screenshotDir) throw new Error("Newcomer browser suite requires its owned Admin URL and screenshot directory.");

test("first-run handoff, persistent acknowledgement, lifecycle, and complete ops tour", async ({ page, browser }) => {
  test.setTimeout(1_500_000);
  const observations = [];
  // Categories only: browser messages and DOM snapshots can expose credentials.
  page.on("pageerror", () => observations.push({ kind: "pageerror" }));
  page.on("response", (response) => {
    if (response.status() >= 400) observations.push({ kind: "http", status: response.status() });
  });
  const scenarios = [];
  const startedAt = new Date().toISOString();
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
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(adminUrl).origin });
      await page.getByRole("button", { name: "Copy local-admin token", exact: true }).click();
      await page.getByRole("button", { name: "Copy local-operator password", exact: true }).click();
      // Complete the actual copy gate, but leave no disposable credential on
      // the clipboard after this browser-only handoff exercise.
      await page.evaluate(() => navigator.clipboard.writeText(""));
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

    await test.step("Echo cancel, stop, start and restart preserve authoritative state", async () => {
      await page.goto(adminUrl, { waitUntil: "domcontentloaded" });
      const localRoot = page.getByRole("button", { name: "Continue as local-root", exact: true });
      await expect(localRoot).toBeVisible({ timeout: 30_000 });
      await localRoot.click();
      await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 30_000 });
      await page.goto(new URL("/services/echo-service", adminUrl).toString());
      await expect(page.getByRole("heading", { name: "Echo Service", exact: true })).toBeVisible({ timeout: 30_000 });
      const readEcho = async () => {
        const response = await page.request.get(new URL("/api/services/echo-service", adminUrl).toString());
        expect(response.status()).toBe(200);
        return (await response.json()).service.lifecycle;
      };
      const captureState = async (name) => {
        await mkdir(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, name + ".png"), fullPage: false,
          mask: [...passwordFieldMaskOptions(page).mask, await localPathCaptureMask(page)], animations: "disabled" });
      };
      const original = await readEcho();
      expect(original.running).toBe(true);
      const stop = page.getByRole("button", { name: "Stop service", exact: true });
      await stop.click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await captureState("echo-stop-confirmation");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect((await readEcho()).runtime.pid).toBe(original.runtime.pid);
      expect((await readEcho()).running).toBe(true);
      scenarios.push({ scenario: "cancel stop leaves Echo running with the same process", result: "Verified" });

      await stop.click();
      await dialog.getByRole("button", { name: /Stop service|Continue/, exact: true }).click();
      await expect.poll(async () => (await readEcho()).running, { timeout: 30_000 }).toBe(false);
      await page.reload();
      await expect(page.getByText("Stopped", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await captureState("echo-stopped-after-refresh");
      scenarios.push({ scenario: "confirmed stop persists across browser refresh", result: "Verified" });

      await page.getByRole("button", { name: "Start service", exact: true }).first().click();
      await expect.poll(async () => (await readEcho()).running, { timeout: 60_000 }).toBe(true);
      await expect(page.getByText("Running", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      const started = await readEcho();
      expect(started.runtime.pid).not.toBe(original.runtime.pid);
      await captureState("echo-running-after-start");
      await page.getByRole("button", { name: "Restart service", exact: true }).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /Restart service|Continue/, exact: true }).click();
      await expect.poll(async () => {
        const state = await readEcho();
        return state.running && state.runtime.pid !== started.runtime.pid;
      }, { timeout: 60_000 }).toBe(true);
      await page.reload();
      await expect(page.getByText("Running", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await captureState("echo-running-after-restart");
      scenarios.push({ scenario: "start and restart create new managed processes and render Running after refresh", result: "Verified" });
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
    const installed = JSON.parse(await readFile(new URL("./node_modules/@playwright/test/package.json", import.meta.url), "utf8"));
    await writeFile(path.join(screenshotDir, "browser-scenarios.json"), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), playwrightVersion: installed.version, browserVersion: browser.version(), scenarios, observations }, null, 2));
  }
});
