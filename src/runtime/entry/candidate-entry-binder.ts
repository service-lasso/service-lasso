import type {
  CandidateEntryConsumerObservation,
  CandidateEntryLease,
} from "../../contracts/candidate-entry.js";
import type { CandidateEntryBinderCoreRefusalCode } from "../../contracts/candidate-entry-binder.js";

export interface CandidateEntryBinderMaterializeRequest {
  lease: CandidateEntryLease;
  observation: CandidateEntryConsumerObservation;
  handoffLine: Uint8Array;
}

export type CandidateEntryBinderArtifact =
  | {
      ok: true;
      image: Uint8Array;
      imageSha256: string;
    }
  | {
      ok: false;
      code: CandidateEntryBinderCoreRefusalCode;
    };

export interface CandidateEntryBinderSource {
  materialize(request: CandidateEntryBinderMaterializeRequest): CandidateEntryBinderArtifact;
  release(leaseId: string): void;
}

export class UnavailableCandidateEntryBinderSource implements CandidateEntryBinderSource {
  materialize(): CandidateEntryBinderArtifact {
    return { ok: false, code: "binder_originals_unavailable" };
  }

  release(): void {}
}
