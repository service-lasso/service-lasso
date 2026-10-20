import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { materializeInstallArtifacts, materializeConfigArtifacts, materializeEphemeralSecretFiles } from "../dist/runtime/setup/materialize.js";
import { buildServiceMutationDefinitionBinding } from "../dist/runtime/setup/definition-revision.js";
import { buildServiceConfigDriftReport } from "../dist/runtime/operator/config-drift.js";
import { resolveServiceStartupBrokerResolution } from "../dist/runtime/broker/launch-resolution.js";
import { serviceNeedsScopedBrokerIdentity } from "../dist/runtime/broker/identity.js";
import { compileServiceMaterializationSelectorPlan } from "../dist/runtime/operator/variables.js";
import { buildServiceSecretReferenceAudit } from "../dist/runtime/operator/secret-audit.js";
import { makeTempServicesRoot } from "./test-helpers.js";

test("ESM-14 mixed ordinary config and Broker outputs retain separate ownership and recovery hooks", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("broker-config-boundary-");
  const previous = process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;
  delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT;
  try {
    const root = path.join(servicesRoot, "app"); await mkdir(root);
    await writeFile(path.join(root, "ordinary.tmpl"), "mode=${MODE}");
    await writeFile(path.join(root, "secret.tmpl"), "key=${app.KEY}");
    await writeFile(path.join(root, "service.json"), JSON.stringify({
      id: "app", name: "App", description: "Mixed ownership fixture", env: { MODE: "local" },
      install: { files: [{ path: "installed", content: "installed" }] },
      config: { files: [{ path: "config.json", content: "${MODE}" }], templates: [{ source: "ordinary.tmpl", target: "ordinary.conf" }] },
      broker: { imports: [{ namespace: "shared/app", ref: "app.KEY", required: true }],
        files: [{ path: "private/key", content: "${app.KEY}" }], templates: [{ source: "secret.tmpl", target: "private/template" }] },
    }));
    const [service] = await discoverServices(servicesRoot);
    assert.equal(serviceNeedsScopedBrokerIdentity(service), true);
    const plan = compileServiceMaterializationSelectorPlan(service);
    assert.ok(plan.brokerRefs.includes("app.KEY"));
    const audit = buildServiceSecretReferenceAudit(service);
    assert.ok(audit.findings.some(row => row.source === "broker.files" && row.ref === "app.KEY"));
    const binding = await buildServiceMutationDefinitionBinding(service);
    assert.deepEqual(Object.keys(binding.templateDigests).sort(), ["ordinary.tmpl", "secret.tmpl"]);
    const writes = [], finished = [];
    const hooks = { beforeWrite(input) { writes.push(input.relativePath); return input.relativePath; }, afterWrite(id) { finished.push(id); } };
    assert.deepEqual((await materializeInstallArtifacts(service, {}, {}, {}, hooks)).files, ["installed"]);
    assert.deepEqual((await materializeConfigArtifacts(service, {}, {}, {}, hooks, binding.templateDigests)).files, ["config.json", "ordinary.conf"]);
    assert.deepEqual(writes, ["installed", "config.json", "ordinary.conf"]); assert.deepEqual(finished, writes);
    assert.equal(await readFile(path.join(root, "ordinary.conf"), "utf8"), "mode=local");
    const resolution = await resolveServiceStartupBrokerResolution(service, () => assert.fail("file-only secret returned to Core"));
    assert.deepEqual(resolution.plan.brokerRefs, []);
    let sent;
    await materializeEphemeralSecretFiles(service, {}, {}, {}, binding.templateDigests, async outputs => { sent = outputs; return "private-directory"; });
    assert.deepEqual(sent, [{ path: "private/key", content: "${app.KEY}" }, { path: "private/template", content: "key=${app.KEY}" }]);
    await assert.rejects(readFile(path.join(root, "private/key")), { code: "ENOENT" });
    const report = await buildServiceConfigDriftReport(service, [service]);
    assert.equal(report.summary.total, 1); assert.equal(report.files[0].status, "unchanged");
    await writeFile(path.join(root, "config.json"), "changed");
    assert.equal((await buildServiceConfigDriftReport(service, [service])).summary.drifted, 1);
    await writeFile(path.join(root, "secret.tmpl"), "changed=${app.KEY}");
    assert.notEqual((await buildServiceMutationDefinitionBinding(service)).revision, binding.revision);
    await assert.rejects(materializeEphemeralSecretFiles(service, {}, {}, {}, binding.templateDigests, () => assert.fail("changed template reached Broker")), /preparation failed/);
    service.manifest.config.files[0].content = "${app.KEY}";
    await resolveServiceStartupBrokerResolution(service, ({ refs }) => { assert.deepEqual(refs, ["app.KEY"]); return [{ ref: "app.KEY", status: "resolved", value: "synthetic-ordinary-input" }]; });
  } finally {
    if (previous === undefined) delete process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT; else process.env.SERVICE_LASSO_SECRET_FILES_TRANSPORT = previous;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
