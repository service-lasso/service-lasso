import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

test("#1326 native termination proof uses a held handle and rejects live, invalid and ambiguous status", { skip: process.platform !== "win32" }, async () => {
  const fixtureRoot = path.resolve("tests/fixtures");
  const sourcePath = path.join(fixtureRoot, "windows-held-exit-probe.cs");
  const binaryPath = path.join(fixtureRoot, "windows-held-exit-probe.exe");
  const provenancePath = path.join(fixtureRoot, "windows-held-exit-probe.provenance.json");
  for (const candidate of [sourcePath, binaryPath, provenancePath]) {
    assert.equal(path.dirname(candidate), fixtureRoot);
  }
  const [sourceBytes, binaryBytes, provenanceBytes] = await Promise.all([
    readFile(sourcePath),
    readFile(binaryPath),
    readFile(provenancePath),
  ]);
  const provenance = JSON.parse(provenanceBytes.toString("utf8"));
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.deepEqual(provenance, {
    schemaVersion: 1,
    compiler: {
      family: "Microsoft .NET Framework 4.8 C# compiler",
      path: "%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe",
      options: ["/nologo", "/target:exe", "/platform:anycpu", "/optimize+", "/debug-"],
    },
    source: {
      path: "tests/fixtures/windows-held-exit-probe.cs",
      sha256: sha256(sourceBytes),
    },
    binary: {
      path: "tests/fixtures/windows-held-exit-probe.exe",
      sha256: sha256(binaryBytes),
      byteLength: binaryBytes.byteLength,
      peTimestamp: "zero",
      moduleVersionId: "zero",
    },
  });
  const result = execFileSync(binaryPath, [path.resolve("src/runtime/process/windows-process-inspector.exe")], { timeout: 15000, windowsHide: true, encoding: "utf8" });
  assert.equal(result.trim(), "held_handle_cases_passed");
});
