import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { runCommand, runNpmCommand } from "./release-artifact-lib.mjs";
import {
  buildPackageSpec,
  buildScopedRegistryConfig,
  classifyPackageAccessFailure,
  DEFAULT_REGISTRY,
  getMissingTokenSummary,
} from "./verify-package-consumer-lib.mjs";

function parseArgs(argv) {
  let version = process.env.SERVICE_LASSO_VERIFY_PACKAGE_VERSION?.trim() || "";
  let registry = process.env.SERVICE_LASSO_VERIFY_PACKAGE_REGISTRY?.trim() || DEFAULT_REGISTRY;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--version") {
      version = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (value === "--registry") {
      registry = argv[index + 1] ?? registry;
      index += 1;
      continue;
    }
  }

  return {
    version: version.trim(),
    registry: registry.trim() || DEFAULT_REGISTRY,
  };
}

const { version, registry } = parseArgs(process.argv.slice(2));
const token = process.env.NODE_AUTH_TOKEN?.trim() ?? "";

if (!token) {
  console.error("[service-lasso] package consumer verification is blocked: NODE_AUTH_TOKEN is missing.");
  console.log(JSON.stringify(getMissingTokenSummary()));
  process.exit(2);
}

const packageSpec = buildPackageSpec(version);
const consumerRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-package-registry-consumer-"));
const npmEnv = {
  ...process.env,
  NODE_AUTH_TOKEN: token,
};

try {
  await writeFile(
    path.join(consumerRoot, "package.json"),
    JSON.stringify({ name: "service-lasso-registry-consumer", private: true, type: "module" }, null, 2) + "\n",
    "utf8",
  );

  await writeFile(path.join(consumerRoot, ".npmrc"), buildScopedRegistryConfig(registry), "utf8");

  const npmView = await runNpmCommand(["view", packageSpec, "version"], {
    cwd: consumerRoot,
    env: npmEnv,
  });
  const resolvedVersion = npmView.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  await runNpmCommand(["install", packageSpec], {
    cwd: consumerRoot,
    env: npmEnv,
  });

  const cliPath = path.join(consumerRoot, "node_modules", "@service-lasso", "service-lasso", "cli.js");
  const cliVersion = await runCommand(process.execPath, [cliPath, "--version"], {
    cwd: consumerRoot,
    env: npmEnv,
  });
  const cliHelp = await runCommand(process.execPath, [cliPath, "help"], {
    cwd: consumerRoot,
    env: npmEnv,
  });

  const helpText = cliHelp.stdout.trim();
  if (!helpText.includes("service-lasso")) {
    throw new Error("Installed CLI help output did not contain the expected service-lasso usage text.");
  }

  const summary = {
    ok: true,
    classification: "verified",
    registry,
    packageSpec,
    resolvedVersion: resolvedVersion ?? null,
    cliVersion: cliVersion.stdout.trim(),
    helpPreview: helpText.split(/\r?\n/).slice(0, 3),
  };

  console.log(JSON.stringify(summary));
} catch (error) {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  const failure = classifyPackageAccessFailure(detail);
  const detailPreview = detail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  console.error(`[service-lasso] package consumer verification failed: ${failure.message}`);
  console.error(`[service-lasso] failure detail: ${detailPreview.join(" | ")}`);
  console.log(
    JSON.stringify({
      ok: false,
      classification: "blocked",
      registry,
      packageSpec,
      detailPreview,
      ...failure,
    }),
  );
  process.exit(1);
} finally {
  await rm(consumerRoot, { recursive: true, force: true });
}
