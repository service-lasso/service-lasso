import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

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
