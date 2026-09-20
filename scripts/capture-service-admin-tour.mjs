/**
 * Read-only, live Service Admin tour capture for docs review.
 *
 * This deliberately does not authenticate, reveal data, invoke lifecycle actions,
 * or write into docs/static. It captures only the four reviewed visitor-facing
 * routes after rejecting known setup, error, and skeleton states.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const TOUR_VIEWPORT = Object.freeze({ width: 1512, height: 982 });
export const DEFAULT_SERVICE_ADMIN_URL = "http://127.0.0.1:17700/";
export const DEFAULT_COLOR_SCHEME = "dark";
// A cold packaged Admin route can initialize its MCP discovery view after the
// initial document paint. Keep the complete static audit fail-closed, but give
// that documented read-only route one bounded, user-visible render budget.
export const ROUTE_RENDER_TIMEOUT_MS = 30_000;
export const DASHBOARD_PUBLIC_CAPTURE_POLICY_ID = "dashboard-public-safe-v1";
export const DASHBOARD_PUBLIC_CAPTURE_POLICY = Object.freeze({
  id: DASHBOARD_PUBLIC_CAPTURE_POLICY_ID,
  // These labels describe the surface without exposing a runtime-specific
  // value. Every other Dashboard text node is made unreadable in the public
  // frame, including health/count/allocation/generation values and alerts.
  publicSafeLabels: Object.freeze(["Dashboard", "Runtime health"]),
  redaction: "mask-all-dashboard-text-except-allowlisted-static-labels",
});
// Playwright applies this mask immediately before it writes a PNG. Keep the
// selector limited to password controls: it is a safety net for credentials,
// not a substitute for reviewing other sensitive UI data.
export const PASSWORD_FIELD_MASK_SELECTOR = [
  "input[type=\"password\"]",
  "input[autocomplete=\"current-password\"]",
  "input[autocomplete=\"new-password\"]",
  "textarea[autocomplete=\"current-password\"]",
  "textarea[autocomplete=\"new-password\"]",
].join(", ");
export const TOUR_ROUTES = Object.freeze([
  {
    id: "dashboard",
    pathname: "/",
    heading: "Dashboard",
    requiredText: "Runtime health",
    publicPromotionPolicy: DASHBOARD_PUBLIC_CAPTURE_POLICY_ID,
  },
  {
    id: "services",
    pathname: "/services",
    heading: "Services",
    requiredPlaceholder: "Search services and open details from the matching row...",
    prepare: "hide-links-column",
    promoteToDocs: true,
  },
  {
    id: "archive-overview",
    pathname: "/services/%40archive",
    heading: "Archive Utility Provider",
    promoteToDocs: true,
  },
  {
    id: "help-center",
    pathname: "/help-center",
    heading: "Help Center",
    requiredText: "Help docs loaded from the local docs set.",
    promoteToDocs: true,
  },
]);

// Static, read-only destinations from the current authenticated Admin route tree.
// Dynamic record pages and controls that reveal or mutate data are intentionally
// not synthesised here: the suite never invents a record identifier or performs
// an operator action merely to make a navigation test pass.
export const READ_ONLY_AUDIT_ROUTES = Object.freeze([
  "/",
  "/services",
  "/services/%40archive",
  "/dependencies",
  "/service-routes",
  "/logs",
  "/runtime",
  "/mcp",
  "/installed",
  "/variables",
  "/network",
  "/security",
  "/inbox",
  "/operations/telemetry",
  "/operations/audit-logging",
  "/secrets-broker",
  "/secrets-broker/secrets",
  "/secrets-broker/sources",
  "/secrets-broker/topology",
  "/secrets-broker/review",
  "/secrets-broker/backup-keys",
  "/secrets-broker/configuration",
  "/secrets-broker/audit-events",
  "/secrets-broker/diagnostics",
  "/secrets-broker/operational-controls",
  "/secrets-broker/provider-connections",
  "/secrets-broker/secret-inventory",
  "/secrets-broker/single-reveal",
  "/secrets-broker/workflow-boundaries",
  "/secrets-broker/policy-simulation",
  "/settings",
  "/settings/appearance",
  "/settings/display",
  "/settings/account",
  "/settings/notifications",
  "/help-center",
  "/apps",
  "/chats",
  "/tasks",
  "/users",
]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const docsStaticRoot = path.resolve(repoRoot, "docs", "static");
const docsTourAssetDirectory = path.join(docsStaticRoot, "img", "service-admin-tour");

const forbiddenScreens = Object.freeze([
  { code: "first_run_setup", pattern: /save your local-operator token/i },
  { code: "first_run_setup", pattern: /local-admin token/i },
  { code: "first_run_setup", pattern: /lasso-local password/i },
  { code: "first_run_setup", pattern: /continue after saving/i },
  { code: "authentication_required", pattern: /sign in to continue/i },
  { code: "runtime_unavailable", pattern: /service admin is unavailable/i },
  { code: "runtime_unavailable", pattern: /unexpected application error/i },
]);

const forbiddenScreenLabels = Object.freeze([
  { code: "first_run_setup", text: "Save your local-operator token" },
  { code: "first_run_setup", text: "Local-admin token" },
  { code: "first_run_setup", text: "Lasso-local password" },
  { code: "first_run_setup", text: "Continue after saving" },
  { code: "authentication_required", text: "Sign in to continue" },
  { code: "runtime_unavailable", text: "Service Admin is unavailable" },
  { code: "runtime_unavailable", text: "Unexpected application error" },
]);

export class TourCaptureError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function timestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function requireArgumentValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new TourCaptureError(`missing_${option}`);
  }
  return value;
}

export function parseCaptureArguments(args, { now = new Date() } = {}) {
  const options = {
    baseUrl: DEFAULT_SERVICE_ADMIN_URL,
    colorScheme: DEFAULT_COLOR_SCHEME,
    headed: false,
    capture: true,
    captureStart: 0,
    captureLimit: null,
    auditStart: 0,
    auditLimit: null,
    dashboardPublicPolicy: null,
    promoteToDocs: true,
    outputDir: path.join(".tmp", "service-admin-tour", timestamp(now)),
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--headed") {
      options.headed = true;
      continue;
    }
    if (argument === "--audit-only") {
      options.capture = false;
      continue;
    }
    if (argument === "--no-promote") {
      options.promoteToDocs = false;
      continue;
    }
    if (argument === "--skip-audit") {
      options.auditLimit = 0;
      continue;
    }
    if (argument === "--url" || argument === "--output-dir" || argument === "--color-scheme" || argument === "--audit-start" || argument === "--audit-limit" || argument === "--capture-start" || argument === "--capture-limit" || argument === "--dashboard-public-policy") {
      const value = requireArgumentValue(args, index, argument.slice(2));
      index += 1;
      if (argument === "--url") options.baseUrl = value;
      if (argument === "--output-dir") options.outputDir = value;
      if (argument === "--color-scheme") options.colorScheme = value;
      if (argument === "--audit-start") options.auditStart = Number(value);
      if (argument === "--audit-limit") options.auditLimit = Number(value);
      if (argument === "--capture-start") options.captureStart = Number(value);
      if (argument === "--capture-limit") options.captureLimit = Number(value);
      if (argument === "--dashboard-public-policy") options.dashboardPublicPolicy = value;
      continue;
    }
    if (argument.startsWith("--url=")) {
      options.baseUrl = argument.slice("--url=".length);
      continue;
    }
    if (argument.startsWith("--output-dir=")) {
      options.outputDir = argument.slice("--output-dir=".length);
      continue;
    }
    if (argument.startsWith("--color-scheme=")) {
      options.colorScheme = argument.slice("--color-scheme=".length);
      continue;
    }
    if (argument.startsWith("--audit-start=")) {
      options.auditStart = Number(argument.slice("--audit-start=".length));
      continue;
    }
    if (argument.startsWith("--audit-limit=")) {
      options.auditLimit = Number(argument.slice("--audit-limit=".length));
      continue;
    }
    if (argument.startsWith("--capture-start=")) {
      options.captureStart = Number(argument.slice("--capture-start=".length));
      continue;
    }
    if (argument.startsWith("--capture-limit=")) {
      options.captureLimit = Number(argument.slice("--capture-limit=".length));
      continue;
    }
    if (argument.startsWith("--dashboard-public-policy=")) {
      options.dashboardPublicPolicy = argument.slice("--dashboard-public-policy=".length);
      continue;
    }
    throw new TourCaptureError("unknown_argument");
  }

  return options;
}

export function normalizeCaptureOptions(options) {
  const auditStart = options.auditStart ?? 0;
  const auditLimit = options.auditLimit ?? null;
  const captureStart = options.captureStart ?? 0;
  const captureLimit = options.captureLimit ?? null;
  const dashboardPublicPolicy = options.dashboardPublicPolicy ?? null;
  let parsedUrl;
  try {
    parsedUrl = new URL(options.baseUrl);
  } catch {
    throw new TourCaptureError("invalid_url");
  }

  if (!/^https?:$/.test(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new TourCaptureError("unsafe_url");
  }
  if (!["dark", "light"].includes(options.colorScheme)) {
    throw new TourCaptureError("invalid_color_scheme");
  }
  if (!Number.isInteger(auditStart) || auditStart < 0) {
    throw new TourCaptureError("invalid_audit_start");
  }
  if (auditLimit !== null && (!Number.isInteger(auditLimit) || auditLimit < 0)) {
    throw new TourCaptureError("invalid_audit_limit");
  }
  if (!Number.isInteger(captureStart) || captureStart < 0) {
    throw new TourCaptureError("invalid_capture_start");
  }
  if (captureLimit !== null && (!Number.isInteger(captureLimit) || captureLimit < 0)) {
    throw new TourCaptureError("invalid_capture_limit");
  }
  if (dashboardPublicPolicy !== null && dashboardPublicPolicy !== DASHBOARD_PUBLIC_CAPTURE_POLICY_ID) {
    throw new TourCaptureError("unknown_dashboard_public_policy");
  }

  const outputDir = path.resolve(repoRoot, options.outputDir);
  const docsStaticPrefix = `${docsStaticRoot}${path.sep}`;
  if (outputDir === docsStaticRoot || outputDir.startsWith(docsStaticPrefix)) {
    throw new TourCaptureError("docs_assets_require_manual_review");
  }

  return {
    ...options,
    auditStart,
    auditLimit,
    captureStart,
    captureLimit,
    dashboardPublicPolicy,
    baseUrl: new URL("/", parsedUrl).toString(),
    outputDir,
  };
}

export function selectedAuditRoutes(options) {
  const end = options.auditLimit === null
    ? undefined
    : options.auditStart + options.auditLimit;
  return READ_ONLY_AUDIT_ROUTES.slice(options.auditStart, end);
}

export function selectedCaptureRoutes(options) {
  const start = options.captureStart ?? 0;
  const limit = options.captureLimit ?? null;
  return TOUR_ROUTES.slice(start, limit === null ? undefined : start + limit);
}

export function selectedDocsPromotionRoutes(options) {
  return selectedCaptureRoutes(options).filter((route) => (
    route.promoteToDocs === true
    || route.publicPromotionPolicy === options.dashboardPublicPolicy
  ));
}

export function buildRouteUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl).toString();
}

export function isLoopbackUrl(baseUrl) {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function safeFailureCode(error) {
  return error instanceof TourCaptureError ? error.code : "capture_failed";
}

export function passwordFieldMaskOptions(page) {
  return {
    mask: [page.locator(PASSWORD_FIELD_MASK_SELECTOR)],
    maskColor: "#111827",
  };
}

export function dashboardPublicPolicyIsActive(options) {
  return options.dashboardPublicPolicy === DASHBOARD_PUBLIC_CAPTURE_POLICY_ID;
}

export async function applyDashboardPublicRedaction(page) {
  const result = await page.evaluate((policy) => {
    const root = document.querySelector("main");
    if (!root) return { applied: false, allowlistedLabelCount: 0 };

    // Mark only leaf elements whose whole visible label is in the policy.
    // This intentionally leaves values in compound label/value elements masked.
    const allowed = new Set(policy.publicSafeLabels);
    const elements = [...root.querySelectorAll("*")];
    let allowlistedLabelCount = 0;
    for (const element of elements) {
      const text = element.textContent?.replace(/\\s+/g, " ").trim();
      if (!text || !allowed.has(text)) continue;
      if ([...element.children].some((child) => child.textContent?.replace(/\\s+/g, " ").trim())) continue;
      element.setAttribute("data-dashboard-public-capture-label", "true");
      allowlistedLabelCount += 1;
    }

    // Replace every remaining visible text node instead of relying on a CSS
    // colour mask. This also covers SVG text and values that inherit a custom
    // colour, and leaves an explicit safe marker for visual review.
    const textNodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = textNodes.nextNode();
    while (node) {
      const parent = node.parentElement;
      if (!parent?.closest('[data-dashboard-public-capture-label="true"]')) {
        node.textContent = "[REDACTED]";
      }
      node = textNodes.nextNode();
    }
    // Validate text-node ownership rather than rendered lines: an allowlisted
    // label may share a line with a separately redacted value.
    const residualTextNodes = [];
    const residualWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let residualNode = residualWalker.nextNode();
    while (residualNode) {
      const value = residualNode.textContent?.replace(/\\s+/g, " ").trim();
      const parent = residualNode.parentElement;
      if (value && value !== "[REDACTED]" && !parent?.closest('[data-dashboard-public-capture-label="true"]')) {
        residualTextNodes.push(value);
      }
      residualNode = residualWalker.nextNode();
    }
    if (residualTextNodes.length > 0) return { applied: false, allowlistedLabelCount };
    return { applied: true, allowlistedLabelCount };
  }, DASHBOARD_PUBLIC_CAPTURE_POLICY);

  if (!result.applied || result.allowlistedLabelCount < DASHBOARD_PUBLIC_CAPTURE_POLICY.publicSafeLabels.length) {
    throw new TourCaptureError("dashboard_public_redaction_not_applied");
  }
  return result;
}

export function assertSafeRenderedText(text) {
  for (const forbidden of forbiddenScreens) {
    if (forbidden.pattern.test(text)) {
      throw new TourCaptureError(forbidden.code);
    }
  }
}

async function assertSafeRenderedPage(page) {
  for (const forbidden of forbiddenScreenLabels) {
    if (await page.getByText(forbidden.text, { exact: false }).count()) {
      throw new TourCaptureError(forbidden.code);
    }
  }
}

export async function assertPngViewport(filePath) {
  const bytes = await readFile(filePath);
  const isPng = bytes.length >= 24 && bytes.subarray(1, 4).toString("ascii") === "PNG";
  if (!isPng) throw new TourCaptureError("invalid_screenshot_format");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== TOUR_VIEWPORT.width || height !== TOUR_VIEWPORT.height) {
    throw new TourCaptureError("incorrect_screenshot_viewport");
  }
}

async function hideServicesLinksColumn(page) {
  const view = page.getByRole("button", { name: "View", exact: true });
  await view.waitFor({ state: "visible", timeout: 15_000 });
  await view.click();

  const linksToggle = page.getByRole("menuitemcheckbox", { name: "links", exact: true });
  await linksToggle.waitFor({ state: "visible", timeout: 15_000 });
  if ((await linksToggle.getAttribute("aria-checked")) === "true") {
    await linksToggle.click();
  }
  if ((await linksToggle.getAttribute("aria-checked")) !== "false") {
    throw new TourCaptureError("services_links_column_still_visible");
  }
  // The current Admin menu is portalled. Its trigger can retain focus after
  // the first Escape, so dismiss it from the keyboard and then from a neutral
  // page target before declaring the frame safe to capture.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  if (await linksToggle.isVisible().catch(() => false)) await view.click();
  if (await linksToggle.isVisible().catch(() => false)) {
    await page.getByRole("heading", { name: "Services", exact: true }).click();
  }
  if (await linksToggle.isVisible().catch(() => false)) {
    throw new TourCaptureError("services_column_menu_still_visible");
  }
  if (await page.locator("table a[target='_blank']").count()) {
    throw new TourCaptureError("services_links_column_still_visible");
  }
}

async function establishLoopbackLocalRootSession(page, baseUrl) {
  await page.goto(buildRouteUrl(baseUrl, "/"), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const localRoot = page.getByRole("button", { name: "Continue as local-root", exact: true });
  const dashboard = page.getByRole("heading", { name: "Dashboard", exact: true });
  const initialState = await Promise.race([
    localRoot.waitFor({ state: "visible", timeout: 10_000 }).then(() => "local-root"),
    dashboard.waitFor({ state: "visible", timeout: 10_000 }).then(() => "dashboard"),
  ]).catch(() => "unknown");

  if (initialState === "dashboard") return;
  if (initialState !== "local-root") {
    // Classify a first-run or unavailable screen before reporting a generic
    // readiness failure. This preserves the no-screenshot boundary while
    // giving the proof workflow an actionable, metadata-only failure code.
    await assertSafeRenderedPage(page);
    throw new TourCaptureError("initial_route_not_ready");
  }
  if (!isLoopbackUrl(baseUrl)) throw new TourCaptureError("authentication_required");

  // Loopback local-root is a local role selection, not a credential entry. It
  // permits a fresh ephemeral browser context to exercise the user's local
  // instance without reading, storing, or transmitting any secret.
  await localRoot.click();
  await dashboard.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText("Runtime health", { exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function visitReadOnlyRoute(page, baseUrl, route) {
  const requestedRoute = typeof route === "string" ? route : route.pathname;
  try {
    const response = await page.goto(buildRouteUrl(baseUrl, requestedRoute), {
      waitUntil: "domcontentloaded",
      timeout: ROUTE_RENDER_TIMEOUT_MS,
    });
    if (!response || !response.ok()) throw new TourCaptureError("route_unreachable");

    await page.getByRole("main").waitFor({ state: "visible", timeout: ROUTE_RENDER_TIMEOUT_MS });
    // Not every current Admin destination has a document heading: for example,
    // the log viewer and Service Routes table use labelled cards. The shared
    // invariant is a visible main region with no query skeleton or blocked
    // setup/error state. Capture routes add their own reviewed heading/text
    // requirements below before a PNG can be written.
    await page.waitForTimeout(500);
    await page.locator('[data-slot="skeleton"]').first().waitFor({
      state: "hidden",
      timeout: ROUTE_RENDER_TIMEOUT_MS,
    });
    await assertSafeRenderedPage(page);
    return { requestedRoute, resolvedRoute: new URL(page.url()).pathname };
  } catch (error) {
    if (error instanceof TourCaptureError) throw error;
    throw new TourCaptureError("route_not_rendered");
  }
}

async function waitForCaptureRoute(page, baseUrl, route) {
  await visitReadOnlyRoute(page, baseUrl, route);
  await page.getByRole("heading", { name: route.heading, exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  if (route.requiredText) {
    await page.getByText(route.requiredText, { exact: true }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
  }
  if (route.requiredPlaceholder) {
    await page.getByPlaceholder(route.requiredPlaceholder, { exact: true }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
  }
  if (route.prepare === "hide-links-column") await hideServicesLinksColumn(page);
}

async function writeReceipt(outputDir, result) {
  await writeFile(path.join(outputDir, "capture-receipt.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function promoteCapturedImages(capture, receipt) {
  const routes = selectedDocsPromotionRoutes(capture);
  if (routes.length === 0) return;
  await mkdir(docsTourAssetDirectory, { recursive: true });
  for (const route of routes) {
    if (route.publicPromotionPolicy && (
      receipt.dashboardPublicRedaction?.policy !== route.publicPromotionPolicy
      || receipt.dashboardPublicRedaction?.active !== true
    )) {
      throw new TourCaptureError("dashboard_policy_not_active");
    }
    const imageName = `${route.id}.png`;
    await copyFile(
      path.join(capture.outputDir, imageName),
      path.join(docsTourAssetDirectory, imageName),
    );
    receipt.promotedAssets.push({
      id: route.id,
      source: imageName,
      target: path.posix.join("docs", "static", "img", "service-admin-tour", imageName),
    });
  }
}

export async function runServiceAdminTour(options, { chromium } = {}) {
  const capture = normalizeCaptureOptions(options);
  await mkdir(capture.outputDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const receipt = {
    schema: "service-lasso.service-admin-tour-capture.v1",
    startedAt,
    baseUrl: capture.baseUrl,
    viewport: TOUR_VIEWPORT,
    colorScheme: capture.colorScheme,
    auditScope: {
      start: capture.auditStart,
      count: selectedAuditRoutes(capture).length,
      total: READ_ONLY_AUDIT_ROUTES.length,
    },
    captureScope: {
      start: capture.captureStart,
      count: capture.capture ? selectedCaptureRoutes(capture).length : 0,
      total: TOUR_ROUTES.length,
    },
    passwordFieldMasking: "playwright-native-password-controls",
    dashboardPublicRedaction: {
      policy: capture.dashboardPublicPolicy,
      active: false,
      method: capture.dashboardPublicPolicy === null ? "review-only" : DASHBOARD_PUBLIC_CAPTURE_POLICY.redaction,
      allowlistedLabels: [...DASHBOARD_PUBLIC_CAPTURE_POLICY.publicSafeLabels],
    },
    promotion: "approved-tour-routes",
    promotedAssets: [],
    auditedRoutes: [],
    auditFailures: [],
    captures: [],
  };

  let browser;
  try {
    const runtime = chromium ? { chromium } : await import("@playwright/test");
    browser = await runtime.chromium.launch({ headless: !capture.headed });
    const context = await browser.newContext({
      viewport: TOUR_VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: capture.colorScheme,
      baseURL: capture.baseUrl,
    });
    const page = await context.newPage();
    await establishLoopbackLocalRootSession(page, capture.baseUrl);

    for (const route of selectedAuditRoutes(capture)) {
      receipt.inFlightRoute = route;
      await writeReceipt(capture.outputDir, receipt);
      try {
        receipt.auditedRoutes.push(await visitReadOnlyRoute(page, capture.baseUrl, route));
      } catch (error) {
        receipt.auditFailures.push({
          requestedRoute: route,
          failureCode: safeFailureCode(error),
        });
      }
      delete receipt.inFlightRoute;
      await writeReceipt(capture.outputDir, receipt);
    }

    if (receipt.auditFailures.length > 0) {
      throw new TourCaptureError("route_audit_failed");
    }

    if (capture.capture) {
      for (const route of selectedCaptureRoutes(capture)) {
        receipt.inFlightRoute = route.pathname;
        await writeReceipt(capture.outputDir, receipt);
        await waitForCaptureRoute(page, capture.baseUrl, route);
        if (route.publicPromotionPolicy && dashboardPublicPolicyIsActive(capture)) {
          const redaction = await applyDashboardPublicRedaction(page);
          receipt.dashboardPublicRedaction = {
            policy: route.publicPromotionPolicy,
            active: true,
            method: DASHBOARD_PUBLIC_CAPTURE_POLICY.redaction,
            allowlistedLabels: [...DASHBOARD_PUBLIC_CAPTURE_POLICY.publicSafeLabels],
            allowlistedLabelCount: redaction.allowlistedLabelCount,
          };
        }
        // Let the route-specific control update and its final paint settle
        // before freezing a documentation frame.
        await page.waitForTimeout(500);
        const imageName = `${route.id}.png`;
        const imagePath = path.join(capture.outputDir, imageName);
        await page.screenshot({
          path: imagePath,
          fullPage: false,
          ...passwordFieldMaskOptions(page),
        });
        await assertPngViewport(imagePath);
        receipt.captures.push({ id: route.id, route: route.pathname, image: imageName });
        delete receipt.inFlightRoute;
        await writeReceipt(capture.outputDir, receipt);
      }
      await promoteCapturedImages(capture, receipt);
    }
    receipt.ok = true;
    receipt.finishedAt = new Date().toISOString();
    await writeReceipt(capture.outputDir, receipt);
    return { ...receipt, outputDir: capture.outputDir };
  } catch (error) {
    receipt.ok = false;
    receipt.failureCode = safeFailureCode(error);
    receipt.finishedAt = new Date().toISOString();
    await writeReceipt(capture.outputDir, receipt);
    throw new TourCaptureError(receipt.failureCode);
  } finally {
    await browser?.close();
  }
}

export const help = `Capture the reviewed Service Admin documentation tour.

Usage:
  npm run capture:service-admin-tour -- --url=http://127.0.0.1:17700/

Options:
  --url <http(s) URL>          Service Admin root (default: ${DEFAULT_SERVICE_ADMIN_URL})
  --output-dir <path>          Ignored review directory (default: .tmp/service-admin-tour/<timestamp>)
  --color-scheme <dark|light>  Deterministic browser preference (default: dark)
  --headed                     Show the isolated Playwright browser
  --audit-only                 Audit the selected destinations without screenshots
  --skip-audit                 Capture the four reviewed routes without an audit pass
  --capture-start <number>     Start a bounded capture batch at this route index
  --capture-limit <number>     Capture no more than this many reviewed routes
  --audit-start <number>       Start a bounded audit batch at this route index
  --audit-limit <number>       Audit no more than this many routes
  --dashboard-public-policy <id>
                                Apply the named Dashboard redaction policy

On a loopback URL it can select the local-root role in its fresh browser context.
It refuses setup, authentication-required, unavailable, and skeleton states.
It masks password controls before each PNG and does not enter credentials,
reveal values, or call lifecycle actions. After the selected audit and all
selected captures pass, it copies approved route captures into docs/static.
Dashboard remains review-only unless ${DASHBOARD_PUBLIC_CAPTURE_POLICY_ID} is
selected. That policy replaces Dashboard text with [REDACTED] except the
allowlisted static labels before the PNG is written; it still requires visual
review.
`;

async function main() {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(help);
    return;
  }
  const result = await runServiceAdminTour(parseCaptureArguments(process.argv.slice(2)));
  process.stdout.write(`Audited ${result.auditedRoutes.length} destinations and captured ${result.captures.length} reviewed routes in ${result.outputDir}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Service Admin tour capture failed: ${safeFailureCode(error)}\n`);
    process.exitCode = 1;
  });
}
