import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import {
  createSafeRealAdminBrowserTeardownFailure,
  teardownRealAdminBrowserFixture,
} from './real-admin-browser-shutdown.mjs'

const evidenceRoot = path.resolve(process.env.SERVICE_LASSO_TEST_SHUTDOWN_EVIDENCE_ROOT ?? '')
if (!evidenceRoot) throw new Error('Shutdown evidence root is required.')
await mkdir(evidenceRoot, { recursive: true })

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'service-lasso-real-admin-shutdown-'))
const lateWritePath = path.join(tempRoot, 'late-managed-finalizer.json')
const managedEvidencePath = path.join(evidenceRoot, 'managed-exit.json')
const adminEvidencePath = path.join(evidenceRoot, 'admin-exit.json')
const reportPhase = (phase) => process.send?.({ type: 'phase', phase })

const adminChild = spawn(process.execPath, ['--input-type=module', '-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
  windowsHide: true,
})
const adminProcess = new EventEmitter()
adminProcess.exitCode = null
adminProcess.signalCode = null
const adminSignals = []
adminProcess.kill = (signal) => {
  adminSignals.push(signal)
  if (signal === 'SIGTERM') return true
  return adminChild.kill(signal)
}
adminChild.once('error', (error) => adminProcess.emit('error', error))
adminChild.once('exit', (code, signal) => {
  setTimeout(() => {
    void writeFile(adminEvidencePath, JSON.stringify({
      outcome: 'admin_exited',
      signals: adminSignals,
      completedAt: Date.now(),
    })).finally(() => {
      adminProcess.exitCode = code
      adminProcess.signalCode = signal
      reportPhase('admin_exited')
      adminProcess.emit('exit', code, signal)
    })
  }, 100)
})

const managedSource = String.raw`
  import { mkdir, writeFile } from "node:fs/promises";
  import path from "node:path";
  import { setTimeout as delay } from "node:timers/promises";
  const heartbeat = setInterval(() => {}, 1000);
  let stopping = false;
  process.on("message", async (message) => {
    if (message?.type !== "shutdown" || stopping) return;
    stopping = true;
    await delay(300);
    await mkdir(path.dirname(process.env.LATE_WRITE_PATH), { recursive: true });
    await writeFile(process.env.LATE_WRITE_PATH, JSON.stringify({ outcome: "late_write_completed" }));
    await writeFile(process.env.MANAGED_EVIDENCE_PATH, JSON.stringify({
      outcome: "managed_child_exited",
      completedAt: Date.now()
    }));
    process.send({ type: "finalized" });
    clearInterval(heartbeat);
    process.exit(0);
  });
  process.send({ type: "ready" });
`
const managedChild = spawn(process.execPath, ['--input-type=module', '-e', managedSource], {
  env: {
    ...process.env,
    LATE_WRITE_PATH: lateWritePath,
    MANAGED_EVIDENCE_PATH: managedEvidencePath,
  },
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  windowsHide: true,
})
await once(managedChild, 'message')
let managedShutdownSent = false
let managedExit = null
managedChild.on('message', (message) => {
  if (message?.type === 'finalized') reportPhase('managed_finalizer_completed')
})
const managedClosed = new Promise((resolve, reject) => {
  managedChild.once('error', reject)
  managedChild.once('exit', (code, signal) => {
    managedExit = { code, signal }
    resolve(managedExit)
  })
})
const requestManagedShutdown = () => {
  if (managedShutdownSent || managedExit) return
  managedShutdownSent = true
  reportPhase('managed_finalizer_started')
  managedChild.send({ type: 'shutdown' })
}

const apiHttpServer = http.createServer((_request, response) => response.end('ok'))
apiHttpServer.listen(0, '127.0.0.1')
await once(apiHttpServer, 'listening')
const apiServer = {
  server: apiHttpServer,
  stop: async () => reportPhase('api_stop_completed'),
}

let shutdownPromise = null
function shutdown() {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    let exitCode = 0
    try {
      reportPhase('teardown_started')
      await teardownRealAdminBrowserFixture({
        adminProcess,
        apiServer,
        stopManagedProcesses: async () => {
          reportPhase('managed_convergence_started')
          requestManagedShutdown()
          await managedClosed
          reportPhase('managed_convergence_completed')
        },
        brokerIPCClient: { destroy() {} },
        vaultServer: null,
        resetLifecycle() {
          reportPhase('lifecycle_reset_completed')
        },
        tempRoot,
        timeouts: {
          adminGracefulExitTimeoutMs: 100,
          adminForcedExitTimeoutMs: 2_000,
          serverCloseTimeoutMs: 2_000,
          tempCleanupTimeoutMs: 5_000,
        },
      })
      reportPhase('teardown_completed')
    } catch (error) {
      exitCode = 1
      process.stderr.write(`${JSON.stringify(createSafeRealAdminBrowserTeardownFailure(error))}\n`)
    }
    process.exit(exitCode)
  })()
  return shutdownPromise
}

process.on('message', (message) => {
  if (message?.type === 'service-lasso-real-admin-shutdown') void shutdown()
})
process.on('SIGTERM', () => void shutdown())
process.send({
  type: 'ready',
  tempRoot,
  adminPid: adminChild.pid,
  managedPid: managedChild.pid,
  apiPort: apiHttpServer.address().port,
})
setInterval(() => {}, 1_000)
