import net from "node:net";
import { readPortReservationLedger, type PortReservation } from "./reservations.js";

const DEFAULT_HOST = "127.0.0.1";

export type PortConflictReason = "none" | "ledger_reserved" | "live_listener";

export interface PortConflictExplanation {
  requested: {
    host: string;
    port: number;
    serviceId?: string;
    portName?: string;
  };
  conflict: boolean;
  reason: PortConflictReason;
  owner: {
    kind: PortReservation["kind"];
    ownerId: string;
    portName: string;
    host: string;
    port: number;
    stale: boolean;
  } | null;
  ledger: {
    checked: boolean;
    activeReservations: Array<Pick<PortReservation, "host" | "port" | "kind" | "ownerId" | "portName">>;
    staleReservations: Array<Pick<PortReservation, "host" | "port" | "kind" | "ownerId" | "portName" | "staleReason">>;
  };
  liveListener: {
    checked: boolean;
    host: string;
    port: number;
    occupied: boolean;
  };
  remediation: string[];
}

export interface ExplainPortConflictOptions {
  workspaceRoot: string;
  host?: string | null;
  port: number;
  serviceId?: string | null;
  portName?: string | null;
}

function normalizeHost(host: string | null | undefined): string {
  return typeof host === "string" && host.trim().length > 0 ? host.trim() : DEFAULT_HOST;
}

function hostMatches(left: string, right: string): boolean {
  return left === right || left === "0.0.0.0" || right === "0.0.0.0";
}

function sameRequestedPort(reservation: PortReservation, host: string, port: number): boolean {
  return reservation.port === port && hostMatches(reservation.host, host);
}

async function canBindPort(port: number, host: string): Promise<boolean> {
  const server = net.createServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }).catch(() => undefined);
    }
  }
}

function remediationFor(reason: PortConflictReason): string[] {
  if (reason === "ledger_reserved") {
    return [
      "Stop the owning Service Lasso service or runtime instance if it should release the port.",
      "Choose a different service port if the owner is expected to keep running.",
      "Run runtime reconcile or doctor flow if the reservation is stale.",
    ];
  }

  if (reason === "live_listener") {
    return [
      "Stop the external listener using the port if it is not expected.",
      "Choose a different service port if the listener should keep running.",
      "Start with a fresh port negotiation range when running multiple instances.",
    ];
  }

  return [];
}

export async function explainPortConflict(options: ExplainPortConflictOptions): Promise<PortConflictExplanation> {
  const host = normalizeHost(options.host);
  const ledger = await readPortReservationLedger(options.workspaceRoot);
  const matchingReservations = ledger.reservations.filter((reservation) =>
    sameRequestedPort(reservation, host, options.port),
  );
  const activeReservations = matchingReservations.filter((reservation) => reservation.stale !== true);
  const staleReservations = matchingReservations.filter((reservation) => reservation.stale === true);
  const owner = activeReservations[0] ?? null;
  const livePortFree = await canBindPort(options.port, host);
  const reason: PortConflictReason = owner ? "ledger_reserved" : livePortFree ? "none" : "live_listener";

  return {
    requested: {
      host,
      port: options.port,
      serviceId: options.serviceId?.trim() || undefined,
      portName: options.portName?.trim() || undefined,
    },
    conflict: reason !== "none",
    reason,
    owner: owner
      ? {
          kind: owner.kind,
          ownerId: owner.ownerId,
          portName: owner.portName,
          host: owner.host,
          port: owner.port,
          stale: owner.stale === true,
        }
      : null,
    ledger: {
      checked: true,
      activeReservations: activeReservations.map(({ host, port, kind, ownerId, portName }) => ({
        host,
        port,
        kind,
        ownerId,
        portName,
      })),
      staleReservations: staleReservations.map(({ host, port, kind, ownerId, portName, staleReason }) => ({
        host,
        port,
        kind,
        ownerId,
        portName,
        staleReason,
      })),
    },
    liveListener: {
      checked: true,
      host,
      port: options.port,
      occupied: !livePortFree,
    },
    remediation: remediationFor(reason),
  };
}
