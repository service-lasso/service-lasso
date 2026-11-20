import { createHash } from "node:crypto";
import { readSync, writeSync } from "node:fs";

import {
  observeCandidateEntryConsumer,
} from "../../dist/runtime/entry/candidate-entry-launcher.js";
import { decodeCandidateEntryBinderImage } from "../../dist/contracts/candidate-entry-binder.js";

function reader(fd) {
  let pending = Buffer.alloc(0);
  const fill = () => {
    const buffer = Buffer.alloc(4096);
    const count = readSync(fd, buffer, 0, buffer.length, null);
    if (count === 0) throw new Error("handoff closed");
    pending = Buffer.concat([pending, buffer.subarray(0, count)]);
  };
  return {
    line() {
      for (;;) {
        const index = pending.indexOf(0x0a);
        if (index >= 0) {
          const line = pending.subarray(0, index).toString("utf8");
          pending = pending.subarray(index + 1);
          return line;
        }
        fill();
      }
    },
    exact(count) {
      while (pending.length < count) fill();
      const value = pending.subarray(0, count);
      pending = pending.subarray(count);
      return value;
    },
  };
}

function writeLine(fd, value) {
  writeSync(fd, `${JSON.stringify(value)}\n`);
}

function refuse() {
  process.exit(2);
}

const input = reader(3);
let handoffLine;
let handoff;
try {
  handoffLine = input.line();
  handoff = JSON.parse(handoffLine);
} catch {
  refuse();
}
if (handoff?.contract !== "service-lasso.candidate-entry-handoff.v1") refuse();

let observation;
try {
  observation = await observeCandidateEntryConsumer("self");
} catch {
  refuse();
}

const mode = process.argv[2] ?? "none";
if (mode === "refuse") {
  writeLine(4, { kind: "refusal", code: "consumer_pid_mismatch" });
  process.exit(3);
}
if (mode === "tamper-argv") observation.argv = [...observation.argv, "tampered"];
else if (mode === "tamper-executable") observation.executableIdentity = "sha256:tampered";
else if (mode === "tamper-domain") observation.domainIdentity = "linux-ns-v1:tampered";
else if (mode === "tamper-environment") observation.environment = [...observation.environment, "TAMPERED=1"];
else if (mode === "delay") await new Promise((resolve) => setTimeout(resolve, 3_000));

writeLine(4, { kind: "observation", observation });

if (mode === "bind-image" || mode === "bind-image-bad-ack") {
  let binding;
  try {
    binding = JSON.parse(input.line());
  } catch {
    process.exit(4);
  }
  if (binding?.kind !== "binding") process.exit(3);
  const image = input.exact(binding.imageBytes);
  const actual = `sha256:${createHash("sha256").update(image).digest("hex")}`;
  if (actual !== binding.imageSha256) process.exit(5);
  const decoded = decodeCandidateEntryBinderImage({
    image,
    imageSha256: binding.imageSha256,
    handoffLine,
    allowSynthetic: true,
  });
  if (!decoded.ok) process.exit(6);
  writeLine(4, {
    kind: "ack",
    leaseId: binding.leaseId,
    imageSha256:
      mode === "bind-image-bad-ack" ? `sha256:${"0".repeat(64)}` : binding.imageSha256,
  });
  let bound;
  try {
    bound = JSON.parse(input.line());
  } catch {
    process.exit(7);
  }
  process.exit(bound?.kind === "bound" ? 0 : 8);
}

let response;
try {
  response = JSON.parse(input.line());
} catch {
  process.exit(1);
}
process.exit(response?.kind === "bound" ? 0 : 1);
