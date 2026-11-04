import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { startApiServer } from "../dist/server/index.js";

const helper = (process.env.SERVICE_LASSO_PTY_HELPER ?? "").trim();
if (!helper) {
  throw new Error("SERVICE_LASSO_PTY_HELPER must name the pinned PTY helper.");
}
const adminRoot = (process.env.SERVICEADMIN_REPO_ROOT ?? "").trim();
if (!adminRoot) {
  throw new Error("SERVICEADMIN_REPO_ROOT must name the Service Admin checkout.");
}
const uiPort = Number(process.env.SERVICE_LASSO_TERMINAL_UI_PORT ?? 4180);
const uiBase = `http://127.0.0.1:${uiPort}`;
const evidenceRoot = await mkdtemp(
  path.join(os.tmpdir(), "service-lasso-terminal-ui-e2e-"),
);
const servicesRoot = path.join(evidenceRoot, "services");
const workspaceRoot = path.join(evidenceRoot, "workspace");
await mkdir(path.join(servicesRoot, "echo-tui"), { recursive: true });
await mkdir(workspaceRoot, { recursive: true });
process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(
  evidenceRoot,
  "instances.json",
);
process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(
  evidenceRoot,
  "ports.json",
);

const manifest = {
  id: "echo-tui",
  name: "Echo TUI",
  description: "PTY attachment sample on the published Echo Service release.",
  version: "0.1.0",
  enabled: true,
  args: ["-tui"],
  terminal: { enabled: true, rows: 30, cols: 100 },
  env: {
    ECHO_PORT: "0",
    ECHO_HTTP_HEALTH_PORT: "0",
    ECHO_TCP_PORT: "0",
    ECHO_FASTCGI_PORT: "0",
    ECHO_LOG_PATH: "${SERVICE_ROOT}/runtime/echo.log",
    ECHO_STATE_PATH: "${SERVICE_ROOT}/runtime/state.json",
    ECHO_DB_PATH: "${SERVICE_ROOT}/runtime/echo.sqlite",
  },
  artifact: {
    kind: "archive",
    source: {
      type: "github-release",
      repo: "service-lasso/lasso-echoservice",
      tag: "2026.10.28-75d046b",
    },
    platforms: {
      win32: {
        assetName: "echo-service-win32.zip",
        archiveType: "zip",
        command: ".\\echo-service.exe",
        args: ["-tui"],
      },
      linux: {
        assetName: "echo-service-linux.tar.gz",
        archiveType: "tar.gz",
        command: "./echo-service",
        args: ["-tui"],
      },
      darwin: {
        assetName: "echo-service-darwin.tar.gz",
        archiveType: "tar.gz",
        command: "./echo-service",
        args: ["-tui"],
      },
    },
  },
  healthchecks: [{ id: "process-health", type: "process" }],
};
await writeFile(
  path.join(servicesRoot, "echo-tui", "service.json"),
  JSON.stringify(manifest, null, 2),
);

const checks = [];
function record(name, pass, detail = {}) {
  checks.push({ name, pass, ...detail });
  console.log(JSON.stringify({ name, pass, ...detail }));
}

async function request(base, pathname, options = {}) {
  const response = await fetch(new URL(pathname, base), {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, ok: response.ok, payload };
}

async function lifecycle(base, action) {
  const response = await request(base, `/api/services/echo-tui/${action}`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
  const outcome = response.payload?.result ?? response.payload ?? {};
  return { status: response.status, ok: response.ok, outcome };
}

async function waitFor(name, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      record(name, true);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  record(name, false);
  return false;
}

async function serviceState(base) {
  const response = await request(base, "/api/services");
  return response.payload?.services?.find((service) => service.id === "echo-tui");
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

const previousHelper = process.env.SERVICE_LASSO_PTY_HELPER;
process.env.SERVICE_LASSO_PTY_HELPER = path.resolve(helper);
const runtime = await startApiServer({
  host: "127.0.0.1",
  port: 0,
  servicesRoot,
  workspaceRoot,
  noAutostart: true,
});
const coreBase = runtime.url;

let vite;
let browser;
let page;
let exitCode = 1;
try {
  const installed = await lifecycle(coreBase, "install");
  const configured = await lifecycle(coreBase, "config");
  const started = await lifecycle(coreBase, "start");
  record("install", installed.ok, { status: installed.status });
  record("config", configured.ok, { status: configured.status });
  record("start", started.ok, { status: started.status });
  await waitFor(
    "service-running",
    async () => (await serviceState(coreBase))?.lifecycle?.running === true,
    120_000,
  );
  const terminalState = await request(coreBase, "/api/services/echo-tui/terminal");
  record(
    "core-terminal-available",
    terminalState.ok && terminalState.payload?.available === true,
    {
      status: terminalState.status,
      available: terminalState.payload?.available,
      error: terminalState.payload?.error,
    },
  );

  const viteBin = path.join(adminRoot, "node_modules", "vite", "bin", "vite.js");
  const build = spawnSync(process.execPath, [viteBin, "build"], {
    cwd: adminRoot,
    env: {
      ...process.env,
      SERVICE_ADMIN_UI_TEST: "false",
      VITE_SERVICE_LASSO_API_BASE_URL: uiBase,
    },
    encoding: "utf8",
    windowsHide: true,
  });
  record("admin-build", build.status === 0, {
    status: build.status,
    stderrTail: (build.stderr ?? "").slice(-800),
  });
  if (build.status !== 0) {
    throw new Error("Service Admin production build failed.");
  }

  vite = spawn(
    process.execPath,
    [
      viteBin,
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(uiPort),
      "--strictPort",
    ],
    {
      cwd: adminRoot,
      env: {
        ...process.env,
        SERVICE_LASSO_RUNTIME_PROXY_TARGET: coreBase,
        SERVICE_ADMIN_UI_TEST: "false",
        VITE_SERVICE_LASSO_API_BASE_URL: uiBase,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  vite.stdout.on("data", (chunk) =>
    process.stderr.write(`[admin-vite] ${chunk}`),
  );
  vite.stderr.on("data", (chunk) =>
    process.stderr.write(`[admin-vite] ${chunk}`),
  );
  await waitFor(
    "admin-ui-ready",
    async () => {
      try {
        const response = await fetch(uiBase, {
          signal: AbortSignal.timeout(2_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    120_000,
  );

  browser = await chromium.launch();
  const context = await browser.newContext();
  page = await context.newPage();
  const pageErrors = [];
  const resizeRequests = [];
  const terminalResponses = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/services/echo-tui/terminal")) {
      terminalResponses.push({
        url: response.url(),
        status: response.status(),
      });
    }
  });
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/services/echo-tui/terminal/resize")
    ) {
      resizeRequests.push(request.url());
    }
  });

  // The packaged first-run bootstrap is covered by the Admin real-first-run
  // Cypress contract. This harness intentionally bypasses only the setup gate so
  // the terminal path can run against the real Core and a real Echo TUI.
  await page.route("**/api/setup/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        setup: {
          contractVersion: "service-lasso.setup-status.v1",
          state: "not_required",
          setupMode: false,
          vault: { required: true, ready: true },
          operator: { osUsername: "local-operator", identitySource: "vault" },
          trustBoundary: {
            bindHost: "127.0.0.1",
            localOnly: true,
            localhostBootstrapAllowed: false,
            remoteBootstrapAllowed: false,
            setupTokenConfigured: false,
            blockers: [],
          },
          auth: {
            actor: {
              authenticated: true,
              kind: "local-root",
              actorId: "local-root",
            },
            mode: "local-root",
            blockers: [],
          },
        },
      }),
    }),
  );

  await page.goto(`${uiBase}/services/echo-tui?tab=terminal`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const verified = page.getByText("Trusted identity verified");
  const localRoot = page.getByRole("button", {
    name: "Continue as local-root",
  });
  await Promise.race([
    verified.waitFor({ state: "visible", timeout: 60_000 }),
    localRoot.waitFor({ state: "visible", timeout: 60_000 }),
  ]);
  if (await localRoot.isVisible().catch(() => false)) {
    await localRoot.click();
  }
  await verified.waitFor({ state: "visible", timeout: 60_000 });

  const terminal = page.locator(".xterm");
  await terminal.waitFor({ state: "visible", timeout: 60_000 });
  const rendered = await waitFor(
    "xterm-renders-echo-tui",
    async () => (await terminal.innerText()).includes("Echo Service TUI"),
    120_000,
  );
  if (!rendered) {
    record("xterm-observed", false, {
      tail: (await terminal.innerText()).slice(-800),
      terminalResponses,
    });
  }

  await terminal.click();
  await page.keyboard.press("e");
  await waitFor(
    "xterm-forwards-tui-key",
    async () => (await terminal.innerText()).toLowerCase().includes("tui-echo"),
    60_000,
  );

  await page.setViewportSize({ width: 1200, height: 800 });
  await waitFor(
    "xterm-sends-resize",
    async () => resizeRequests.length > 0,
    30_000,
  );

  if (pageErrors.length) {
    record("browser-page-errors", false, { pageErrors });
  } else {
    record("browser-page-errors", true);
  }
} catch (error) {
  record("terminal-ui-e2e", false, {
    message: error instanceof Error ? error.message : String(error),
  });
  if (page) {
    await page
      .screenshot({ path: path.join(evidenceRoot, "failure.png"), fullPage: true })
      .catch(() => undefined);
    await writeFile(
      path.join(evidenceRoot, "failure.html"),
      await page.content().catch(() => ""),
    ).catch(() => undefined);
    const text = await page.locator("body").innerText().catch(() => "");
    record("failure-page", false, { text: text.slice(0, 2000) });
  }
} finally {
  await browser?.close().catch(() => undefined);
  stopChild(vite);
  await Promise.race([
    new Promise((resolve) => {
      if (!vite || vite.exitCode !== null || vite.signalCode !== null)
        resolve();
      else vite.once("close", resolve);
    }),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  await lifecycle(coreBase, "stop").catch(() => undefined);
  await runtime.stop().catch(() => undefined);
  await writeFile(
    path.join(evidenceRoot, "summary.json"),
    JSON.stringify({ checks, helper, adminRoot, uiBase, coreBase }, null, 2),
  );
  console.log(JSON.stringify({ checks }, null, 2));
  exitCode = checks.every((check) => check.pass) ? 0 : 1;
  if (exitCode === 0) {
    await rm(evidenceRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
  } else {
    console.log(`kept ${evidenceRoot}`);
  }
  process.env.SERVICE_LASSO_PTY_HELPER = previousHelper;
}
process.exitCode = exitCode;
