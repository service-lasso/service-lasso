// Local operator helper: secret input only on stdin; signed, create-only Broker IPC.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

try {
  const [coreDirectory, servicesRoot, workspaceRoot, apiOrigin] = process.argv.slice(2);
  if (!apiOrigin) throw Error('Expected Core directory, inventory, workspace and loopback API origin.');
  const api = new URL(apiOrigin);
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.pathname !== '/' || api.username || api.password || api.search || api.hash) throw Error('Use the local Core API origin.');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 1024) throw Error('Input too large.'); }
  let bootstrapPassword;
  try { ({ bootstrapPassword } = JSON.parse(input)); } catch { throw Error('Invalid private input.'); }
  if (typeof bootstrapPassword !== 'string' || bootstrapPassword.length < 12 || bootstrapPassword.length > 69 || !/[A-Z]/.test(bootstrapPassword) || !/[a-z]/.test(bootstrapPassword) || !/[0-9]/.test(bootstrapPassword) || !/[\W_]/.test(bootstrapPassword)) throw Error('Use a 12–69 character password with upper/lowercase, a digit and a symbol.');
  const load = relative => import(pathToFileURL(path.join(path.resolve(coreDirectory), 'dist', relative)).href);
  const { discoverServices } = await load('runtime/discovery/discoverServices.js');
  const { createServiceRegistry } = await load('runtime/manager/DependencyGraph.js');
  const { setLifecycleState } = await load('runtime/lifecycle/store.js');
  const { loadSecretsBrokerRuntimeContext } = await load('runtime/broker/runtime.js');
  const { issueScopedBrokerIdentity, BROKER_IDENTITY_LEASE_ENV } = await load('runtime/broker/identity.js');
  const registry = createServiceRegistry(await discoverServices(path.resolve(servicesRoot)));
  const response = await fetch(new URL('/api/services', api), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error('Core inventory unavailable.');
  const payload = await response.json();
  for (const service of payload.services) if (service.id === '@secretsbroker') setLifecycleState(service.id, service.lifecycle);
  const context = await loadSecretsBrokerRuntimeContext(path.resolve(workspaceRoot), registry);
  if (!context || !(await context.probe()).ready) throw Error('Bootstrap and start the real Broker first.');
  const service = registry.getById('zitadel'), refs = ['identity.ZITADEL_MASTERKEY', 'identity.ZITADEL_BOOTSTRAP_PASSWORD'];
  const policy = service?.manifest.broker?.writeback;
  if (!policy || policy.allowOverwrite !== false || !refs.every(ref => policy.allowedRefs?.includes(ref)) || JSON.stringify(policy.allowedNamespaces) !== '["services/zitadel"]' || JSON.stringify(policy.allowedOperations) !== '["create"]') throw Error('Run the reviewed identity manifest helper first.');
  const identity = () => issueScopedBrokerIdentity(service, { launchLeaseIssuer: context.launchLeaseIssuer, transportBinding: context.transportBinding });
  for (const [ref, value] of [[refs[0], randomBytes(24).toString('base64url')], [refs[1], bootstrapPassword]]) {
    const lookupIdentity = await identity();
    const [decision] = await context.lookup({ service, refs: ['services/zitadel/' + ref], identityLease: JSON.parse(lookupIdentity.env[BROKER_IDENTITY_LEASE_ENV]) });
    if (decision?.status === 'resolved') { console.log(JSON.stringify({ ref, status: 'existing; unchanged' })); continue; }
    if (decision?.status !== 'missing') throw Error('Broker lookup unavailable; no overwrite attempted.');
    const credential = await identity();
    const result = await context.writeback({ serviceId: 'zitadel', namespace: 'services/zitadel', ref, operation: 'create', allowedNamespaces: policy.allowedNamespaces, allowedOperations: policy.allowedOperations, identityExpiresAt: credential.metadata.expiresAt, identityLease: JSON.parse(credential.env[BROKER_IDENTITY_LEASE_ENV]), value });
    if (!result.ok) throw Error('Broker create failed; retain state and inspect safe metadata.');
    console.log(JSON.stringify({ ref, status: 'created' }));
  }
} catch {
  // Never print raw JSON, provider error bodies, credentials or secret values.
  console.error('Identity provisioning failed. Check the local inputs, password policy, declared create-only grants and real Broker readiness. Existing state is preserved.');
  process.exitCode = 1;
}
