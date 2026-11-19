import { z } from "zod";

export const CANDIDATE_ENTRY_LEASE_CONTRACT = "service-lasso.candidate-entry-lease.v1" as const;
export const CANDIDATE_ENTRY_HANDOFF_CONTRACT = "service-lasso.candidate-entry-handoff.v1" as const;

const noNul = (value: string) => !value.includes("\0");

const consumerIdentitySchema = z
  .object({
    pid: z.number().int().positive(),
    startIdentity: z.string().min(1),
    executableIdentity: z.string().min(1),
    domainIdentity: z.string().min(1),
  })
  .strict();

const publicInputSchema = z
  .object({
    argv: z.array(z.string().refine(noNul)).min(1),
    environment: z.array(z.string().refine(noNul)),
  })
  .strict();

const leaseSchema = z
  .object({
    contract: z.literal(CANDIDATE_ENTRY_LEASE_CONTRACT),
    version: z.literal(1),
    leaseId: z.string().min(1),
    attemptId: z.string().min(1),
    issuerId: z.string().min(1),
    reservationId: z.string().min(1),
    operationId: z.string().min(1),
    consumer: consumerIdentitySchema,
    publicInput: publicInputSchema,
    issuedAtMs: z.number().int().nonnegative(),
    expiresAtMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine((lease) => lease.expiresAtMs > lease.issuedAtMs);

const consumerObservationSchema = z
  .object({
    pid: z.number().int().positive(),
    startIdentity: z.string().min(1),
    executableIdentity: z.string().min(1),
    domainIdentity: z.string().min(1),
    argv: z.array(z.string().refine(noNul)).min(1),
    environment: z.array(z.string().refine(noNul)),
  })
  .strict();

export type CandidateEntryConsumerIdentity = z.infer<typeof consumerIdentitySchema>;
export type CandidateEntryPublicInput = z.infer<typeof publicInputSchema>;
export type CandidateEntryLease = z.infer<typeof leaseSchema>;
export type CandidateEntryConsumerObservation = z.infer<typeof consumerObservationSchema>;

export const candidateEntryHandoffSchema = z
  .object({
    contract: z.literal(CANDIDATE_ENTRY_HANDOFF_CONTRACT),
    lease: leaseSchema,
  })
  .strict();

export type CandidateEntryHandoff = z.infer<typeof candidateEntryHandoffSchema>;

export type CandidateEntryRefusalCode =
  | "lease_shape_invalid"
  | "lease_duplicate"
  | "lease_unknown"
  | "clock_invalid"
  | "lease_not_yet_valid"
  | "lease_expired"
  | "lease_released"
  | "lease_replayed"
  | "lease_release_replayed"
  | "consumer_observation_shape_invalid"
  | "consumer_pid_mismatch"
  | "consumer_start_mismatch"
  | "consumer_executable_mismatch"
  | "consumer_domain_mismatch"
  | "public_argv_mismatch"
  | "public_environment_mismatch";

export type CandidateEntryResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: CandidateEntryRefusalCode };

export interface CandidateEntryBinding {
  leaseId: string;
  attemptId: string;
  issuerId: string;
  reservationId: string;
  operationId: string;
  consumer: CandidateEntryConsumerIdentity;
  publicInput: CandidateEntryPublicInput;
  boundAtMs: number;
}

export interface CandidateEntryRelease {
  leaseId: string;
  releasedAtMs: number;
}

type LeaseState = "issued" | "bound" | "released" | "expired";

interface LeaseRecord {
  lease: CandidateEntryLease;
  state: LeaseState;
  boundAtMs?: number;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validClock(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function freezeLease(lease: CandidateEntryLease): CandidateEntryLease {
  Object.freeze(lease.consumer);
  Object.freeze(lease.publicInput.argv);
  Object.freeze(lease.publicInput.environment);
  Object.freeze(lease.publicInput);
  return Object.freeze(lease);
}

function refusal<T>(code: CandidateEntryRefusalCode): CandidateEntryResult<T> {
  return { ok: false, code };
}

export function parseCandidateEntryLease(value: unknown): CandidateEntryResult<CandidateEntryLease> {
  const parsed = leaseSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : refusal("lease_shape_invalid");
}

export function encodeCandidateEntryHandoff(lease: CandidateEntryLease): string {
  return JSON.stringify({ contract: CANDIDATE_ENTRY_HANDOFF_CONTRACT, lease });
}

export function parseCandidateEntryHandoff(
  value: unknown,
): CandidateEntryResult<CandidateEntryHandoff> {
  const parsed = candidateEntryHandoffSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : refusal("lease_shape_invalid");
}

export class CandidateEntryLeaseBook {
  readonly #leases = new Map<string, LeaseRecord>();

  issue(value: unknown): CandidateEntryResult<CandidateEntryLease> {
    const parsed = parseCandidateEntryLease(value);
    if (!parsed.ok) return parsed;
    if (this.#leases.has(parsed.value.leaseId)) return refusal("lease_duplicate");
    const lease = freezeLease(parsed.value);
    this.#leases.set(lease.leaseId, { lease, state: "issued" });
    return { ok: true, value: lease };
  }

  bind(
    leaseId: string,
    observation: unknown,
    nowMs: number,
  ): CandidateEntryResult<CandidateEntryBinding> {
    const record = this.#leases.get(leaseId);
    if (!record) return refusal("lease_unknown");
    if (!validClock(nowMs)) return refusal("clock_invalid");
    if (record.state === "released") return refusal("lease_released");
    if (record.state === "expired") return refusal("lease_expired");
    if (record.state === "bound") return refusal("lease_replayed");
    if (nowMs < record.lease.issuedAtMs) return refusal("lease_not_yet_valid");
    if (nowMs >= record.lease.expiresAtMs) {
      record.state = "expired";
      return refusal("lease_expired");
    }

    const parsed = consumerObservationSchema.safeParse(observation);
    if (!parsed.success) return refusal("consumer_observation_shape_invalid");
    const seen = parsed.data;
    const expected = record.lease.consumer;

    if (seen.pid !== expected.pid) return refusal("consumer_pid_mismatch");
    if (seen.startIdentity !== expected.startIdentity) return refusal("consumer_start_mismatch");
    if (seen.executableIdentity !== expected.executableIdentity) {
      return refusal("consumer_executable_mismatch");
    }
    if (seen.domainIdentity !== expected.domainIdentity) return refusal("consumer_domain_mismatch");
    if (!sameStrings(seen.argv, record.lease.publicInput.argv)) return refusal("public_argv_mismatch");
    if (!sameStrings(seen.environment, record.lease.publicInput.environment)) {
      return refusal("public_environment_mismatch");
    }

    record.state = "bound";
    record.boundAtMs = nowMs;
    return {
      ok: true,
      value: {
        leaseId: record.lease.leaseId,
        attemptId: record.lease.attemptId,
        issuerId: record.lease.issuerId,
        reservationId: record.lease.reservationId,
        operationId: record.lease.operationId,
        consumer: expected,
        publicInput: record.lease.publicInput,
        boundAtMs: nowMs,
      },
    };
  }

  release(leaseId: string, nowMs: number): CandidateEntryResult<CandidateEntryRelease> {
    const record = this.#leases.get(leaseId);
    if (!record) return refusal("lease_unknown");
    if (!validClock(nowMs)) return refusal("clock_invalid");
    if (record.state === "released") return refusal("lease_release_replayed");
    record.state = "released";
    return { ok: true, value: { leaseId, releasedAtMs: nowMs } };
  }
}
