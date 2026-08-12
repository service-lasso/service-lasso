import { startApiServer } from "../../dist/server/index.js";

const [servicesRoot, workspaceRoot, ...serviceIds] = process.argv.slice(2);
if (!servicesRoot || !workspaceRoot || serviceIds.length === 0) {
  throw new Error("Expected servicesRoot, workspaceRoot, and at least one baseline service ID.");
}

await startApiServer({
  port: 0,
  servicesRoot,
  workspaceRoot,
  baselineBootstrap: { serviceIds },
  startupTransactionTestHooks: {
    afterBaselineAction: async ({ serviceId, action }) => {
      if (serviceId === serviceIds[0] && action === "start") {
        process.exit(87);
      }
    },
  },
});

throw new Error("Startup did not crash after the requested baseline action.");
