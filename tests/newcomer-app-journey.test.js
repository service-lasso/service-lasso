import assert from "node:assert/strict";
import test from "node:test";
import { appJourneyEnvironment } from "../scripts/newcomer-app-journey.mjs";
import { ownedRuntimePortEnvironment } from "../scripts/newcomer-proof.mjs";

test("app and baseline subranges remain disjoint inside each leased proof range", () => {
  const baseline = ownedRuntimePortEnvironment(21000);
  const app = appJourneyEnvironment(21100, {});
  assert.equal(baseline.SERVICE_LASSO_PORT_RANGE_END, "21079");
  assert.deepEqual(app, { LASSO_EXAMPLE_CORE_PORT: "21100", LASSO_EXAMPLE_DATABASE_PORT: "21101", LASSO_EXAMPLE_APP_PORT: "21102", SERVICE_LASSO_PORT_RANGE_START: "21100", SERVICE_LASSO_PORT_RANGE_END: "21159" });
});

test("app journey rejects invalid ranges before provisioning", () => {
  for (const port of [0, 1023, 65500, NaN, 21000.5]) assert.throws(() => appJourneyEnvironment(port, {}), /Invalid/);
});
