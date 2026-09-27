import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export function projectAuditRequest(line) {
  const failed = /^npm http fetch POST https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/security\/(advisories\/bulk|audits\/quick) attempt (\d+) failed with (ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPROTO|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.exec(line);
  if (failed) return { endpoint: failed[1] === "advisories/bulk" ? "bulk" : "quick", status: null, elapsedMs: null, attempt: Math.min(999, Number(failed[2])), failureCode: failed[3] };
  const match = /^npm http fetch POST (\d{3}) https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/security\/(advisories\/bulk|audits\/quick) (\d+)ms(?:\s|$)/.exec(line);
  if (!match) return null;
  const status = Number(match[1]);
  if (status < 100 || status > 599) return null;
  return {
    endpoint: match[2] === "advisories/bulk" ? "bulk" : "quick",
    status,
    elapsedMs: Math.min(3_600_000, Number(match[3])),
  };
}

export async function observeAudit(scope, npmCli = process.env.npm_execpath) {
  if (!["production", "tooling"].includes(scope) || !npmCli) {
    throw new Error("Audit scope or npm CLI is unavailable.");
  }
  const args = scope === "production" ? ["--omit=dev", "--audit-level=low"] : ["--audit-level=high"];
  const child = spawn(process.execPath, [npmCli, "audit", ...args, "--loglevel=http"], {
    stdio: ["ignore", "inherit", "pipe"],
  });
  const requests = [];
  let pending = "";
  const consume = (line) => {
    if (line.startsWith("npm http ")) {
      const request = projectAuditRequest(line);
      if (request && requests.length < 16) requests.push(request);
    } else {
      // Preserve npm's ordinary warnings/errors; added HTTP output is projected.
      process.stderr.write(`${line}\n`);
    }
  };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    pending += chunk;
    let index;
    while ((index = pending.indexOf("\n")) >= 0) {
      consume(pending.slice(0, index).replace(/\r$/, ""));
      pending = pending.slice(index + 1);
    }
    if (pending.length > 64 * 1024) pending = "";
  });
  let spawnFailed = false;
  child.on("error", () => { spawnFailed = true; });
  const { code, signal } = await new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  if (pending) consume(pending);
  console.error(JSON.stringify({ kind: "audit-request-observation", scope, requests, spawnFailed, interrupted: signal !== null }));
  return Number.isInteger(code) && code >= 0 ? code : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await observeAudit(process.argv[2]);
}
