import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CandidateEntryLeaseBook } from "../dist/contracts/candidate-entry.js";
import { launchCandidateEntryFromBundle } from "../dist/runtime/entry/candidate-entry-production.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tuiRoot = process.env.SERVICE_LASSO_TUI_ROOT ?? path.resolve(root, "../service-lasso-tui");
const go = process.env.GO ?? "go";
const bundle = process.env.SERVICE_LASSO_DEV_SYNTHETIC_BUNDLE ?? path.join(tuiRoot, "fixtures/dev-synthetic/bundle");
const owned = await mkdtemp(path.join(os.tmpdir(), "service-lasso-dev-entry-"));
const producer = path.join(owned, "service-lasso-entry-producer");
const consumer = path.join(owned, "service-lasso-entry-consumer");

function build(output, command) {
  execFileSync(go, ["build", "-o", output, command], { cwd: tuiRoot, stdio: "pipe" });
}

try {
  build(producer, "./cmd/service-lasso-entry-producer");
  build(consumer, "./cmd/service-lasso-entry-consumer");
  const now = Date.now();
  const lease = {
    leaseId: randomUUID(),
    attemptId: randomUUID(),
    issuerId: randomUUID(),
    reservationId: randomUUID(),
    operationId: randomUUID(),
    issuedAtMs: now - 1_000,
    expiresAtMs: now + 60_000,
  };
  const result = await launchCandidateEntryFromBundle(
    new CandidateEntryLeaseBook(),
    {
      executable: consumer,
      argv: [consumer, "--development-synthetic"],
      environment: [`PATH=${process.env.PATH ?? ""}`, "LANG=C", "SERVICE_LASSO_TEST=1"],
      lease,
      timeoutMs: 10_000,
    },
    {
      executable: producer,
      args: ["--development-synthetic"],
      bundleDirectory: bundle,
      allowSynthetic: true,
      timeoutMs: 10_000,
    },
  );
  if (!result.ok) throw new Error(`launch refused: ${result.code}`);
  await result.value.released;
  await new Promise((resolve, reject) => {
    if (result.value.child.exitCode !== null || result.value.child.signalCode !== null) {
      resolve();
      return;
    }
    result.value.child.once("close", (code, signal) => {
      if (code === 0 && signal === null) resolve();
      else reject(new Error(`consumer exit code=${code} signal=${signal}`));
    });
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    leaseId: result.value.binding.leaseId,
    imageSha256: result.value.imageSha256,
    producer,
    consumer,
    bundle,
  })}\n`);
} finally {
  await rm(owned, { recursive: true, force: true });
}
