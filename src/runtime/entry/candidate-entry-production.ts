import type { CandidateEntryLeaseBook } from "../../contracts/candidate-entry.js";
import {
  launchCandidateEntry,
  type CandidateEntryLaunchRequest,
  type CandidateEntryLaunchResult,
} from "./candidate-entry-launcher.js";
import {
  NativeProducerCandidateEntryBinderSource,
  type NativeProducerOptions,
} from "./native-producer-candidate-entry-binder.js";
import {
  type CandidateEntryBinderOriginals,
  RetainedCandidateEntryBinderSource,
} from "./retained-candidate-entry-binder.js";

/**
 * Production launch seam. Callers must supply the retained Core originals; the
 * legacy lease-only path is not reachable through this function. Missing or
 * incomplete originals refuse instead of falling back.
 */
export async function launchCandidateEntryWithOriginals(
  book: CandidateEntryLeaseBook,
  request: CandidateEntryLaunchRequest,
  originals: CandidateEntryBinderOriginals,
): Promise<CandidateEntryLaunchResult> {
  return launchCandidateEntry(book, request, {
    binderSource: new RetainedCandidateEntryBinderSource(originals),
  });
}

/**
 * Production helper launch seam. Core selects the helper executable and still
 * validates the returned image against the exact handoff.
 */
export async function launchCandidateEntryWithProducer(
  book: CandidateEntryLeaseBook,
  request: CandidateEntryLaunchRequest,
  options: NativeProducerOptions,
): Promise<CandidateEntryLaunchResult> {
  return launchCandidateEntry(book, request, {
    binderSource: new NativeProducerCandidateEntryBinderSource(options),
  });
}
