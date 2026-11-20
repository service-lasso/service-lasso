import {
  encodeCandidateEntryBinderImage,
  type CandidateEntryBinderSection,
} from "../../contracts/candidate-entry-binder.js";
import type {
  CandidateEntryBinderArtifact,
  CandidateEntryBinderMaterializeRequest,
  CandidateEntryBinderSource,
} from "./candidate-entry-binder.js";

export interface CandidateEntryBinderOriginals {
  sections(
    request: CandidateEntryBinderMaterializeRequest,
  ): readonly CandidateEntryBinderSection[] | null;
  release(leaseId: string): void;
}

/**
 * Core-side adapter for authentic retained originals. The originals owner is
 * supplied by the launch record; it must return immutable sections for this
 * lease or null. This adapter never synthesizes a missing original.
 */
export class RetainedCandidateEntryBinderSource implements CandidateEntryBinderSource {
  readonly #originals: CandidateEntryBinderOriginals;
  readonly #synthetic: boolean;

  constructor(originals: CandidateEntryBinderOriginals, synthetic = false) {
    this.#originals = originals;
    this.#synthetic = synthetic;
  }

  materialize(request: CandidateEntryBinderMaterializeRequest): CandidateEntryBinderArtifact {
    let sections: readonly CandidateEntryBinderSection[] | null;
    try {
      sections = this.#originals.sections(request);
    } catch {
      return { ok: false, code: "binder_originals_unavailable" };
    }
    if (!sections || sections.length === 0) {
      return { ok: false, code: "binder_originals_unavailable" };
    }
    const encoded = encodeCandidateEntryBinderImage({
      handoffLine: request.handoffLine,
      sections,
      synthetic: this.#synthetic,
    });
    if (!encoded.ok) {
      return { ok: false, code: encoded.code };
    }
    return {
      ok: true,
      image: encoded.value.bytes,
      imageSha256: encoded.value.imageSha256,
    };
  }

  release(leaseId: string): void {
    this.#originals.release(leaseId);
  }
}
