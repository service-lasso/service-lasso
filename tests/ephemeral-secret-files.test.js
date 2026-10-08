import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, statfs, symlink, link, writeFile } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { validateServiceManifest } from "../dist/runtime/discovery/validateManifest.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { installService, configService, startService, stopService } from "../dist/runtime/lifecycle/actions.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { rehydrateLifecycleState } from "../dist/runtime/state/rehydrate.js";
import { writeServiceState } from "../dist/runtime/state/writeState.js";
import { serviceSecretsDirectory, writeEphemeralSecretFile } from "../dist/runtime/broker/secret-files.js";
import { materializeConfigArtifacts, materializeEphemeralSecretFiles } from "../dist/runtime/setup/materialize.js";
import { buildServiceConfigDriftReport } from "../dist/runtime/operator/config-drift.js";
import { makeTempServicesRoot } from "./test-helpers.js";

const fragment = {
  id: "secret-file-app", name: "Secret file app", description: "Synthetic secret-file consumer",
  config: { files: [{ path: "password", content: "${database.PASSWORD}", ephemeral: true }] },
};

test("ESM-1 manifest preserves config ephemeral flags and rejects invalid/install declarations", () => {
  const parsed = validateServiceManifest(fragment, "service.json");
  assert.equal(parsed.config.files[0].ephemeral, true);
  for (const ephemeral of ["true", 1, null]) {
    assert.throws(() => validateServiceManifest({ ...fragment,
      config: { files: [{ ...fragment.config.files[0], ephemeral }] } }, "service.json"), /boolean/);
  }
  assert.throws(() => validateServiceManifest({ ...fragment, install: fragment.config }, "service.json"), /belong in config/);
  const template = validateServiceManifest({ ...fragment,
    config: { templates: [{ source: "template", target: "password", ephemeral: true }] } }, "service.json");
  assert.equal(template.config.templates[0].ephemeral, true);
});

async function withLinuxFixture(run) {
  const previous = process.env.SERVICE_LASSO_SECRETS_ROOT;
  const previousTransport = process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;
  process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT = "tmpfs";
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-ephemeral-");
  // A fresh private directory on an existing tmpfs; no host mount mutation.
  const secretsRoot = await mkdtemp("/dev/shm/service-lasso-secret-test-");
  assert.equal((await statfs(secretsRoot)).type, 0x01021994);
  process.env.SERVICE_LASSO_SECRETS_ROOT = secretsRoot;
  resetLifecycleState();
  const serviceRoot = path.join(servicesRoot, fragment.id);
  await mkdir(serviceRoot);
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify({ ...fragment,
    executable: process.execPath, args: ["app.mjs"],
    env: { DB_PASSWORD: "${database.PASSWORD}", DB_PASSWORD_FILE: "${SERVICE_LASSO_SECRETS_DIR}/password" },
    broker: { imports: [{ namespace: "shared/database", ref: "database.PASSWORD", required: true }] },
  }));
  const leaseScript = path.join(tempRoot, "lease.mjs");
  await writeFile(leaseScript, 'process.stdout.write(JSON.stringify({outcome:"ready",lease:{fixture:true}}));');
  let value = "synthetic-first-secret";
  let status = "resolved";
  const lookup = ({ refs }) => refs.map((ref) => ({ ref, status, ...(status === "resolved" ? { value } : {}) }));
  const options = { brokerLookup: lookup, brokerRuntime: {
    lookup, serverEnv: {}, transportBinding: null,
    launchLeaseIssuer: { workspaceId: "test-workspace", command: {
      command: process.execPath, args: [leaseScript], env: { ...process.env, SECRETSBROKER_API_TOKEN: "synthetic-test-token" },
    } },
  } };
  const registry = createServiceRegistry(await discoverServices(servicesRoot));
  const service = registry.getById(fragment.id);
  assert.ok(service);
  try {
    await run({ service, registry, options, tempRoot, secretsRoot,
      setValue: (next) => { value = next; }, setStatus: (next) => { status = next; } });
  } finally {
    if (getLifecycleState(fragment.id).running) await stopService(service);
    resetLifecycleState();
    if (previous === undefined) delete process.env.SERVICE_LASSO_SECRETS_ROOT;
    else process.env.SERVICE_LASSO_SECRETS_ROOT = previous;
    if (previousTransport === undefined) delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;
    else process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT = previousTransport;
    await rm(secretsRoot, { recursive: true, force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const linuxOnly = { skip: process.platform !== "linux" };
async function waitForConsumption(service) {
  const target = path.join(service.serviceRoot, "consumed.json");
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(target, "utf8")); }
    catch (error) { if (!["ENOENT"].includes(error.code) && !(error instanceof SyntaxError)) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("App did not consume its supplied secret-file path.");
}

test("ESM-2/4 real app receives Core path and fresh env/file secrets after persisted-state restart", linuxOnly, async () => {
  await withLinuxFixture(async ({ service, registry, options, setValue }) => {
    await writeFile(path.join(service.serviceRoot, "app.mjs"), `
      import {readFileSync,writeFileSync} from 'node:fs';
      const file = process.env.DB_PASSWORD_FILE;
      writeFileSync('consumed.json', JSON.stringify({matches:readFileSync(file,'utf8')===process.env.DB_PASSWORD, file}));
      setInterval(()=>{},1000);
    `);
    await installService(service, registry);
    await configService(service, registry, options);
    await assert.rejects(readFile(path.join(service.serviceRoot, "password")), { code: "ENOENT" });
    let started = await startService(service, registry, options);
    let consumed = await waitForConsumption(service);
    const directory = serviceSecretsDirectory(service);
    assert.deepEqual(consumed, { matches: true, file: path.join(directory, "password") });
    assert.equal((await lstat(consumed.file)).mode & 0o777, 0o600);
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    assert.equal(await readFile(consumed.file, "utf8"), "synthetic-first-secret");
    assert.deepEqual(started.state.configArtifacts.files, []);
    assert.equal((await buildServiceConfigDriftReport(service, registry.list())).summary.total, 0);
    await stopService(service);
    await writeServiceState(service, getLifecycleState(service.manifest.id));
    await rm(directory, { recursive: true });
    await rm(path.join(service.serviceRoot, "consumed.json"));
    resetLifecycleState();
    await rehydrateLifecycleState(service);
    assert.equal(getLifecycleState(service.manifest.id).configured, true);
    setValue("synthetic-rotated-secret");
    started = await startService(service, registry, options);
    consumed = await waitForConsumption(service);
    assert.equal(consumed.matches, true);
    assert.equal(await readFile(consumed.file, "utf8"), "synthetic-rotated-secret");
    assert.equal(JSON.stringify(started.state).includes("synthetic-rotated-secret"), false);
  });
});

test("ESM-3 unavailable Broker and persistent disk block before app spawn", linuxOnly, async () => {
  await withLinuxFixture(async ({ service, registry, options, tempRoot, setStatus }) => {
    await writeFile(path.join(service.serviceRoot, "app.mjs"), "throw new Error('must not launch');");
    await installService(service, registry);
    await configService(service, registry, options);
    setStatus("policy-denied");
    await assert.rejects(startService(service, registry, options), /Broker|broker/);
    assert.equal(getLifecycleState(service.manifest.id).runtime.pid, null);
    setStatus("resolved");
    process.env.SERVICE_LASSO_SECRETS_ROOT = tempRoot;
    await assert.rejects(startService(service, registry, options), /Ephemeral secret-file preparation failed/);
    assert.equal(getLifecycleState(service.manifest.id).runtime.pid, null);
  });
});

test("ESM-3/4 template outputs stay private and never call persistent preimage hooks", linuxOnly, async () => {
  await withLinuxFixture(async ({ service }) => {
    await writeFile(path.join(service.serviceRoot, "template"), "password=${database.PASSWORD}");
    service.manifest.config = { templates: [{ source: "template", target: "nested/credentials", ephemeral: true }] };
    await materializeConfigArtifacts(service, {}, {}, {}, {
      beforeWrite() { throw new Error("Ephemeral output entered persistent preimages"); }, afterWrite() {},
    });
    await materializeEphemeralSecretFiles(service, {}, {}, { brokerValues: { "database.PASSWORD": "synthetic-template-secret" } });
    const target = path.join(serviceSecretsDirectory(service), "nested/credentials");
    assert.equal(await readFile(target, "utf8"), "password=synthetic-template-secret");
    assert.equal((await lstat(target)).mode & 0o777, 0o600);
    assert.equal((await lstat(path.dirname(target))).mode & 0o777, 0o700);
    await assert.rejects(materializeEphemeralSecretFiles(service, {}, {}, {}), /Ephemeral secret-file preparation failed/);
  });
});

test("ESM-3 refuses redirected directories, linked targets and path escape", linuxOnly, async () => {
  await withLinuxFixture(async ({ service, secretsRoot }) => {
    await writeEphemeralSecretFile(service, "password", "synthetic");
    const directory = serviceSecretsDirectory(service);
    await symlink(secretsRoot, path.join(directory, "redirect"));
    await assert.rejects(writeEphemeralSecretFile(service, "redirect/password", "new"));
    await symlink(path.join(directory, "password"), path.join(directory, "alias"));
    await assert.rejects(writeEphemeralSecretFile(service, "alias", "new"));
    await link(path.join(directory, "password"), path.join(directory, "hardlink"));
    await assert.rejects(writeEphemeralSecretFile(service, "password", "new"));
    await assert.rejects(writeEphemeralSecretFile(service, "../escape", "new"));
    assert.equal(await readFile(path.join(directory, "password"), "utf8"), "synthetic");
  });
});

test("ESM-3 refuses a public secrets root and an app-owned root", linuxOnly, async () => {
  await withLinuxFixture(async ({ service, secretsRoot }) => {
    await chmod(secretsRoot, 0o755);
    await assert.rejects(writeEphemeralSecretFile(service, "password", "synthetic"), /private tmpfs/);
    await chmod(secretsRoot, 0o700);
    process.env.SERVICE_LASSO_SECRETS_ROOT = service.serviceRoot;
    await assert.rejects(writeEphemeralSecretFile(service, "password", "synthetic"), /outside the app/);
  });
});
