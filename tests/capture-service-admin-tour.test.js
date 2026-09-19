import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  DASHBOARD_PUBLIC_CAPTURE_POLICY_ID,
  DEFAULT_SERVICE_ADMIN_URL,
  PASSWORD_FIELD_MASK_SELECTOR,
  READ_ONLY_AUDIT_ROUTES,
  TOUR_VIEWPORT,
  TourCaptureError,
  assertSafeRenderedText,
  buildRouteUrl,
  dashboardPublicPolicyIsActive,
  isLoopbackUrl,
  normalizeCaptureOptions,
  passwordFieldMaskOptions,
  parseCaptureArguments,
  safeFailureCode,
  selectedCaptureRoutes,
  selectedDocsPromotionRoutes,
  selectedAuditRoutes,
} from "../scripts/capture-service-admin-tour.mjs";

test("capture playbook defaults to the local Service Admin URL and unique review output", () => {
  const options = parseCaptureArguments([], { now: new Date("2026-09-18T00:00:00.000Z") });
  assert.equal(options.baseUrl, DEFAULT_SERVICE_ADMIN_URL);
  assert.equal(options.colorScheme, "dark");
  assert.equal(options.outputDir, path.join(".tmp", "service-admin-tour", "2026-09-18T00-00-00-000Z"));
});

test("capture playbook uses Playwright masking for password controls", () => {
  assert.match(PASSWORD_FIELD_MASK_SELECTOR, /input\[type="password"\]/);
  assert.match(PASSWORD_FIELD_MASK_SELECTOR, /autocomplete="current-password"/);
  assert.match(PASSWORD_FIELD_MASK_SELECTOR, /autocomplete="new-password"/);
  const locator = {};
  const options = passwordFieldMaskOptions({ locator: (selector) => {
    assert.equal(selector, PASSWORD_FIELD_MASK_SELECTOR);
    return locator;
  } });
  assert.deepEqual(options, { mask: [locator], maskColor: "#111827" });
});

test("capture playbook only accepts HTTP(S) roots without embedded credentials", () => {
  const valid = normalizeCaptureOptions({
    baseUrl: "http://127.0.0.1:17700/ignored-path",
    colorScheme: "dark",
    headed: false,
    outputDir: ".tmp/review",
  });
  assert.equal(valid.baseUrl, "http://127.0.0.1:17700/");
  assert.throws(
    () => normalizeCaptureOptions({ ...valid, baseUrl: "http://user:password@127.0.0.1:17700/" }),
    (error) => error instanceof TourCaptureError && error.code === "unsafe_url",
  );
});

test("capture playbook accepts only the named Dashboard public-capture policy", () => {
  const options = normalizeCaptureOptions({
    baseUrl: DEFAULT_SERVICE_ADMIN_URL,
    colorScheme: "dark",
    headed: false,
    outputDir: ".tmp/review",
    dashboardPublicPolicy: DASHBOARD_PUBLIC_CAPTURE_POLICY_ID,
  });
  assert.equal(dashboardPublicPolicyIsActive(options), true);
  assert.throws(
    () => normalizeCaptureOptions({ ...options, dashboardPublicPolicy: "permissive-dashboard-policy" }),
    (error) => error instanceof TourCaptureError && error.code === "unknown_dashboard_public_policy",
  );
});

test("capture playbook rejects direct writes into public documentation assets", () => {
  assert.throws(
    () => normalizeCaptureOptions({
      baseUrl: DEFAULT_SERVICE_ADMIN_URL,
      colorScheme: "dark",
      headed: false,
      outputDir: path.join("docs", "static", "img", "service-admin"),
    }),
    (error) => error instanceof TourCaptureError && error.code === "docs_assets_require_manual_review",
  );
});

test("capture playbook keeps route resolution rooted at the selected Service Admin instance", () => {
  assert.equal(buildRouteUrl("http://127.0.0.1:17700/", "/services/%40archive"), "http://127.0.0.1:17700/services/%40archive");
  assert.equal(isLoopbackUrl("http://127.0.0.1:17700/"), true);
  assert.equal(isLoopbackUrl("https://service-admin.example.test/"), false);
  assert.deepEqual(TOUR_VIEWPORT, { width: 1512, height: 982 });
});

test("capture playbook audits every static authenticated destination without adding synthetic reveal routes", () => {
  assert.equal(READ_ONLY_AUDIT_ROUTES.length, 40);
  assert.ok(READ_ONLY_AUDIT_ROUTES.includes("/operations/audit-logging"));
  assert.ok(READ_ONLY_AUDIT_ROUTES.includes("/secrets-broker/secrets"));
  assert.ok(READ_ONLY_AUDIT_ROUTES.includes("/settings/notifications"));
  assert.equal(READ_ONLY_AUDIT_ROUTES.some((route) => route.includes("$connectionId")), false);
});

test("capture playbook supports bounded audit batches without weakening the route inventory", () => {
  const options = parseCaptureArguments(["--audit-only", "--audit-start=10", "--audit-limit=5"]);
  assert.equal(options.capture, false);
  assert.deepEqual(selectedAuditRoutes(options), READ_ONLY_AUDIT_ROUTES.slice(10, 15));
});

test("capture playbook can bound safe screenshots to one reviewed route", () => {
  const options = parseCaptureArguments(["--skip-audit", "--capture-start=2", "--capture-limit=1"]);
  assert.deepEqual(selectedCaptureRoutes(options).map((route) => route.id), ["archive-overview"]);
});

test("capture playbook writes only approved tour captures into public docs", () => {
  const options = parseCaptureArguments(["--skip-audit"]);
  assert.equal(options.promoteToDocs, true);
  assert.deepEqual(
    selectedDocsPromotionRoutes(options).map((route) => route.id),
    ["services", "archive-overview", "help-center"],
  );
});

test("capture playbook cannot promote Dashboard until the named redaction policy is active", () => {
  const reviewOnly = parseCaptureArguments(["--skip-audit", "--capture-limit=1"]);
  assert.deepEqual(selectedDocsPromotionRoutes(reviewOnly).map((route) => route.id), []);

  const policyActive = parseCaptureArguments([
    "--skip-audit",
    "--capture-limit=1",
    `--dashboard-public-policy=${DASHBOARD_PUBLIC_CAPTURE_POLICY_ID}`,
  ]);
  assert.equal(dashboardPublicPolicyIsActive(policyActive), true);
  assert.deepEqual(selectedDocsPromotionRoutes(policyActive).map((route) => route.id), ["dashboard"]);
});

test("capture playbook keeps the Services screenshot bounded to a closed column menu", () => {
  const services = selectedCaptureRoutes(parseCaptureArguments([])).find((route) => route.id === "services");
  assert.equal(services.prepare, "hide-links-column");
});

test("capture playbook rejects first-run credential and unavailable screens before screenshots", () => {
  for (const text of [
    "Save your local-operator token",
    "Lasso-local password",
    "Service Admin is unavailable",
  ]) {
    assert.throws(
      () => assertSafeRenderedText(text),
      (error) => error instanceof TourCaptureError,
    );
  }
});

test("capture playbook exposes only stable failure codes", () => {
  assert.equal(safeFailureCode(new TourCaptureError("loading_skeleton")), "loading_skeleton");
  assert.equal(safeFailureCode(new Error("potentially sensitive browser failure")), "capture_failed");
});
