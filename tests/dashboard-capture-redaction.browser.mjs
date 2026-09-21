import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { applyDashboardPublicRedaction } from "../scripts/capture-service-admin-tour.mjs";

test("Dashboard policy survives live text updates and replaced subtrees before paint", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><h1>Dashboard</h1><h2>Runtime health</h2><p id="value">initial-private-value</p><div id="live"></div></main>');
    await applyDashboardPublicRedaction(page);
    await page.evaluate(async () => {
      document.querySelector('#value').firstChild.data = 'late-private-value';
      document.querySelector('#live').innerHTML = '<span>inserted-private-value</span>';
      document.querySelector('h2').textContent = 'changed-allowlisted-value';
      await new Promise(requestAnimationFrame);
    });
    assert.equal(await page.locator('h1').innerText(), 'Dashboard');
    assert.doesNotMatch(await page.locator('main').innerText(), /private-value|changed-allowlisted-value/);
    await page.evaluate(async () => {
      document.querySelector('main').outerHTML = '<main><p>replacement-private-value</p></main>';
      await new Promise(requestAnimationFrame);
    });
    assert.equal(await page.locator('main').innerText(), '[REDACTED]');
    await page.evaluate(() => {
      window.__serviceLassoDashboardCaptureObserver.disconnect();
      document.querySelector('main').textContent = 'Other route';
    });
    assert.equal(await page.locator('main').innerText(), 'Other route');
  } finally {
    await browser.close();
  }
});
