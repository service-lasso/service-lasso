import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(root, "scripts/check-service-producer-release-policy-contract.mjs");
const sources = [
  "docs/reference/service-producer-release-policy.md",
  ".governance/specs/SPEC-002-core-standalone-runtime.md",
  "docs/api/staged-service-transfer.md",
  "fixtures/service-producer-release-policy/valid-policy.json",
];

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "service-producer-policy-"));
  for (const source of sources) {
    const target = path.join(dir, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, source), target);
  }
  return dir;
}

function run(dir) {
  return spawnSync(process.execPath, [checker], {
    encoding: "utf8",
    env: { ...process.env, SERVICE_PRODUCER_POLICY_ROOT: dir },
  });
}

test("#1524 service-producer policy fixture is accepted", () => {
  const dir = fixture();
  try {
    assert.equal(run(dir).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#1524 policy rejects a Windows TAR substitution", () => {
  const dir = fixture();
  try {
    const policyPath = path.join(dir, "fixtures/service-producer-release-policy/valid-policy.json");
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    policy.platforms.win32.archiveType = "tar.gz";
    fs.writeFileSync(policyPath, JSON.stringify(policy));
    assert.equal(run(dir).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#1524 policy rejects a default platform fallback", () => {
  const dir = fixture();
  try {
    const policyPath = path.join(dir, "fixtures/service-producer-release-policy/valid-policy.json");
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    policy.platforms.default = policy.platforms.linux;
    fs.writeFileSync(policyPath, JSON.stringify(policy));
    assert.equal(run(dir).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#1524 policy rejects an unclosed object shape", () => {
  const dir = fixture();
  try {
    const policyPath = path.join(dir, "fixtures/service-producer-release-policy/valid-policy.json");
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    policy.manifest.url = "https://example.invalid/service.json";
    fs.writeFileSync(policyPath, JSON.stringify(policy));
    assert.equal(run(dir).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#1524 policy permits one coherent shared checksum release asset", () => {
  const dir = fixture();
  try {
    assert.equal(run(dir).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#1524 policy rejects an incoherent shared checksum release asset", () => {
  const dir = fixture();
  try {
    const policyPath = path.join(dir, "fixtures/service-producer-release-policy/valid-policy.json");
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    policy.platforms.darwin.checksum.sha256 = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    fs.writeFileSync(policyPath, JSON.stringify(policy));
    assert.equal(run(dir).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#1524 policy rejects an archive that impersonates a fixed asset", () => {
  const dir = fixture();
  try {
    const policyPath = path.join(dir, "fixtures/service-producer-release-policy/valid-policy.json");
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    policy.platforms.linux.assetName = "service.json";
    fs.writeFileSync(policyPath, JSON.stringify(policy));
    assert.equal(run(dir).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
