import { readFileSync, writeSync } from "node:fs";

import {
  CANDIDATE_ENTRY_BINDER_SECTION,
  encodeCandidateEntryBinderImage,
} from "../../dist/contracts/candidate-entry-binder.js";

function refuse(code) {
  writeSync(1, `${JSON.stringify({ ok: false, code })}\n`);
  process.exit(0);
}

let request;
try {
  request = JSON.parse(readFileSync(0, "utf8"));
} catch {
  refuse("binder_message_invalid");
}
if (request?.kind !== "materialize" || typeof request.handoffLine !== "string") {
  refuse("binder_message_invalid");
}
if (process.env.PRODUCER_REFUSE === "1") {
  refuse("binder_originals_unavailable");
}

const handoffLine = Buffer.from(request.handoffLine, "base64");
const kinds = [
  CANDIDATE_ENTRY_BINDER_SECTION.CHARGE,
  CANDIDATE_ENTRY_BINDER_SECTION.SOURCE,
  CANDIDATE_ENTRY_BINDER_SECTION.DOMAIN,
  CANDIDATE_ENTRY_BINDER_SECTION.ACTORS,
  CANDIDATE_ENTRY_BINDER_SECTION.BASES,
  CANDIDATE_ENTRY_BINDER_SECTION.PUBLIC_INPUT,
  CANDIDATE_ENTRY_BINDER_SECTION.DEADLINE,
  CANDIDATE_ENTRY_BINDER_SECTION.ISSUER,
  CANDIDATE_ENTRY_BINDER_SECTION.CUSTODY,
];
const encoded = encodeCandidateEntryBinderImage({
  handoffLine,
  sections: kinds.map((kind) => ({ kind, bytes: Buffer.from(`producer-${kind}`) })),
  synthetic: true,
});
if (!encoded.ok) refuse(encoded.code);
writeSync(
  1,
  `${JSON.stringify({
    ok: true,
    imageBytes: encoded.value.bytes.length,
    imageSha256: encoded.value.imageSha256,
  })}\n`,
);
writeSync(1, Buffer.from(encoded.value.bytes));
