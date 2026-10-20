import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [directory, certificateImports, databaseName = 'zitadel_todo'] = process.argv.slice(2);
if (!directory || !certificateImports || !/^[a-z][a-z0-9_]{0,62}$/.test(databaseName)) throw Error('Use configure-identity.mjs <tutorial-services-root> <certificate-import-root> [new-identity-database-name]; stop app services first.');
const root = path.resolve(directory);
const expected = [
  ['@localcert', 'lasso-localcert', '2026.9.25-588398b'],
  ['postgres', 'lasso-postgres', '2026.10.4-1af7982'],
  ['zitadel', 'lasso-zitadel', '2026.9.25-93d4c84']
];
const manifests = await Promise.all(expected.map(async ([id, repo, tag]) => {
  const inputFile = path.join(id === '@localcert' ? path.resolve(certificateImports) : root, id, 'service.json');
  const file = path.join(root, id === '@localcert' ? '@todo-certs' : id, 'service.json'), manifest = JSON.parse(await readFile(inputFile, 'utf8'));
  if (manifest.id !== id || manifest.artifact?.source?.repo !== `service-lasso/${repo}` || manifest.artifact.source.tag !== tag) throw Error(`Import the tutorial's exact ${repo} release first; no files changed.`);
  return { file, manifest };
}));
const [certificate, postgres, identity] = manifests.map(entry => entry.manifest);
certificate.id = '@todo-certs';
certificate.name = 'Todo Certificates';
certificate.depend_on = (certificate.depend_on ?? []).filter(id => id !== '@java');
Object.assign(certificate.env, { CERTS_DOMAINS: 'localhost 127.0.0.1', TRUST_STORES: '' });
certificate.globalenv = { TODO_CERT_FILE: '${SERVICE_DATA_PATH}/mkcert.pem', TODO_CERT_KEY: '${SERVICE_DATA_PATH}/mkcert.key' };
for (const step of ['generate-pfx', 'generate-key-cert']) {
  const commands = certificate.setup?.steps?.[step]?.commandline;
  if (!commands) throw Error('Unexpected certificate package; no files changed.');
  for (const platform of Object.keys(commands)) commands[platform] = commands[platform].replace(/\s-client(?=\s|$)/g, '');
  const configuration = certificate.setup.steps[step];
  if (configuration.depend_on) configuration.depend_on = configuration.depend_on.map(value => value.replace('@localcert:', '@todo-certs:'));
}
postgres.env.POSTGRES_DATABASES = [...new Set([...(postgres.env.POSTGRES_DATABASES ?? 'postgres').split(',').map(value => value.trim()).filter(Boolean), databaseName])].join(',');
identity.enabled = true;
identity.depend_on = ['postgres', '@todo-certs'];
identity.ports = { http: 18084 };
identity.commandline = Object.fromEntries(['win32', 'darwin', 'linux', 'default'].map(platform => [platform, ' start-from-init --masterkeyFromEnv --tlsMode enabled']));
Object.assign(identity.env, {
  ZITADEL_PORT: '${HTTP_PORT}', ZITADEL_EXTERNALPORT: '${HTTP_PORT}', ZITADEL_EXTERNALDOMAIN: 'localhost',
  ZITADEL_EXTERNALSECURE: 'true', ZITADEL_TLS_ENABLED: 'true',
  ZITADEL_TLS_CERTPATH: '${TODO_CERT_FILE}', ZITADEL_TLS_KEYPATH: '${TODO_CERT_KEY}',
  ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED: 'false',
  ZITADEL_DATABASE_POSTGRES_DSN: `postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@\${POSTGRES_HOST}:\${POSTGRES_PORT}/${databaseName}?sslmode=disable`,
  ZITADEL_MASTERKEY: '${identity.ZITADEL_MASTERKEY}',
  ZITADEL_FIRSTINSTANCE_ORG_NAME: 'Todo Tutorial',
  ZITADEL_FIRSTINSTANCE_ORG_HUMAN_USERNAME: 'todo-admin',
  ZITADEL_FIRSTINSTANCE_ORG_HUMAN_FIRSTNAME: 'Todo', ZITADEL_FIRSTINSTANCE_ORG_HUMAN_LASTNAME: 'Admin',
  ZITADEL_FIRSTINSTANCE_ORG_HUMAN_EMAIL_ADDRESS: 'todo-admin@localhost.test',
  ZITADEL_FIRSTINSTANCE_ORG_HUMAN_EMAIL_VERIFIED: 'true',
  ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD: '${identity.ZITADEL_BOOTSTRAP_PASSWORD}',
  ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORDCHANGEREQUIRED: 'false'
});
identity.globalenv = { ...(identity.globalenv ?? {}), ZITADEL_ISSUER: 'https://localhost:${HTTP_PORT}', ZITADEL_URL: 'https://localhost:${HTTP_PORT}/', ZITADEL_HEALTH_URL: 'https://localhost:${HTTP_PORT}/debug/ready' };
identity.broker = {
  enabled: true, namespace: 'services/zitadel',
  writeback: { allowedNamespaces: ['services/zitadel'], allowedOperations: ['create'], allowedRefs: ['identity.ZITADEL_MASTERKEY', 'identity.ZITADEL_BOOTSTRAP_PASSWORD'], allowOverwrite: false },
  buckets: [{ namespace: 'services/zitadel', kind: 'service', description: 'Stable identity master key and first-instance bootstrap credential.' }],
  imports: ['ZITADEL_MASTERKEY', 'ZITADEL_BOOTSTRAP_PASSWORD'].map(name => ({ namespace: 'services/zitadel', ref: `identity.${name}`, as: name, required: true }))
};
identity.healthcheck = { id: 'identity-ready', type: 'http', url: 'https://localhost:${HTTP_PORT}/debug/ready', expected_status: 200, retries: 80, interval: 500 };
delete identity.healthchecks;
identity.urls = [{ label: 'console', url: 'https://localhost:${HTTP_PORT}/ui/console/', kind: 'local' }, { label: 'issuer', url: 'https://localhost:${HTTP_PORT}', kind: 'local' }];
for (const entry of manifests) {
  for (const platform of Object.values(entry.manifest.artifact.platforms)) platform.checksum = { algorithm: 'sha256', assetName: 'SHA256SUMS.txt' };
  delete entry.manifest.artifact.source.channel;
  await mkdir(path.dirname(entry.file), { recursive: true });
  await writeFile(entry.file, JSON.stringify(entry.manifest, null, 2) + '\n');
}
console.log('Identity manifests configured. No database, secret or trust store changed. Provision Broker secrets and the certificate before start.');
