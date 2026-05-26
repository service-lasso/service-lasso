import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type PortReservationKind = "api" | "service-fixed" | "service-negotiated";

export interface PortReservation {
  host: string;
  port: number;
  kind: PortReservationKind;
  ownerId: string;
  portName: string;
  createdAt: string;
  updatedAt: string;
  stale?: boolean;
  staleReason?: string;
}

export interface PortReservationLedger {
  version: 1;
  updatedAt: string;
  reservations: PortReservation[];
}

export interface PortReservationInput {
  host?: string;
  port: number;
  kind: PortReservationKind;
  ownerId: string;
  portName: string;
}

const DEFAULT_HOST = "127.0.0.1";

export class PortReservationConflictError extends Error {
  readonly code = "port_reservation_conflict";

  constructor(message: string) {
    super(message);
    this.name = "PortReservationConflictError";
  }
}

export function getPortReservationLedgerPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "runtime", "port-reservations.json");
}

function emptyLedger(now = new Date().toISOString()): PortReservationLedger {
  return {
    version: 1,
    updatedAt: now,
    reservations: [],
  };
}

function isUsablePort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

function normalizeHost(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_HOST;
}

function reservationKey(host: string, port: number): string {
  return `${host}:${port}`;
}

function ownerKey(reservation: Pick<PortReservation, "ownerId" | "portName" | "kind">): string {
  return `${reservation.kind}:${reservation.ownerId}:${reservation.portName}`;
}

function normalizeReservation(value: unknown): PortReservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<PortReservation>;
  if (
    !isUsablePort(record.port) ||
    (record.kind !== "api" && record.kind !== "service-fixed" && record.kind !== "service-negotiated") ||
    typeof record.ownerId !== "string" ||
    !record.ownerId.trim() ||
    typeof record.portName !== "string" ||
    !record.portName.trim()
  ) {
    return null;
  }

  const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;

  return {
    host: normalizeHost(record.host),
    port: record.port,
    kind: record.kind,
    ownerId: record.ownerId,
    portName: record.portName,
    createdAt,
    updatedAt,
    stale: record.stale === true || undefined,
    staleReason: typeof record.staleReason === "string" ? record.staleReason : undefined,
  };
}

function normalizeLedger(value: unknown, now = new Date().toISOString()): PortReservationLedger {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyLedger(now);
  }

  const record = value as Partial<PortReservationLedger>;
  return {
    version: 1,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
    reservations: Array.isArray(record.reservations)
      ? record.reservations.map(normalizeReservation).filter((entry): entry is PortReservation => entry !== null)
      : [],
  };
}

function normalizeInput(input: PortReservationInput, now: string): PortReservation {
  if (!isUsablePort(input.port)) {
    throw new Error(`Invalid port reservation for "${input.ownerId}" "${input.portName}": ${input.port}.`);
  }
  if (!input.ownerId.trim()) {
    throw new Error("Port reservation ownerId must be non-empty.");
  }
  if (!input.portName.trim()) {
    throw new Error("Port reservation portName must be non-empty.");
  }

  return {
    host: normalizeHost(input.host),
    port: input.port,
    kind: input.kind,
    ownerId: input.ownerId,
    portName: input.portName,
    createdAt: now,
    updatedAt: now,
  };
}

export async function readPortReservationLedger(workspaceRoot: string): Promise<PortReservationLedger> {
  try {
    const parsed = JSON.parse(await readFile(getPortReservationLedgerPath(workspaceRoot), "utf8")) as unknown;
    return normalizeLedger(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyLedger();
    }
    throw error;
  }
}

export async function writePortReservationLedger(
  workspaceRoot: string,
  ledger: PortReservationLedger,
): Promise<PortReservationLedger> {
  const ledgerPath = getPortReservationLedgerPath(workspaceRoot);
  const normalized = normalizeLedger(ledger, ledger.updatedAt);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  const tempPath = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(tempPath, ledgerPath);
  return normalized;
}

export async function reservePorts(
  workspaceRoot: string,
  inputs: PortReservationInput[],
  now = new Date().toISOString(),
): Promise<PortReservationLedger> {
  const ledger = await readPortReservationLedger(workspaceRoot);
  const byPort = new Map<string, PortReservation>();
  const byOwner = new Map<string, PortReservation>();

  for (const reservation of ledger.reservations) {
    byPort.set(reservationKey(reservation.host, reservation.port), reservation);
    byOwner.set(ownerKey(reservation), reservation);
  }

  for (const input of inputs) {
    const next = normalizeInput(input, now);
    const existingPortOwner = byPort.get(reservationKey(next.host, next.port));
    if (existingPortOwner && ownerKey(existingPortOwner) !== ownerKey(next) && existingPortOwner.stale !== true) {
      throw new PortReservationConflictError(
        `Port ${next.host}:${next.port} is already reserved by "${existingPortOwner.ownerId}" "${existingPortOwner.portName}".`,
      );
    }

    const existingOwner = byOwner.get(ownerKey(next));
    const merged: PortReservation = {
      ...next,
      createdAt: existingOwner?.createdAt ?? existingPortOwner?.createdAt ?? now,
      updatedAt: now,
    };
    byOwner.set(ownerKey(merged), merged);
    byPort.set(reservationKey(merged.host, merged.port), merged);
  }

  return await writePortReservationLedger(workspaceRoot, {
    version: 1,
    updatedAt: now,
    reservations: [...byOwner.values()].sort((left, right) => left.port - right.port || left.ownerId.localeCompare(right.ownerId)),
  });
}

export async function reconcilePortReservationLedger(
  workspaceRoot: string,
  activeReservations: PortReservationInput[],
  staleReason: string,
  now = new Date().toISOString(),
): Promise<PortReservationLedger> {
  const active = new Map(
    activeReservations.map((input) => {
      const normalized = normalizeInput(input, now);
      return [ownerKey(normalized), normalized] as const;
    }),
  );
  const ledger = await readPortReservationLedger(workspaceRoot);
  const reconciled = new Map<string, PortReservation>();

  for (const reservation of ledger.reservations) {
    const activeReservation = active.get(ownerKey(reservation));
    if (activeReservation) {
      reconciled.set(ownerKey(activeReservation), {
        ...activeReservation,
        createdAt: reservation.createdAt,
        updatedAt: now,
      });
      continue;
    }

    reconciled.set(ownerKey(reservation), {
      ...reservation,
      stale: true,
      staleReason,
      updatedAt: now,
    });
  }

  for (const activeReservation of active.values()) {
    if (!reconciled.has(ownerKey(activeReservation))) {
      reconciled.set(ownerKey(activeReservation), activeReservation);
    }
  }

  return await writePortReservationLedger(workspaceRoot, {
    version: 1,
    updatedAt: now,
    reservations: [...reconciled.values()].sort((left, right) => left.port - right.port || left.ownerId.localeCompare(right.ownerId)),
  });
}
