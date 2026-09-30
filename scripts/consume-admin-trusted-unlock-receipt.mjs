import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "service-admin.trusted-unlock-receipt.v1";
const KEYS = "loading,localRoot,present,schema,status,unavailable,verified";

export function parseReceipt(line) {
  if (typeof line !== "string" || line.length < 2 || line.length > 256) return null;
  const matches = line.match(/"(?:schema|status|present|verified|localRoot|loading|unavailable)"\s*:/gu) ?? [];
  if (new Set(matches.map((v) => v.replace(/["\s:]/gu, ""))).size !== matches.length) return null;
  let value; try { value = JSON.parse(line); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== KEYS) return null;
  if (value.schema !== SCHEMA || value.status !== "observed") return null;
  for (const key of ["present", "verified", "localRoot", "loading", "unavailable"]) if (typeof Object.getOwnPropertyDescriptor(value, key)?.value !== "boolean") return null;
  if (value.present !== (value.verified || value.localRoot || value.loading || value.unavailable)) return null;
  return { schema: value.schema, status: value.status, present: value.present, verified: value.verified, localRoot: value.localRoot, loading: value.loading, unavailable: value.unavailable };
}

export function classify(lines) {
  const candidates = lines.filter((line) => typeof line === "string" && line.includes(SCHEMA));
  if (!candidates.length) return { classification: "missing" };
  if (candidates.length !== 1) return { classification: "invalid" };
  const receipt = parseReceipt(candidates[0]);
  return receipt ? { classification: "closed", receipt } : { classification: "invalid" };
}

export async function consume(command, args, options = {}) {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const lines = [];
  for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    let buffer = "";
    stream.on("data", (chunk) => { target.write(chunk); buffer += chunk.toString("utf8"); const parts = buffer.split(/\r?\n/u); buffer = parts.pop() ?? ""; lines.push(...parts); });
  }
  const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  return { ...result, trustedUnlock: result.code === 0 && result.signal === null ? null : classify(lines) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const receipt = process.argv.indexOf("--receipt"), separator = process.argv.indexOf("--");
  if (receipt < 0 || separator < 0 || !process.argv[receipt + 1] || !process.argv[separator + 1]) process.exitCode = 2;
  else { const result = await consume(process.argv[separator + 1], process.argv.slice(separator + 2), { cwd: process.cwd(), env: process.env }); await writeFile(process.argv[receipt + 1], `${JSON.stringify({ schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: result.code === 0 && result.signal === null ? "success" : "nonzero_exit", trustedUnlock: result.trustedUnlock })}\n`); process.exitCode = result.code ?? 1; }
}
