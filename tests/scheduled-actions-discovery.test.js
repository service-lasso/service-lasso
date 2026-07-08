import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { rm } from "node:fs/promises";
import { loadServiceManifest } from "../dist/runtime/discovery/loadManifest.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

async function withManifest(body, recipe) {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-scheduled-actions-");
  const serviceRoot = await writeManifest(servicesRoot, body.id ?? "scheduled-service", body);
  const manifestPath = path.join(serviceRoot, "service.json");

  try {
    return await recipe(manifestPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function baseManifest(overrides = {}) {
  return {
    id: "scheduled-service",
    name: "Scheduled Service",
    description: "Fixture for scheduled action discovery.",
    executable: process.execPath,
    args: ["--version"],
    healthcheck: { type: "process" },
    ...overrides,
  };
}

test("service discovery accepts schedules attached to action definitions", async () => {
  await withManifest(
    baseManifest({
      actions: {
        backup: {
          label: "Backup",
          description: "Create a service backup.",
          mode: "workflow",
          requiredState: "running",
          manualOnly: false,
          requiresConfirmation: true,
          timeoutSeconds: 900,
          env: {
            BACKUP_MODE: "snapshot",
          },
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
    }),
    async (manifestPath) => {
      const manifest = await loadServiceManifest(manifestPath);

      assert.equal(manifest.actions.backup.mode, "workflow");
      assert.equal(manifest.actions.backup.requiredState, "running");
      assert.equal(manifest.actions.backup.schedules.nightly.cron, "15 2 * * *");
      assert.equal(manifest.actions.backup.schedules.nightly.timezone, "Australia/Sydney");
      assert.deepEqual(manifest.actions.backup.schedules.nightly.parameters, { retainDays: 7 });
    },
  );
});

test("service discovery rejects free-floating schedules outside actions", async () => {
  await withManifest(
    baseManifest({
      schedules: {
        nightly: {
          action: "backup",
          cron: "15 2 * * *",
        },
      },
    }),
    async (manifestPath) => {
      await assert.rejects(
        () => loadServiceManifest(manifestPath),
        /top-level "schedules" are not supported.*actions\.<actionId>\.schedules/i,
      );
    },
  );
});

test("service discovery rejects invalid action schedule cron expressions", async () => {
  await withManifest(
    baseManifest({
      actions: {
        backup: {
          mode: "workflow",
          schedules: {
            broken: {
              cron: "nightly",
            },
          },
        },
      },
    }),
    async (manifestPath) => {
      await assert.rejects(
        () => loadServiceManifest(manifestPath),
        /actions\.backup\.schedules\.broken\.cron.*5- or 6-field cron expression/i,
      );
    },
  );
});

test("service discovery rejects action references inside schedule declarations", async () => {
  await withManifest(
    baseManifest({
      actions: {
        backup: {
          mode: "workflow",
          schedules: {
            nightly: {
              action: "restart",
              cron: "15 2 * * *",
            },
          },
        },
      },
    }),
    async (manifestPath) => {
      await assert.rejects(
        () => loadServiceManifest(manifestPath),
        /schedules\.nightly.*must not declare action references/i,
      );
    },
  );
});
