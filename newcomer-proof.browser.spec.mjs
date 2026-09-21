import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeEvidence } from "./scripts/newcomer-proof.mjs";

const adminUrl = process.env.SERVICE_LASSO_NEWCOMER_ADMIN_URL;
const screenshotDir = process.env.SERVICE_LASSO_NEWCOMER_SCREENSHOT_DIR;

if (!adminUrl || !screenshotDir) {
  throw new Error("Newcomer browser suite requires SERVICE_LASSO_NEWCOMER_ADMIN_URL and SERVICE_LASSO_NEWCOMER_SCREENSHOT_DIR.");
}

async function capture(page, name) {
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: true });
}

async function visitVisibleRoute(page, route, screenshotName, expectedText) {
  const response = await page.goto(new URL(route, adminUrl).toString(), { waitUntil: "networkidle" });
  expect(response, `${route} did not return a browser response`).not.toBeNull();
  expect(response.status(), `${route} returned a failing status`).toBeLessThan(400);
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("body")).not.toHaveText(/^\s*$/);
  if (expectedText) {
    await expect(page.locator("body")).toContainText(expectedText, { ignoreCase: true });
  }
  await capture(page, screenshotName);
}

test.describe("Service Lasso newcomer proof", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push({ kind: "pageerror", message: error.message }));
    page.on("requestfailed", (request) => errors.push({ kind: "requestfailed", path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push({ kind: "http", path: new URL(response.url()).pathname, status: response.status() });
    });
    testInfo.browserErrors = errors;
  });

  test.afterEach(async ({}, testInfo) => {
    await mkdir(screenshotDir, { recursive: true });
    await writeFile(path.join(screenshotDir, `diagnostics-${testInfo.testId.replace(/[^a-zA-Z0-9-]/g, "-")}.json`), JSON.stringify(sanitizeEvidence(testInfo.browserErrors), null, 2));
  });

  test("renders the Admin entry journey", async ({ page }) => {
    await visitVisibleRoute(page, "/", "01-admin-entry", /service lasso|services|dashboard/i);
  });

  test("renders the services journey", async ({ page }) => {
    await visitVisibleRoute(page, "/services", "02-services", /service|echo/i);
  });

  test("renders the Echo detail journey", async ({ page }) => {
    await visitVisibleRoute(page, "/services/echo-service", "03-echo-detail", /echo/i);
  });
});
