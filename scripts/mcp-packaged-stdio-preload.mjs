import path from "node:path";
import { pathToFileURL } from "node:url";

const installedRoot = process.env.SERVICE_LASSO_MCP_ACCEPTANCE_INSTALLED_ROOT?.trim();
delete process.env.SERVICE_LASSO_MCP_ACCEPTANCE_INSTALLED_ROOT;
if (!installedRoot) {
  throw new Error("Packaged stdio identity preflight requires the installed package root.");
}

const consumerModulesRoot = path.join(process.cwd(), "node_modules");
const relativeInstalledRoot = path.relative(consumerModulesRoot, installedRoot);
if (
  !relativeInstalledRoot ||
  relativeInstalledRoot.startsWith("..") ||
  path.isAbsolute(relativeInstalledRoot)
) {
  throw new Error("Packaged stdio identity preflight must resolve from consumer node_modules.");
}

if (process.platform === "win32") {
  const identityModulePath = path.join(installedRoot, "dist", "runtime", "process", "identity.js");
  const packagedIdentity = await import(pathToFileURL(identityModulePath).href);
  if (typeof packagedIdentity.setWindowsProcessInspectionTimeoutForTests !== "function") {
    throw new Error("Packaged stdio runtime is missing its Windows inspection test bound.");
  }
  try {
    packagedIdentity.setWindowsProcessInspectionTimeoutForTests(60_000);
  } finally {
    delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  }
} else {
  delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
}
