import { access, rm } from 'node:fs/promises'

const DEFAULT_ADMIN_GRACEFUL_EXIT_TIMEOUT_MS = 5_000
const DEFAULT_ADMIN_FORCED_EXIT_TIMEOUT_MS = 5_000
const DEFAULT_SERVER_CLOSE_TIMEOUT_MS = 5_000
const DEFAULT_TEMP_CLEANUP_TIMEOUT_MS = 90_000

const SAFE_TEARDOWN_PHASES = new Set([
  'admin_terminate',
  'admin_force_kill',
  'admin_exit_wait',
  'api_server_stop',
  'managed_process_convergence',
  'api_server_close',
  'broker_ipc_close',
  'vault_server_close',
  'lifecycle_reset',
  'temp_root_cleanup',
])

function safeErrorCode(error, fallback) {
  const code = error && typeof error === 'object' ? error.code : null
  return typeof code === 'string' && /^[a-z0-9_]{1,64}$/i.test(code)
    ? code.toLowerCase()
    : fallback
}

function safeFailure(phase, error, fallbackCode) {
  return {
    phase: SAFE_TEARDOWN_PHASES.has(phase) ? phase : 'temp_root_cleanup',
    code: safeErrorCode(error, fallbackCode),
  }
}

function childHasExited(child) {
  return child?.exitCode !== null || child?.signalCode !== null
}

function waitForChildExit(child, timeoutMs) {
  if (!child || childHasExited(child)) return Promise.resolve(true)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (result, error = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('error', onError)
      if (error) reject(error)
      else resolve(result)
    }
    const onExit = () => finish(true)
    const onError = (error) => finish(false, error)
    const timer = setTimeout(() => finish(childHasExited(child)), timeoutMs)
    timer.unref?.()
    child.once('exit', onExit)
    child.once('error', onError)
    if (childHasExited(child)) finish(true)
  })
}

async function stopAdminProcess(child, timeouts) {
  const failures = []
  if (!child || childHasExited(child)) return { exited: true, failures }

  const gracefulExit = waitForChildExit(child, timeouts.adminGracefulExitTimeoutMs)
  try {
    if (!child.kill('SIGTERM') && !childHasExited(child)) {
      failures.push(safeFailure('admin_terminate', null, 'admin_terminate_failed'))
    }
  } catch (error) {
    failures.push(safeFailure('admin_terminate', error, 'admin_terminate_failed'))
  }
  try {
    if (await gracefulExit) return { exited: true, failures }
  } catch (error) {
    failures.push(safeFailure('admin_exit_wait', error, 'admin_exit_wait_failed'))
  }

  const forcedExit = waitForChildExit(child, timeouts.adminForcedExitTimeoutMs)
  try {
    if (!child.kill('SIGKILL') && !childHasExited(child)) {
      failures.push(safeFailure('admin_force_kill', null, 'admin_force_kill_failed'))
    }
  } catch (error) {
    failures.push(safeFailure('admin_force_kill', error, 'admin_force_kill_failed'))
  }
  try {
    if (!(await forcedExit)) {
      failures.push(safeFailure('admin_exit_wait', null, 'admin_exit_timeout'))
    }
  } catch (error) {
    failures.push(safeFailure('admin_exit_wait', error, 'admin_exit_wait_failed'))
  }
  return { exited: childHasExited(child), failures }
}

async function closeServer(server, timeoutMs) {
  if (!server) return
  let timer
  const closed = new Promise((resolve, reject) => {
    try {
      server.close((error) => {
        if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') resolve()
        else reject(error)
      })
      server.closeIdleConnections?.()
      server.closeAllConnections?.()
    } catch (error) {
      if (error?.code === 'ERR_SERVER_NOT_RUNNING') resolve()
      else reject(error)
    }
  })
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Server close did not complete within the bounded teardown window.')
      error.code = 'server_close_timeout'
      reject(error)
    }, timeoutMs)
    timer.unref?.()
  })
  try {
    await Promise.race([closed, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function removeTempRootBoundedly(tempRoot, timeoutMs, removeTempRoot) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await removeTempRoot(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 250,
      })
      try {
        await access(tempRoot)
        const error = new Error('Temporary root still exists after fixture teardown.')
        error.code = 'temp_root_still_present'
        throw error
      } catch (error) {
        if (error?.code === 'ENOENT') return
        throw error
      }
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

export class RealAdminBrowserTeardownError extends Error {
  constructor(failures) {
    super('Real Admin browser fixture teardown failed.')
    this.name = 'RealAdminBrowserTeardownError'
    this.code = 'real_admin_browser_teardown_failed'
    this.failures = failures.map(({ phase, code }) => ({ phase, code }))
  }
}

export function createSafeRealAdminBrowserTeardownFailure(error) {
  const failures = error instanceof RealAdminBrowserTeardownError
    ? error.failures
    : [safeFailure('temp_root_cleanup', error, 'teardown_failed')]
  return {
    schema: 'service-lasso.real-admin-browser-teardown-failure.v1',
    code: 'real_admin_browser_teardown_failed',
    causeClass: 'teardown_failure',
    failures: failures.map(({ phase, code }) => ({ phase, code })),
  }
}

export async function teardownRealAdminBrowserFixture({
  adminProcess,
  apiServer,
  stopManagedProcesses,
  brokerIPCClient,
  vaultServer,
  resetLifecycle,
  tempRoot,
  removeTempRoot = rm,
  timeouts: timeoutOverrides = {},
}) {
  const timeouts = {
    adminGracefulExitTimeoutMs: DEFAULT_ADMIN_GRACEFUL_EXIT_TIMEOUT_MS,
    adminForcedExitTimeoutMs: DEFAULT_ADMIN_FORCED_EXIT_TIMEOUT_MS,
    serverCloseTimeoutMs: DEFAULT_SERVER_CLOSE_TIMEOUT_MS,
    tempCleanupTimeoutMs: DEFAULT_TEMP_CLEANUP_TIMEOUT_MS,
    ...timeoutOverrides,
  }
  const adminStop = await stopAdminProcess(adminProcess, timeouts)
  const failures = [...adminStop.failures]

  if (apiServer?.stop) {
    try {
      await apiServer.stop()
    } catch (error) {
      failures.push(safeFailure('api_server_stop', error, 'api_server_stop_failed'))
    }
  }
  let managedProcessesConverged = false
  try {
    await stopManagedProcesses()
    managedProcessesConverged = true
  } catch (error) {
    failures.push(safeFailure('managed_process_convergence', error, 'managed_process_convergence_failed'))
  }
  let apiServerClosed = !apiServer?.server
  try {
    await closeServer(apiServer?.server, timeouts.serverCloseTimeoutMs)
    apiServerClosed = true
  } catch (error) {
    failures.push(safeFailure('api_server_close', error, 'api_server_close_failed'))
  }
  let brokerIPCClosed = true
  try {
    brokerIPCClient?.destroy()
  } catch (error) {
    brokerIPCClosed = false
    failures.push(safeFailure('broker_ipc_close', error, 'broker_ipc_close_failed'))
  }
  let vaultServerClosed = !vaultServer
  try {
    await closeServer(vaultServer, timeouts.serverCloseTimeoutMs)
    vaultServerClosed = true
  } catch (error) {
    failures.push(safeFailure('vault_server_close', error, 'vault_server_close_failed'))
  }
  try {
    resetLifecycle()
  } catch (error) {
    failures.push(safeFailure('lifecycle_reset', error, 'lifecycle_reset_failed'))
  }
  if (
    adminStop.exited &&
    managedProcessesConverged &&
    apiServerClosed &&
    brokerIPCClosed &&
    vaultServerClosed
  ) {
    try {
      await removeTempRootBoundedly(tempRoot, timeouts.tempCleanupTimeoutMs, removeTempRoot)
    } catch (error) {
      failures.push(safeFailure('temp_root_cleanup', error, 'temp_root_cleanup_failed'))
    }
  }

  if (failures.length > 0) throw new RealAdminBrowserTeardownError(failures)
}
