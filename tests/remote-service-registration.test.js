import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerReleasedService, serviceRegistrationOperationStorePath } from "../dist/runtime/operator/remote-service-registration.js";

test("remote registration publishes its recovery journal before acknowledgement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-remote-journal-"));
  const workspaceRoot = path.join(root, "workspace");
  const servicesRoot = path.join(root, "services");
  const originalFetch = globalThis.fetch;
  const manifest = {
    id: "remote-journal-service",
    name: "Remote journal service",
    description: "Direct durable journal fixture.",
    executable: process.execPath,
    args: ["runtime/remote-journal-service.mjs"],
    healthcheck: { type: "process" },
    artifact: {
      kind: "archive",
      source: { type: "github-release", repo: "service-lasso/lasso-node", tag: "v1.0.0" },
      platforms: {
        win32: { assetName: "remote-journal.zip", archiveType: "zip", command: "remote-journal.exe", checksum: { algorithm: "sha256", value: "a".repeat(64) } },
      },
    },
  };
  const request = {
    repo: "service-lasso/lasso-node",
    tag: "v1.0.0",
    expectedCommit: "b".repeat(40),
    expectedManifestSha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    idempotencyKey: "remote-journal-publication-0001",
  };
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.github.com/repos/service-lasso/lasso-node/git/ref/tags/v1.0.0") {
      return new Response(JSON.stringify({ object: { type: "commit", sha: request.expectedCommit } }), { status: 200 });
    }
    if (url === "https://api.github.com/repos/service-lasso/lasso-node/releases/tags/v1.0.0") {
      return new Response(JSON.stringify({ tag_name: request.tag, assets: [{ name: "service.json", browser_download_url: "https://github.com/service-lasso/lasso-node/releases/download/v1.0.0/service.json" }] }), { status: 200 });
    }
    if (url === "https://github.com/service-lasso/lasso-node/releases/download/v1.0.0/service.json") {
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const result = await registerReleasedService({ workspaceRoot, servicesRoot, actor: { id: "remote-journal-actor" }, request });
    assert.equal(result.status, "completed");
    const journal = JSON.parse(await readFile(serviceRegistrationOperationStorePath(workspaceRoot), "utf8"));
    assert.equal(journal.operations.length, 1);
    assert.equal(journal.operations[0].id, result.id);
    assert.equal(journal.operations[0].status, "completed");
    const replay = await registerReleasedService({ workspaceRoot, servicesRoot, actor: { id: "remote-journal-actor" }, request });
    assert.equal(replay.replayed, true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
