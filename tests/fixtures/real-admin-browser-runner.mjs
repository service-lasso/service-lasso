import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { discoverServices } from '../../dist/runtime/discovery/discoverServices.js'
import {
  bootstrapSecretsBrokerVault,
  loadSecretsBrokerRuntimeContext,
  provisionFirstRunGeneratedSecrets,
  readSecretsBrokerRuntimeCredentials,
} from '../../dist/runtime/broker/runtime.js'
import { stopAllManagedProcesses } from '../../dist/runtime/execution/supervisor.js'
import { getLifecycleState, resetLifecycleState, setLifecycleState } from '../../dist/runtime/lifecycle/store.js'
import { createServiceRegistry } from '../../dist/runtime/manager/DependencyGraph.js'
import { writeServiceState } from '../../dist/runtime/state/writeState.js'
import { startApiServer } from '../../dist/server/index.js'
import {
  BROKER_LOCKOUT_INVALID_ATTEMPTS,
  BrokerLockoutFixtureError,
  classifyBrokerLockoutAttempt,
  createSafeLockoutFixtureDiagnostic,
  requestBrokerLockoutWithToken,
} from './real-admin-browser-lockout.mjs'
import {
  createSafeRealAdminBrowserTeardownFailure,
  teardownRealAdminBrowserFixture,
} from './real-admin-browser-shutdown.mjs'
import {
  createRealAdminBrowserSampleSource,
  FAIL_NEXT_SAMPLE_START_ENV,
  FAIL_NEXT_SAMPLE_START_PATH,
  handleFailNextSampleStartRequest,
} from './real-admin-browser-rollback.mjs'
import { writeManifest } from '../test-helpers.js'

const sourceBrokerBinary = path.resolve(process.env.SERVICE_LASSO_TEST_BROKER_BINARY ?? '')
const adminRoot = path.resolve(process.env.SERVICE_LASSO_TEST_ADMIN_ROOT ?? '')
if (!sourceBrokerBinary || !adminRoot) throw new Error('Broker binary and Admin root are required.')

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'service-lasso-real-admin-browser-'))
const servicesRoot = path.join(tempRoot, 'services')
const workspaceRoot = path.join(tempRoot, 'workspace')
const sampleRoot = path.join(servicesRoot, 'sample-service')
const sampleStartFailureMarker = path.join(
  workspaceRoot,
  '.service-lasso',
  'test-fixtures',
  'sample-start-failure.once'
)
const brokerBinary = path.join(tempRoot, 'secretsbroker.exe')
const brokerSourcesPath = path.join(tempRoot, 'broker-sources.json')
const brokerWrapperPath = path.join(workspaceRoot, '.service-lasso', 'secretsbroker', 'master-key-wrapper.json')
const lockedBrokerWrapperPath = `${brokerWrapperPath}.locked-fixture`
const browserVaultToken = 'browser-vault-token-sentinel-2026-08-14'
const qualificationMode = ['first-run', 'lockout'].includes(
  process.env.SERVICE_LASSO_REAL_BROWSER_MODE
)
  ? process.env.SERVICE_LASSO_REAL_BROWSER_MODE
  : 'comprehensive'
let apiServer = null
let adminProcess = null
let vaultServer = null
let brokerRuntimeCredentials = null
let shutdownPromise = null
const brokerIPCClient = new http.Agent({ keepAlive: true, maxSockets: 1 })

function safeFailureCode(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string' && /^[a-z0-9_]{1,64}$/i.test(error.code)) {
    return error.code.toLowerCase()
  }
  const message = error instanceof Error ? error.message : ''
  if (/Setup bootstrap returned/u.test(message)) return 'setup_bootstrap_failed'
  if (/Broker was not ready/u.test(message)) return 'broker_not_ready'
  if (/linked secret consumer failed to start/u.test(message)) return 'linked_consumer_start_failed'
  if (/linked secret consumer was not discovered/u.test(message)) return 'linked_consumer_missing'
  if (/inventory was not visible/u.test(message)) return 'broker_inventory_unavailable'
  if (/Timed out waiting/u.test(message)) return 'runtime_readiness_timeout'
  return 'real_admin_browser_start_failed'
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function reservePort() {
  const server = http.createServer()
  const port = await listen(server)
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${new URL(url).pathname}`)
}

function shutdown(exitCode = 0) {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    let resolvedExitCode = exitCode
    try {
      await teardownRealAdminBrowserFixture({
        adminProcess,
        apiServer,
        stopManagedProcesses: stopAllManagedProcesses,
        brokerIPCClient,
        vaultServer,
        resetLifecycle: resetLifecycleState,
        tempRoot,
      })
    } catch (error) {
      resolvedExitCode = 1
      const failure = createSafeRealAdminBrowserTeardownFailure(error)
      await new Promise((resolve) => {
        process.stderr.write(`${JSON.stringify(failure)}\n`, resolve)
      })
    }
    process.exit(resolvedExitCode)
  })()
  return shutdownPromise
}

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))
process.on('message', (message) => {
  if (message?.type === 'service-lasso-real-admin-shutdown') void shutdown(0)
})

try {
  await mkdir(servicesRoot, { recursive: true })
  await mkdir(workspaceRoot, { recursive: true })
  const vaultValues = new Map()
  vaultServer = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (requestUrl.pathname === FAIL_NEXT_SAMPLE_START_PATH) {
      await handleFailNextSampleStartRequest(request, response, sampleStartFailureMarker)
      return
    }
    if (requestUrl.pathname === '/__service_lasso_test/lock-wrapper') {
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST' })
        response.end()
        return
      }
      try {
        await rename(brokerWrapperPath, lockedBrokerWrapperPath)
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ outcome: 'locked_fixture_ready' }))
      } catch {
        response.writeHead(409, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ outcome: 'locked_fixture_failed' }))
      }
      return
    }
    if (requestUrl.pathname === '/__service_lasso_test/unlock-wrapper') {
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST' })
        response.end()
        return
      }
      try {
        await rename(lockedBrokerWrapperPath, brokerWrapperPath)
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ outcome: 'wrapper_restored' }))
      } catch {
        response.writeHead(409, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ outcome: 'wrapper_restore_failed' }))
      }
      return
    }
    if (requestUrl.pathname === '/__service_lasso_test/induce-local-api-lockout') {
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST' })
        response.end()
        return
      }
      brokerRuntimeCredentials ??= await readSecretsBrokerRuntimeCredentials(workspaceRoot)
      if (!brokerRuntimeCredentials) {
        response.writeHead(409, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ outcome: 'broker_credentials_unavailable' }))
        return
      }
      const lockoutDiagnostic = {
        phase: 'readiness',
        attempt: null,
        statusCode: null,
      }
      try {
        let brokerIPCReady = false
        for (let attempt = 0; attempt < 40 && !brokerIPCReady; attempt += 1) {
          lockoutDiagnostic.attempt = attempt + 1
          lockoutDiagnostic.statusCode = null
          try {
            const readiness = await requestBrokerLockoutWithToken(
              brokerRuntimeCredentials,
              brokerRuntimeCredentials.apiToken,
              { agent: brokerIPCClient }
            )
            lockoutDiagnostic.statusCode = readiness.statusCode
            brokerIPCReady = readiness.statusCode === 200
          } catch {}
          if (!brokerIPCReady) {
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
        }
        if (!brokerIPCReady) {
          throw new BrokerLockoutFixtureError(
            'broker_ipc_not_ready',
            'Broker IPC did not become ready for lockout qualification.'
          )
        }
        lockoutDiagnostic.phase = 'invalid_attempt'
        let lockoutScope = null
        for (let attempt = 1; attempt <= BROKER_LOCKOUT_INVALID_ATTEMPTS; attempt += 1) {
          lockoutDiagnostic.attempt = attempt
          lockoutDiagnostic.statusCode = null
          const result = await requestBrokerLockoutWithToken(
            brokerRuntimeCredentials,
            `invalid-browser-lockout-token-${attempt - 1}`,
            { agent: brokerIPCClient }
          )
          lockoutDiagnostic.statusCode = result.statusCode
          const classification = classifyBrokerLockoutAttempt(result, attempt)
          if (classification.state === 'locked') lockoutScope = classification.lockoutScope
        }
        if (!lockoutScope) throw new BrokerLockoutFixtureError(
          'broker_lockout_contract_mismatch',
          'Broker did not enter the expected scoped local API lockout.'
        )
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ outcome: 'lockout_active', lockoutScope }))
      } catch (error) {
        response.writeHead(409, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          outcome: 'lockout_fixture_failed',
          diagnostic: createSafeLockoutFixtureDiagnostic(error, lockoutDiagnostic),
        }))
      }
      return
    }
    if (request.headers['x-vault-token'] !== browserVaultToken) {
      response.writeHead(403, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ errors: ['access denied'] }))
      return
    }
    if (!requestUrl.pathname.startsWith('/v1/secret/data/browser/')) {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ errors: ['not found'] }))
      return
    }
    if (requestUrl.pathname.endsWith('/unavailable')) {
      response.writeHead(503, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ errors: ['provider unavailable'] }))
      return
    }
    const stored = vaultValues.get(requestUrl.pathname)
    if (request.method === 'GET') {
      if (!stored) {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ errors: ['not found'] }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        data: { data: stored.data, metadata: { version: stored.version } },
      }))
      return
    }
    if (request.method === 'POST') {
      if (requestUrl.pathname.endsWith('/policy-denied')) {
        response.writeHead(403, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ errors: ['policy denied'] }))
        return
      }
      const chunks = []
      let byteLength = 0
      for await (const chunk of request) {
        byteLength += chunk.length
        if (byteLength > 1_048_576) {
          response.writeHead(413, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ errors: ['request too large'] }))
          return
        }
        chunks.push(chunk)
      }
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        response.writeHead(400, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ errors: ['invalid json'] }))
        return
      }
      const expectedVersion = stored?.version ?? 0
      if (
        !body ||
        typeof body !== 'object' ||
        !body.data ||
        typeof body.data !== 'object' ||
        body.options?.cas !== expectedVersion
      ) {
        response.writeHead(409, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ errors: ['cas conflict'] }))
        return
      }
      vaultValues.set(requestUrl.pathname, {
        data: structuredClone(body.data),
        version: expectedVersion + 1,
      })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: { version: expectedVersion + 1 } }))
      return
    }
    response.writeHead(405, { Allow: 'GET, POST' })
    response.end()
  })
  const vaultPort = await listen(vaultServer)
  await writeFile(brokerSourcesPath, JSON.stringify({
    sources: [{
      sourceId: 'vault-browser',
      kind: 'vault',
      displayName: 'Browser qualification Vault',
      enabled: true,
      enableMigrationTarget: true,
      critical: false,
      priority: 50,
      namespaces: ['services/sample-service'],
      address: `http://127.0.0.1:${vaultPort}`,
      tokenEnv: 'BROWSER_VAULT_TOKEN',
      refs: {
        'services/sample-service/sample.GENERATED_TOKEN': {
          path: 'secret/data/browser/generated',
          field: 'value',
          timeoutMs: 5_000,
          maxBytes: 1_048_576,
        },
      },
    }, {
      sourceId: 'vault-policy-denied',
      kind: 'vault',
      displayName: 'Vault policy denial fixture',
      enabled: true,
      enableMigrationTarget: true,
      critical: false,
      priority: 55,
      namespaces: ['services/sample-service'],
      address: `http://127.0.0.1:${vaultPort}`,
      tokenEnv: 'BROWSER_VAULT_TOKEN',
      refs: {
        'services/sample-service/sample.GENERATED_TOKEN': {
          path: 'secret/data/browser/policy-denied',
          field: 'value',
          timeoutMs: 5_000,
          maxBytes: 1_048_576,
        },
      },
    }, {
      sourceId: 'vault-unavailable',
      kind: 'vault',
      displayName: 'Vault unavailable fixture',
      enabled: true,
      enableMigrationTarget: true,
      critical: false,
      priority: 56,
      namespaces: ['services/sample-service'],
      address: `http://127.0.0.1:${vaultPort}`,
      tokenEnv: 'BROWSER_VAULT_TOKEN',
      refs: {
        'services/sample-service/sample.GENERATED_TOKEN': {
          path: 'secret/data/browser/unavailable',
          field: 'value',
          timeoutMs: 5_000,
          maxBytes: 1_048_576,
        },
      },
    }, {
      sourceId: 'vault-auth-required',
      kind: 'vault',
      displayName: 'Vault authentication required',
      enabled: true,
      enableMigrationTarget: true,
      critical: false,
      priority: 60,
      namespaces: ['qualification/auth-required'],
      address: `http://127.0.0.1:${vaultPort}`,
      tokenEnv: 'BROWSER_MISSING_VAULT_TOKEN',
      refs: {
        'qualification/auth-required/value': {
          path: 'secret/data/browser/auth-required',
          field: 'value',
        },
      },
    }, {
      sourceId: 'vault-invalid',
      kind: 'vault',
      displayName: 'Vault invalid configuration',
      enabled: true,
      enableMigrationTarget: true,
      critical: false,
      priority: 70,
      namespaces: ['qualification/invalid'],
      tokenEnv: 'BROWSER_VAULT_TOKEN',
      refs: {
        'qualification/invalid/value': {
          path: 'secret/data/browser/invalid',
          field: 'value',
        },
      },
    }],
  }), { mode: 0o600 })
  await copyFile(sourceBrokerBinary, brokerBinary)
  await writeManifest(servicesRoot, '@secretsbroker', {
    id: '@secretsbroker',
    name: 'Secrets Broker',
    description: 'Real browser qualification broker.',
    executable: brokerBinary,
    args: ['serve'],
    env: {
      SECRETSBROKER_MODE: 'production',
      SECRETSBROKER_TRANSPORT: 'auto',
      SECRETSBROKER_SOURCES_PATH: brokerSourcesPath,
      BROWSER_VAULT_TOKEN: browserVaultToken,
    },
    healthcheck: { type: 'process' },
  })
  await mkdir(path.join(sampleRoot, 'runtime'), { recursive: true })
  await writeFile(
    path.join(sampleRoot, 'runtime', 'sample.mjs'),
    createRealAdminBrowserSampleSource()
  )
  await writeManifest(servicesRoot, 'sample-service', {
    id: 'sample-service',
    name: 'Sample Service',
    description: 'Real browser qualification secret owner.',
    executable: process.execPath,
    args: ['runtime/sample.mjs'],
    env: {
      SAMPLE_REQUIRED_TOKEN: '${sample.GENERATED_TOKEN}',
      [FAIL_NEXT_SAMPLE_START_ENV]: sampleStartFailureMarker,
    },
    healthcheck: { type: 'process' },
    broker: {
      imports: [{
        namespace: 'services/sample-service',
        ref: 'sample.GENERATED_TOKEN',
        as: 'SAMPLE_REQUIRED_TOKEN',
        required: true,
        onChange: { mode: 'restart' },
      }],
      accessPolicy: {
        serviceId: 'sample-service',
        workspace: 'local',
        grants: [{ namespace: 'services/sample-service', scope: 'service', refs: ['sample.GENERATED_TOKEN'], operations: ['resolve', 'create'], purpose: 'real browser qualification' }],
      },
      writeback: {
        allowedNamespaces: ['services/sample-service'],
        allowedOperations: ['create'],
        allowedRefs: ['sample.GENERATED_TOKEN'],
        allowOverwrite: false,
        auditReason: 'real browser qualification',
        generatedSecrets: [{ ref: 'sample.GENERATED_TOKEN', source: '${SAMPLE_REQUIRED_TOKEN}', operation: 'create', required: true }],
      },
      exports: [{ namespace: 'services/sample-service', ref: 'sample.GENERATED_TOKEN', source: '${SAMPLE_REQUIRED_TOKEN}', required: true }],
    },
  })

  resetLifecycleState()
  const discovered = await discoverServices(servicesRoot)
  const registry = createServiceRegistry(discovered)
  for (const service of discovered) {
    const state = getLifecycleState(service.manifest.id)
    const prepared = {
      ...state,
      installed: true,
      configured: true,
      installArtifacts: service.manifest.id === '@secretsbroker'
        ? {
            ...state.installArtifacts,
            artifact: {
              sourceType: 'local-fixture',
              repo: null,
              channel: null,
              tag: null,
              assetName: path.basename(brokerBinary),
              assetUrl: null,
              archiveType: null,
              archivePath: null,
              extractedPath: path.dirname(brokerBinary),
              command: brokerBinary,
              args: ['serve'],
              checksum: null,
            },
          }
        : state.installArtifacts,
    }
    setLifecycleState(service.manifest.id, prepared)
    await writeServiceState(service, prepared)
  }

  if (qualificationMode !== 'first-run') {
    await bootstrapSecretsBrokerVault(workspaceRoot, registry)
  }

  apiServer = await startApiServer({
    port: 0,
    host: '127.0.0.1',
    servicesRoot,
    workspaceRoot,
    version: 'real-admin-browser-qualification',
  })
  if (qualificationMode === 'comprehensive') {
    const startResponse = await fetch(`${apiServer.url}/api/services/%40secretsbroker/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: false }),
    })
    if (startResponse.status !== 200) {
      throw new Error('Broker was not ready for comprehensive browser qualification.')
    }
    const brokerRuntime = await loadSecretsBrokerRuntimeContext(workspaceRoot, registry)
    let brokerReady = false
    for (let attempt = 0; attempt < 40 && !brokerReady; attempt += 1) {
      brokerReady = (await brokerRuntime?.probe())?.ready === true
      if (!brokerReady) await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (!brokerReady || !brokerRuntime) {
      throw new Error('Broker was not ready for comprehensive browser qualification.')
    }
    const provisioned = await provisionFirstRunGeneratedSecrets(registry, brokerRuntime)
    if (!provisioned.some((result) => result.serviceId === 'sample-service')) {
      throw new Error('Linked secret consumer failed to start with a provisioned secret.')
    }
  }
  const adminPort = await reservePort()
  adminProcess = spawn(process.execPath, [path.join(adminRoot, 'runtime', 'server.js')], {
    cwd: adminRoot,
    env: {
      ...process.env,
      SERVICE_HOST: '127.0.0.1',
      SERVICE_PORT: String(adminPort),
      SERVICE_LASSO_API_BASE_URL: apiServer.url,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  adminProcess.stderr.on('data', (chunk) => process.stderr.write(chunk))
  await waitFor(`http://127.0.0.1:${adminPort}/`)
  process.stdout.write(`${JSON.stringify({
    contractVersion: 'service-lasso.real-admin-browser.v1',
    platform: process.platform,
    adminUrl: `http://127.0.0.1:${adminPort}`,
    apiUrl: apiServer.url,
    controlUrl: `http://127.0.0.1:${vaultPort}/__service_lasso_test`,
    ref: 'services/sample-service/sample.GENERATED_TOKEN',
    tempRoot,
  })}\n`)
  setInterval(() => {}, 1_000)
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schema: 'service-lasso.real-admin-browser-failure.v1',
    code: safeFailureCode(error),
    causeClass: error instanceof Error ? error.name : 'unknown',
  })}\n`)
  await shutdown(1)
}
