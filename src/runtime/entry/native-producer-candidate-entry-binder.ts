import { spawnSync } from "node:child_process";

import {
  CANDIDATE_ENTRY_BINDER_MAX_BYTES,
  decodeCandidateEntryBinderImage,
  type CandidateEntryBinderRefusalCode,
} from "../../contracts/candidate-entry-binder.js";
import type {
  CandidateEntryBinderArtifact,
  CandidateEntryBinderMaterializeRequest,
  CandidateEntryBinderSource,
} from "./candidate-entry-binder.js";

export interface NativeProducerOptions {
  executable: string;
  args?: readonly string[];
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  allowSynthetic?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

interface ProducerOk {
  ok: true;
  imageBytes: number;
  imageSha256: string;
}
interface ProducerRefusal {
  ok: false;
  code: string;
}

function parseResponse(output: Buffer, allowSynthetic: boolean, request: CandidateEntryBinderMaterializeRequest): CandidateEntryBinderArtifact {
  const separator = output.indexOf(0x0a);
  if (separator < 0) return { ok: false, code: "binder_message_invalid" };
  let message: ProducerOk | ProducerRefusal;
  try {
    message = JSON.parse(output.subarray(0, separator).toString("utf8")) as ProducerOk | ProducerRefusal;
  } catch {
    return { ok: false, code: "binder_message_invalid" };
  }
  if (!message || typeof message !== "object" || typeof message.ok !== "boolean") {
    return { ok: false, code: "binder_message_invalid" };
  }
  if (!message.ok) {
    return { ok: false, code: (typeof message.code === "string" ? message.code : "binder_originals_unavailable") as CandidateEntryBinderRefusalCode };
  }
  if (
    !Number.isSafeInteger(message.imageBytes) ||
    message.imageBytes <= 0 ||
    message.imageBytes > CANDIDATE_ENTRY_BINDER_MAX_BYTES ||
    typeof message.imageSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(message.imageSha256)
  ) {
    return { ok: false, code: "binder_message_invalid" };
  }
  const image = output.subarray(separator + 1);
  if (image.byteLength !== message.imageBytes) {
    return { ok: false, code: "binder_image_size_invalid" };
  }
  const decoded = decodeCandidateEntryBinderImage({
    image,
    imageSha256: message.imageSha256,
    handoffLine: request.handoffLine,
    allowSynthetic,
  });
  if (!decoded.ok) return { ok: false, code: decoded.code };
  return { ok: true, image: Uint8Array.from(image), imageSha256: message.imageSha256 };
}

/**
 * Core-owned producer transport. It executes a Core-selected helper and accepts
 * only a validated image bound to the exact handoff line. It never accepts a
 * caller-provided image as authority.
 */
export class NativeProducerCandidateEntryBinderSource implements CandidateEntryBinderSource {
  readonly #options: NativeProducerOptions;

  constructor(options: NativeProducerOptions) {
    this.#options = options;
  }

  materialize(request: CandidateEntryBinderMaterializeRequest): CandidateEntryBinderArtifact {
    if (!this.#options.executable || !this.#options.executable.startsWith("/")) {
      return { ok: false, code: "binder_channel_closed" };
    }
    const control = JSON.stringify({
      kind: "materialize",
      lease: request.lease,
      observation: request.observation,
      handoffLine: Buffer.from(request.handoffLine).toString("base64"),
    });
    const result = spawnSync(this.#options.executable, [...(this.#options.args ?? [])], {
      input: `${control}\n`,
      encoding: null,
      timeout: this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: CANDIDATE_ENTRY_BINDER_MAX_BYTES + 64 * 1024,
      env: this.#options.environment ?? process.env,
      windowsHide: true,
    });
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      return { ok: false, code: code === "ETIMEDOUT" ? "binder_timeout" : "binder_channel_closed" };
    }
    if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
      return { ok: false, code: "binder_channel_closed" };
    }
    return parseResponse(result.stdout, this.#options.allowSynthetic === true, request);
  }

  release(): void {}
}
