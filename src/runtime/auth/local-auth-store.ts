import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LOCAL_OPERATOR_FIRST_RUN_RELATIVE_PATH,
  LOCAL_OPERATOR_SESSION_TTL_MS,
  LOCAL_OPERATOR_STATE_RELATIVE_PATH,
  LOCAL_OPERATOR_USERNAME,
} from "./local-auth-constants.js";

interface LocalOperatorAuthStateFile {
  version: 1;
  tokenSalt: string;
  tokenHash: string;
  passwordSalt: string;
  passwordHash: string;
  forceSso: boolean;
  seededAt: string;
  /**
   * False until the operator copies the first-run token in Admin.
   * Missing on older files means already in use (cannot re-show a token).
   */
  credentialsAcknowledged: boolean;
}

export interface LocalOperatorFirstRunSecrets {
  username: string;
  token: string;
  password: string;
}

export interface LocalAuthMaterial {
  forceSso: boolean;
  localTokenConfigured: boolean;
  localOperatorConfigured: boolean;
  credentialsAcknowledged: boolean;
  firstRunPending: boolean;
  verifyLocalSecret: (provided: string) => boolean;
  verifyPassword: (provided: string) => boolean;
}

interface IssuedSession {
  hash: Buffer;
  expiresAt: number;
}

const sessions = new Map<string, IssuedSession>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStatePath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), LOCAL_OPERATOR_STATE_RELATIVE_PATH);
}

function readFirstRunPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), LOCAL_OPERATOR_FIRST_RUN_RELATIVE_PATH);
}

function hashSecret(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

function timingSafeBufferEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseState(value: unknown): LocalOperatorAuthStateFile | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }
  if (
    typeof value.tokenSalt !== "string" ||
    typeof value.tokenHash !== "string" ||
    typeof value.passwordSalt !== "string" ||
    typeof value.passwordHash !== "string" ||
    typeof value.forceSso !== "boolean" ||
    typeof value.seededAt !== "string"
  ) {
    return null;
  }
  return {
    version: 1,
    tokenSalt: value.tokenSalt,
    tokenHash: value.tokenHash,
    passwordSalt: value.passwordSalt,
    passwordHash: value.passwordHash,
    forceSso: value.forceSso,
    seededAt: value.seededAt,
    credentialsAcknowledged: value.credentialsAcknowledged !== false,
  };
}

/**
 * Persist hashed local-operator secrets. Plaintext exists only in the first-run
 * envelope until the operator acknowledges they saved the token.
 */
export async function writeLocalOperatorAuthState(
  workspaceRoot: string,
  input: {
    token: string;
    password: string;
    forceSso?: boolean;
    credentialsAcknowledged?: boolean;
    /**
     * When false, hashed state is written with `credentialsAcknowledged: false`
     * but the plaintext envelope is withheld until Broker KV ingest succeeds.
     */
    persistPlaintextEnvelope?: boolean;
  },
): Promise<LocalOperatorAuthStateFile> {
  const tokenSalt = randomBytes(16);
  const passwordSalt = randomBytes(16);
  const credentialsAcknowledged = input.credentialsAcknowledged === true;
  const persistPlaintextEnvelope = input.persistPlaintextEnvelope !== false;
  const state: LocalOperatorAuthStateFile = {
    version: 1,
    tokenSalt: tokenSalt.toString("base64url"),
    tokenHash: hashSecret(input.token, tokenSalt).toString("base64url"),
    passwordSalt: passwordSalt.toString("base64url"),
    passwordHash: hashSecret(input.password, passwordSalt).toString("base64url"),
    forceSso: input.forceSso === true,
    seededAt: new Date().toISOString(),
    credentialsAcknowledged,
  };
  const filePath = readStatePath(workspaceRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  if (credentialsAcknowledged) {
    await rm(readFirstRunPath(workspaceRoot), { force: true });
  } else if (persistPlaintextEnvelope) {
    await persistFirstRunEnvelope(workspaceRoot, {
      username: LOCAL_OPERATOR_USERNAME,
      token: input.token,
      password: input.password,
    });
  }
  return state;
}

/**
 * Write the one-time loopback envelope after Broker KV already holds the same
 * three first-run fields. Callers must not log `secrets`.
 */
export async function persistFirstRunEnvelope(
  workspaceRoot: string,
  secrets: LocalOperatorFirstRunSecrets,
): Promise<void> {
  const filePath = readFirstRunPath(workspaceRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify({ version: 1, token: secrets.token, password: secrets.password }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/**
 * Loopback first-run reveal. Returns null when already acknowledged or missing.
 */
export async function readFirstRunEnvelope(
  workspaceRoot: string,
): Promise<LocalOperatorFirstRunSecrets | null> {
  const state = await readLocalOperatorAuthState(workspaceRoot);
  if (!state || state.credentialsAcknowledged) {
    return null;
  }
  try {
    const raw = await readFile(readFirstRunPath(workspaceRoot), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.token !== "string" ||
      typeof parsed.password !== "string" ||
      parsed.token.length === 0 ||
      parsed.password.length === 0
    ) {
      return null;
    }
    return {
      username: LOCAL_OPERATOR_USERNAME,
      token: parsed.token,
      password: parsed.password,
    };
  } catch {
    return null;
  }
}

/**
 * Mark the one-time token as saved and delete the plaintext envelope.
 * Returns false when there is no state or the operator already acknowledged.
 */
export async function acknowledgeLocalOperatorFirstRun(workspaceRoot: string): Promise<boolean> {
  const existing = await readLocalOperatorAuthState(workspaceRoot);
  if (!existing || existing.credentialsAcknowledged) {
    return false;
  }
  const filePath = readStatePath(workspaceRoot);
  await writeFile(
    filePath,
    `${JSON.stringify({ ...existing, credentialsAcknowledged: true }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rm(readFirstRunPath(workspaceRoot), { force: true });
  return true;
}

export async function readLocalOperatorAuthState(
  workspaceRoot: string,
): Promise<LocalOperatorAuthStateFile | null> {
  try {
    const raw = await readFile(readStatePath(workspaceRoot), "utf8");
    return parseState(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function patchLocalOperatorForceSso(
  workspaceRoot: string,
  forceSso: boolean,
): Promise<void> {
  const existing = await readLocalOperatorAuthState(workspaceRoot);
  if (!existing) {
    return;
  }
  const filePath = readStatePath(workspaceRoot);
  await writeFile(
    filePath,
    `${JSON.stringify({ ...existing, forceSso }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function verifyAgainstState(
  provided: string,
  salt: string,
  expectedHash: string,
): boolean {
  try {
    const actual = hashSecret(provided, Buffer.from(salt, "base64url"));
    const expected = Buffer.from(expectedHash, "base64url");
    return timingSafeBufferEqual(actual, expected);
  } catch {
    return false;
  }
}

function pruneSessions(now = Date.now()): void {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
    }
  }
}

/**
 * Issue an opaque session id that is not the vault local-admin token.
 * Callers must not log the returned value.
 */
export function issueLocalAuthSession(): string {
  pruneSessions();
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, {
    hash: hashSecret(token, Buffer.from("session", "utf8")),
    expiresAt: Date.now() + LOCAL_OPERATOR_SESSION_TTL_MS,
  });
  return token;
}

export function verifyLocalAuthSession(provided: string): boolean {
  pruneSessions();
  const session = sessions.get(provided);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(provided);
    return false;
  }
  return true;
}

export function clearLocalAuthSessions(): void {
  sessions.clear();
}

export function materialFromState(
  state: LocalOperatorAuthStateFile | null,
  envToken: string | undefined,
): LocalAuthMaterial {
  const normalizedEnvToken = envToken?.trim();
  return {
    forceSso: state?.forceSso === true,
    localTokenConfigured: Boolean(normalizedEnvToken) || Boolean(state?.tokenHash),
    localOperatorConfigured: Boolean(state?.passwordHash),
    credentialsAcknowledged: state?.credentialsAcknowledged !== false,
    firstRunPending: false,
    verifyLocalSecret: (provided: string) => {
      if (verifyLocalAuthSession(provided)) {
        return true;
      }
      if (normalizedEnvToken) {
        const left = Buffer.from(normalizedEnvToken, "utf8");
        const right = Buffer.from(provided, "utf8");
        if (left.length === right.length && timingSafeEqual(left, right)) {
          return true;
        }
      }
      if (state && verifyAgainstState(provided, state.tokenSalt, state.tokenHash)) {
        return true;
      }
      return false;
    },
    verifyPassword: (provided: string) => {
      if (!state) {
        return false;
      }
      return verifyAgainstState(provided, state.passwordSalt, state.passwordHash);
    },
  };
}
