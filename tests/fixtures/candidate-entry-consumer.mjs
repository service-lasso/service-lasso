import { readSync, writeSync } from "node:fs";

import { observeCandidateEntryConsumer } from "../../dist/runtime/entry/candidate-entry-launcher.js";

function readLine(fd) {
  const buffer = Buffer.alloc(4096);
  let pending = "";
  for (;;) {
    const count = readSync(fd, buffer, 0, buffer.length, null);
    if (count === 0) throw new Error("handoff closed");
    pending += buffer.subarray(0, count).toString("utf8");
    const index = pending.indexOf("\n");
    if (index >= 0) return pending.slice(0, index);
  }
}

function writeLine(fd, value) {
  writeSync(fd, `${JSON.stringify(value)}\n`);
}

function refuse() {
  process.exit(2);
}

let handoff;
try {
  handoff = JSON.parse(readLine(3));
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

let response;
try {
  response = JSON.parse(readLine(3));
} catch {
  process.exit(1);
}
process.exit(response?.kind === "bound" ? 0 : 1);
