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

export interface CandidateEntryBundleLaunchOptions extends NativeProducerOptions {
  bundleDirectory: string;
}

/**
 * Production bundle launch. Core executes the selected producer with the
 * authorization bundle and still validates the returned image/handoff.
 */
export async function launchCandidateEntryFromBundle(
  book: CandidateEntryLeaseBook,
  request: CandidateEntryLaunchRequest,
  options: CandidateEntryBundleLaunchOptions,
): Promise<CandidateEntryLaunchResult> {
  if (!options.bundleDirectory.startsWith("/") || options.bundleDirectory.includes("\0")) {
    return { ok: false, code: "binder_channel_closed" };
  }
  return launchCandidateEntry(book, request, {
    binderSource: new NativeProducerCandidateEntryBinderSource({
      ...options,
      args: [...(options.args ?? []), options.bundleDirectory],
    }),
  });
}
