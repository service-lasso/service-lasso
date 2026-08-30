import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = [
  "runtime/execution/windows-managed-launcher-native.exe",
  "runtime/execution/windows-managed-launcher-native.provenance.json",
  "runtime/process/windows-process-inspector.exe",
  "runtime/process/windows-process-inspector.provenance.json",
  "runtime/security/windows-dpapi-helper.exe",
  "runtime/security/windows-dpapi-helper.provenance.json",
];
const retiredAssets = [
  "runtime/execution/windows-managed-launcher.ps1",
];

for (const relativePath of retiredAssets) {
  await rm(path.join(repoRoot, "dist", relativePath), { force: true });
}

for (const relativePath of assets) {
  const source = path.join(repoRoot, "src", relativePath);
  const destination = path.join(repoRoot, "dist", relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
