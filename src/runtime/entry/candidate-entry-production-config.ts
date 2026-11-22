import type { CandidateEntryLeaseBook } from "../../contracts/candidate-entry.js";
import {
  launchCandidateEntryFromBundle,
  type CandidateEntryBundleLaunchOptions,
} from "./candidate-entry-production.js";
import type {
  CandidateEntryLaunchRequest,
  CandidateEntryLaunchResult,
} from "./candidate-entry-launcher.js";

export interface CandidateEntryProductionConfig {
  producerExecutable: string;
  bundleDirectory: string;
  timeoutMs?: number;
}

function absolute(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.includes("\0");
}

export function validateCandidateEntryProductionConfig(
  config: CandidateEntryProductionConfig,
): CandidateEntryProductionConfig | null {
  if (!config || typeof config !== "object" || !absolute(config.producerExecutable) || !absolute(config.bundleDirectory)) {
    return null;
  }
  if (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0)) {
    return null;
  }
  return {
    producerExecutable: config.producerExecutable,
    bundleDirectory: config.bundleDirectory,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  };
}

export function candidateEntryProductionConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): CandidateEntryProductionConfig | null {
  return validateCandidateEntryProductionConfig({
    producerExecutable: environment.SERVICE_LASSO_ENTRY_PRODUCER ?? "",
    bundleDirectory: environment.SERVICE_LASSO_ENTRY_BUNDLE ?? "",
  });
}

/** Production caller must supply the producer and bundle explicitly. */
export async function launchProductionCandidateEntry(
  book: CandidateEntryLeaseBook,
  request: CandidateEntryLaunchRequest,
  config: CandidateEntryProductionConfig,
): Promise<CandidateEntryLaunchResult> {
  const valid = validateCandidateEntryProductionConfig(config);
  if (!valid) return { ok: false, code: "binder_channel_closed" };
  const options: CandidateEntryBundleLaunchOptions = {
    executable: valid.producerExecutable,
    bundleDirectory: valid.bundleDirectory,
    ...(valid.timeoutMs === undefined ? {} : { timeoutMs: valid.timeoutMs }),
  };
  return launchCandidateEntryFromBundle(book, request, options);
}
