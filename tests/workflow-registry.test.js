import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { buildManagedWorkflowRegistry } from "../dist/runtime/workflows/registry.js";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

async function readRegistry(servicesRoot) {
  return buildManagedWorkflowRegistry(await discoverServices(servicesRoot));
}

function scheduledManifest(overrides = {}) {
  return {
    id: "minecraft",
    name: "Minecraft",
    description: "Scheduled workflow registry fixture.",
    version: "1.2.3",
    executable: process.execPath,
    args: ["--version"],
    healthcheck: { type: "process" },
    actions: {
      backup: {
        label: "Backup",
        description: "Create a service backup.",
        mode: "workflow",
        requiredState: "running",
        steps: [
          { id: "stop", actionId: "stop" },
          { id: "backup", actionId: "backup" },
          { id: "verify", actionId: "verify-backup" },
          {
            id: "start",
            actionId: "start",
            run: "always",
            condition: "was-running-before-workflow",
          },
        ],
        schedules: {
          nightly: {
            label: "Nightly backup",
            enabled: true,
            cron: "15 2 * * *",
            timezone: "Australia/Sydney",
            concurrencyPolicy: "skip-if-running",
            failurePolicy: "record",
            parameters: {
              retainDays: 7,
            },
          },
        },
      },
    },
    ...overrides,
  };
}

test("managed workflow registry exposes scheduled service action workflows", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-workflow-registry-");

  try {
    await writeManifest(servicesRoot, "minecraft", scheduledManifest());

    const registry = await readRegistry(servicesRoot);

    assert.equal(registry.managedBy, "service-lasso");
    assert.equal(registry.registryVersion, 1);
    assert.equal(registry.workflows.length, 1);

    const [workflow] = registry.workflows;
    assert.equal(workflow.id, "minecraft.backup.nightly");
    assert.equal(workflow.managedBy, "service-lasso");
    assert.equal(workflow.serviceId, "minecraft");
    assert.equal(workflow.serviceVersion, "1.2.3");
    assert.equal(workflow.actionId, "backup");
    assert.equal(workflow.scheduleId, "nightly");
    assert.equal(workflow.cron, "15 2 * * *");
    assert.equal(workflow.timezone, "Australia/Sydney");
    assert.equal(workflow.enabled, true);
    assert.deepEqual(workflow.tags, ["service-lasso", "service:minecraft", "action:backup"]);
    assert.equal(workflow.checksum.length, 64);
    assert.deepEqual(
      workflow.steps.map((step) => `${step.id}:${step.actionId}:${step.type}`),
      [
        "stop:stop:service-lasso-action",
        "backup:backup:service-lasso-action",
        "verify:verify-backup:service-lasso-action",
        "start:start:service-lasso-action",
      ],
    );
    assert.equal(workflow.steps[3].run, "always");
    assert.equal(workflow.steps[3].condition, "was-running-before-workflow");
    assert.equal(workflow.steps[0].endpoint, "/api/services/minecraft/actions/stop/runs");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("managed workflow registry reflects add update remove and disable schedule changes", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-workflow-registry-changes-");

  try {
    await writeManifest(servicesRoot, "minecraft", scheduledManifest());
    const initial = await readRegistry(servicesRoot);
    const initialWorkflow = initial.workflows[0];

    await writeManifest(
      servicesRoot,
      "minecraft",
      scheduledManifest({
        actions: {
          backup: {
            mode: "workflow",
            schedules: {
              nightly: {
                cron: "30 3 * * *",
                enabled: true,
              },
              weekly: {
                cron: "0 4 * * 0",
                enabled: true,
              },
            },
          },
        },
      }),
    );

    const updated = await readRegistry(servicesRoot);
    assert.deepEqual(
      updated.workflows.map((workflow) => workflow.id),
      ["minecraft.backup.nightly", "minecraft.backup.weekly"],
    );
    assert.equal(updated.workflows[0].cron, "30 3 * * *");
    assert.notEqual(updated.workflows[0].checksum, initialWorkflow.checksum);

    await writeManifest(
      servicesRoot,
      "minecraft",
      scheduledManifest({
        actions: {
          backup: {
            mode: "workflow",
            schedules: {
              weekly: {
                cron: "0 4 * * 0",
                enabled: false,
              },
            },
          },
        },
      }),
    );

    const removedAndDisabled = await readRegistry(servicesRoot);
    assert.deepEqual(removedAndDisabled.workflows, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/workflows/registry returns managed workflow registry", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-workflow-registry-api-");
  await writeManifest(servicesRoot, "minecraft", scheduledManifest());
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/workflows/registry`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.managedBy, "service-lasso");
    assert.equal(body.workflows.length, 1);
    assert.equal(body.workflows[0].id, "minecraft.backup.nightly");
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
