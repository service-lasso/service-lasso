import test from "node:test";
import assert from "node:assert/strict";
import { PTY_HELPER_RELEASE } from "../scripts/pty-helper-release.mjs";

test("PTY helper release pin is closed and complete", () => {
  assert.equal(PTY_HELPER_RELEASE.repository, "service-lasso/service-lasso-pty");
  assert.match(PTY_HELPER_RELEASE.tag, /^v\d+\.\d+\.\d+$/u);
  assert.deepEqual(
    PTY_HELPER_RELEASE.assets.map((asset) => asset.platform),
    ["win32-x64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"],
  );
  for (const asset of PTY_HELPER_RELEASE.assets) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
    assert.match(asset.name, /^service-lasso-pty-[A-Za-z0-9._-]+$/u);
    assert.equal(asset.executable, asset.platform === "win32-x64" ? "service-lasso-pty.exe" : "service-lasso-pty");
  }
});
