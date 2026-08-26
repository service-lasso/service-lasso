import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const FAIL_NEXT_SAMPLE_START_PATH = '/__service_lasso_test/fail-next-sample-start'
export const FAIL_NEXT_SAMPLE_START_ENV = 'SERVICE_LASSO_TEST_FAIL_NEXT_START_MARKER'
export const SAMPLE_READINESS_PORT_ENV = 'SAMPLE_READINESS_PORT'
export const SAMPLE_START_FAILURE_EXIT_CODE = 73

const MAX_CONTROL_REQUEST_BYTES = 0

function isLoopbackRequest(request) {
  const remoteAddress = request.socket?.remoteAddress ?? ''
  return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
}

function writeOutcome(response, statusCode, outcome, extraHeaders = {}) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    ...extraHeaders,
  })
  response.end(JSON.stringify({ outcome }))
}

function hasRequestBody(request) {
  const contentLength = request.headers['content-length']
  const transferEncoding = request.headers['transfer-encoding']
  if (transferEncoding !== undefined) return true
  if (contentLength === undefined) return false
  return !/^0+$/u.test(String(contentLength)) || Number(contentLength) > MAX_CONTROL_REQUEST_BYTES
}

export async function armNextSampleStartFailure(markerPath) {
  await mkdir(path.dirname(markerPath), { recursive: true, mode: 0o700 })
  try {
    await writeFile(markerPath, '', { flag: 'wx', mode: 0o600 })
    return { outcome: 'sample_start_failure_armed' }
  } catch (error) {
    if (error?.code === 'EEXIST') return { outcome: 'sample_start_failure_already_armed' }
    throw error
  }
}

export async function handleFailNextSampleStartRequest(request, response, markerPath) {
  if (!isLoopbackRequest(request)) {
    writeOutcome(response, 403, 'control_access_denied')
    return
  }
  if (request.url !== FAIL_NEXT_SAMPLE_START_PATH) {
    writeOutcome(response, 404, 'control_route_not_found')
    return
  }
  if (request.method !== 'POST') {
    writeOutcome(response, 405, 'method_not_allowed', { Allow: 'POST' })
    return
  }
  if (hasRequestBody(request)) {
    writeOutcome(response, 400, 'request_body_not_allowed')
    return
  }
  try {
    const result = await armNextSampleStartFailure(markerPath)
    writeOutcome(response, 200, result.outcome)
  } catch {
    writeOutcome(response, 409, 'sample_start_failure_arm_failed')
  }
}

export function createRealAdminBrowserSampleSource() {
  return [
    'import { createHash } from "node:crypto"',
    'import http from "node:http"',
    'import { mkdir, rename, rm, writeFile } from "node:fs/promises"',
    'import path from "node:path"',
    `const marker = process.env.${FAIL_NEXT_SAMPLE_START_ENV} ?? ""`,
    'let failedLaunch = false',
    'if (marker) {',
    '  const claimedMarker = `${marker}.claimed-${process.pid}`',
    '  let claimed = false',
    '  try {',
    '    await rename(marker, claimedMarker)',
    '    claimed = true',
    '  } catch (error) {',
    '    if (error?.code !== "ENOENT") {',
    '      process.stderr.write(JSON.stringify({ outcome: "sample_start_marker_consume_failed" }))',
    '      process.exit(74)',
    '    }',
    '  }',
    '  if (claimed) {',
    '    try {',
    '      await rm(claimedMarker)',
    '    } catch {',
    '      process.stderr.write(JSON.stringify({ outcome: "sample_start_marker_remove_failed" }))',
    '      process.exit(74)',
    '    }',
    '    failedLaunch = true',
    '  }',
    '}',
    'const value = process.env.SAMPLE_REQUIRED_TOKEN ?? ""',
    'const target = path.resolve(process.cwd(), ".state/browser-broker-evidence.json")',
    `const readinessPort = Number(process.env.${SAMPLE_READINESS_PORT_ENV} ?? "")`,
    'const keepAlive = setInterval(() => {}, 1000)',
    'let server = null',
    'let stopping = false',
    'const finish = () => { clearInterval(keepAlive); process.exit(failedLaunch ? 73 : 0) }',
    'process.on("SIGTERM", () => {',
    '  if (stopping) return',
    '  stopping = true',
    '  if (server?.listening) server.close(finish)',
    '  else finish()',
    '})',
    'if (!failedLaunch) {',
    '  if (!Number.isInteger(readinessPort) || readinessPort < 1 || readinessPort > 65535) {',
    '    process.stderr.write(JSON.stringify({ outcome: "sample_readiness_port_invalid" }))',
    '    process.exit(75)',
    '  }',
    '  await mkdir(path.dirname(target), { recursive: true })',
    '  await writeFile(target, JSON.stringify({ present: value.length >= 32, digest: createHash("sha256").update(value).digest("hex") }))',
    '  server = http.createServer((request, response) => {',
    '    if (request.method !== "GET" || request.url !== "/ready") { response.writeHead(404); response.end(); return }',
    '    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" })',
    '    response.end(JSON.stringify({ outcome: "sample_ready" }))',
    '  })',
    '  await new Promise((resolve, reject) => {',
    '    server.once("error", reject)',
    '    server.listen(readinessPort, "127.0.0.1", resolve)',
    '  })',
    '}',
  ].join('\n')
}
