import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

export const STARTUP_TRANSACTION_PHASES = [
  "preflight_reconciliation",
  "allocation_reserved",
  "configuration_materialized",
  "process_spawned",
  "ownership_persisted",
  "owned_readiness_proven",
  "generation_committed",
] as const;

export type StartupTransactionPhase = typeof STARTUP_TRANSACTION_PHASES[number];
export type StartupTransactionStatus = "active" | "committed" | "rolled_back" | "blocked";

export interface StartupTransactionJournal {
  version: 1;
  transactionId: string;
  generationId: string;
  instanceId: string;
  servicesRoot: string;
  workspaceRoot: string;
  status: StartupTransactionStatus;
  phase: StartupTransactionPhase;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  allocationRevision: string | null;
  completedActions: string[];
  pendingCompensations: string[];
  startedServiceIds: string[];
  failureCode: string | null;
}

export interface StartupTransactionUpdate {
  allocationRevision?: string | null;
  completedActions?: string[];
  addCompensations?: string[];
  removeCompensations?: string[];
  startedServiceIds?: string[];
  failureCode?: string | null;
}

export class StartupTransactionRecoveryRequiredError extends Error {
  readonly code = "startup_transaction_recovery_required";
  readonly statusCode = 409;
  readonly journal: StartupTransactionJournal;

  constructor(journal: StartupTransactionJournal) {
    super(
      `Workspace startup transaction ${journal.transactionId} is ${journal.status} at phase ${journal.phase}; ` +
      "complete its recorded compensations before starting another generation.",
    );
    this.name = "StartupTransactionRecoveryRequiredError";
    this.journal = journal;
  }
}

export function getStartupTransactionJournalPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso", "startup-transaction.json");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPhase(value: unknown): value is StartupTransactionPhase {
  return typeof value === "string" && (STARTUP_TRANSACTION_PHASES as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is StartupTransactionStatus {
  return value === "active" || value === "committed" || value === "rolled_back" || value === "blocked";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? unique(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= 300))
    : [];
}

function normalizeJournal(value: unknown): StartupTransactionJournal | null {
  if (!isRecord(value) || value.version !== 1 || !isPhase(value.phase) || !isStatus(value.status)) return null;
  const requiredStrings = [
    value.transactionId,
    value.generationId,
    value.instanceId,
    value.servicesRoot,
    value.workspaceRoot,
    value.startedAt,
    value.updatedAt,
  ];
  if (requiredStrings.some((entry) => typeof entry !== "string" || !entry)) return null;
  return {
    version: 1,
    transactionId: value.transactionId as string,
    generationId: value.generationId as string,
    instanceId: value.instanceId as string,
    servicesRoot: path.resolve(value.servicesRoot as string),
    workspaceRoot: path.resolve(value.workspaceRoot as string),
    status: value.status,
    phase: value.phase,
    startedAt: value.startedAt as string,
    updatedAt: value.updatedAt as string,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
    allocationRevision: typeof value.allocationRevision === "string" ? value.allocationRevision : null,
    completedActions: strings(value.completedActions),
    pendingCompensations: strings(value.pendingCompensations),
    startedServiceIds: strings(value.startedServiceIds),
    failureCode: typeof value.failureCode === "string" ? value.failureCode : null,
  };
}

async function atomicWriteJournal(journal: StartupTransactionJournal): Promise<void> {
  const filePath = getStartupTransactionJournalPath(journal.workspaceRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await copyFile(filePath, `${filePath}.bak`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
  await rename(tempPath, filePath);
  if (process.platform !== "win32") {
    const directory = await open(path.dirname(filePath), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

export async function readStartupTransactionJournal(workspaceRoot: string): Promise<StartupTransactionJournal | null> {
  const filePath = getStartupTransactionJournalPath(workspaceRoot);
  for (const candidate of [filePath, `${filePath}.bak`]) {
    try {
      const normalized = normalizeJournal(JSON.parse(await readFile(candidate, "utf8")) as unknown);
      if (normalized && path.resolve(normalized.workspaceRoot) === path.resolve(workspaceRoot)) return normalized;
    } catch {
      // Fall through to the crash-recovery backup.
    }
  }
  return null;
}

export async function beginStartupTransaction(input: {
  generationId: string;
  instanceId: string;
  servicesRoot: string;
  workspaceRoot: string;
  now?: Date;
}): Promise<StartupTransactionJournal> {
  const prior = await readStartupTransactionJournal(input.workspaceRoot);
  if (prior && (prior.status === "active" || prior.status === "blocked")) {
    throw new StartupTransactionRecoveryRequiredError(prior);
  }
  const now = (input.now ?? new Date()).toISOString();
  const journal: StartupTransactionJournal = {
    version: 1,
    transactionId: randomUUID(),
    generationId: input.generationId,
    instanceId: input.instanceId,
    servicesRoot: path.resolve(input.servicesRoot),
    workspaceRoot: path.resolve(input.workspaceRoot),
    status: "active",
    phase: "preflight_reconciliation",
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    allocationRevision: null,
    completedActions: ["preflight_reconciliation"],
    pendingCompensations: [],
    startedServiceIds: [],
    failureCode: null,
  };
  await atomicWriteJournal(journal);
  return journal;
}

function applyUpdate(
  journal: StartupTransactionJournal,
  update: StartupTransactionUpdate,
  now: string,
): StartupTransactionJournal {
  const removed = new Set(update.removeCompensations ?? []);
  return {
    ...journal,
    updatedAt: now,
    allocationRevision: update.allocationRevision === undefined ? journal.allocationRevision : update.allocationRevision,
    completedActions: unique([...journal.completedActions, ...(update.completedActions ?? [])]),
    pendingCompensations: unique([
      ...journal.pendingCompensations.filter((action) => !removed.has(action)),
      ...(update.addCompensations ?? []),
    ]),
    startedServiceIds: unique([...journal.startedServiceIds, ...(update.startedServiceIds ?? [])]),
    failureCode: update.failureCode === undefined ? journal.failureCode : update.failureCode,
  };
}

export async function advanceStartupTransaction(
  journal: StartupTransactionJournal,
  phase: StartupTransactionPhase,
  update: StartupTransactionUpdate = {},
  now = new Date(),
): Promise<StartupTransactionJournal> {
  if (journal.status !== "active") throw new Error(`Cannot advance ${journal.status} startup transaction.`);
  if (STARTUP_TRANSACTION_PHASES.indexOf(phase) < STARTUP_TRANSACTION_PHASES.indexOf(journal.phase)) {
    throw new Error(`Cannot move startup transaction backward from ${journal.phase} to ${phase}.`);
  }
  const next = applyUpdate({ ...journal, phase }, update, now.toISOString());
  await atomicWriteJournal(next);
  return next;
}

export async function settleStartupTransaction(
  journal: StartupTransactionJournal,
  status: Exclude<StartupTransactionStatus, "active">,
  update: StartupTransactionUpdate = {},
  now = new Date(),
): Promise<StartupTransactionJournal> {
  const timestamp = now.toISOString();
  const next = applyUpdate({ ...journal, status, finishedAt: timestamp }, update, timestamp);
  if ((status === "committed" || status === "rolled_back") && next.pendingCompensations.length > 0) {
    throw new Error(`Cannot seal startup transaction ${status} with pending compensations.`);
  }
  await atomicWriteJournal(next);
  return next;
}
