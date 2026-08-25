import http from 'node:http'

export const BROKER_LOCKOUT_INVALID_ATTEMPTS = 3
export const BROKER_LOCKOUT_REQUEST_TIMEOUT_MS = 5_000
export const BROKER_LOCKOUT_RESPONSE_MAX_BYTES = 65_536

const SAFE_FAILURE_CODES = new Set([
  'broker_ipc_not_ready',
  'broker_lockout_contract_mismatch',
  'broker_lockout_request_failed',
  'broker_lockout_request_timeout',
  'broker_lockout_response_invalid_json',
  'broker_lockout_response_too_large',
])

const SAFE_PHASES = new Set(['readiness', 'invalid_attempt'])

export class BrokerLockoutFixtureError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BrokerLockoutFixtureError'
    this.code = code
  }
}

function normalizeRequestError(error) {
  if (error instanceof BrokerLockoutFixtureError) return error
  return new BrokerLockoutFixtureError(
    'broker_lockout_request_failed',
    'Broker lockout request failed.'
  )
}

export function requestBrokerLockoutWithToken(
  credentials,
  token,
  {
    agent,
    timeoutMs = BROKER_LOCKOUT_REQUEST_TIMEOUT_MS,
    maxResponseBytes = BROKER_LOCKOUT_RESPONSE_MAX_BYTES,
  } = {}
) {
  return new Promise((resolve, reject) => {
    let settled = false
    let deadlineTimer
    const settleResolve = (value) => {
      if (settled) return
      settled = true
      clearTimeout(deadlineTimer)
      resolve(value)
    }
    const settleReject = (error) => {
      if (settled) return
      settled = true
      clearTimeout(deadlineTimer)
      reject(normalizeRequestError(error))
    }
    const request = http.request({
      method: 'GET',
      path: '/v1/management/lifecycle/status',
      socketPath: credentials.transport.socketPath,
      agent,
      headers: { 'X-SecretsBroker-Token': token },
    }, (response) => {
      const chunks = []
      let byteLength = 0
      response.on('data', (chunk) => {
        byteLength += chunk.length
        if (byteLength > maxResponseBytes) {
          const error = new BrokerLockoutFixtureError(
            'broker_lockout_response_too_large',
            'Broker lockout response exceeded the bounded fixture limit.'
          )
          settleReject(error)
          response.destroy(error)
          request.destroy(error)
          return
        }
        chunks.push(chunk)
      })
      response.once('error', settleReject)
      response.on('end', () => {
        try {
          settleResolve({
            statusCode: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          })
        } catch {
          settleReject(new BrokerLockoutFixtureError(
            'broker_lockout_response_invalid_json',
            'Broker lockout response was not valid JSON.'
          ))
        }
      })
    })
    deadlineTimer = setTimeout(() => request.destroy(new BrokerLockoutFixtureError(
        'broker_lockout_request_timeout',
        'Broker lockout request timed out.'
      )), timeoutMs)
    deadlineTimer.unref?.()
    request.once('error', settleReject)
    request.end()
  })
}

export function classifyBrokerLockoutAttempt(result, attempt) {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    attempt > BROKER_LOCKOUT_INVALID_ATTEMPTS
  ) {
    throw new BrokerLockoutFixtureError(
      'broker_lockout_contract_mismatch',
      'Broker lockout attempt was outside the bounded fixture contract.'
    )
  }
  const error = result?.body?.error
  if (attempt < BROKER_LOCKOUT_INVALID_ATTEMPTS) {
    if (
      result?.statusCode === 401 &&
      error?.code === 'unauthorized' &&
      error?.outcome === 'policy_denied' &&
      error?.nextAction === 'authenticate_local_session'
    ) {
      return { state: 'progressing' }
    }
    throw new BrokerLockoutFixtureError(
      'broker_lockout_contract_mismatch',
      'Broker returned an unexpected pre-lockout contract.'
    )
  }

  const lockoutScope = error?.lockoutScope
  if (
    attempt === BROKER_LOCKOUT_INVALID_ATTEMPTS &&
    result?.statusCode === 423 &&
    error?.code === 'lockout_active' &&
    error?.outcome === 'policy_denied' &&
    error?.nextAction === 'wait_or_clear_lockout' &&
    error?.lockoutActive === true &&
    typeof lockoutScope === 'string' &&
    lockoutScope.startsWith('local_api:')
  ) {
    return { state: 'locked', lockoutScope }
  }

  throw new BrokerLockoutFixtureError(
    'broker_lockout_contract_mismatch',
    'Broker returned an unexpected lockout contract.'
  )
}

export function createSafeLockoutFixtureDiagnostic(error, context = {}) {
  return {
    phase: SAFE_PHASES.has(context.phase) ? context.phase : 'unknown',
    attempt: Number.isSafeInteger(context.attempt) && context.attempt > 0
      ? context.attempt
      : null,
    statusCode: Number.isSafeInteger(context.statusCode) &&
      context.statusCode >= 100 &&
      context.statusCode <= 599
      ? context.statusCode
      : null,
    failureCode: SAFE_FAILURE_CODES.has(error?.code)
      ? error.code
      : 'broker_lockout_request_failed',
  }
}
