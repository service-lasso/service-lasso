import { AsyncLocalStorage } from "node:async_hooks";

const pairs = {
  discovery: ["present", "absent"], generation: ["new", "resumed", "committed"],
  options: ["enabled", "disabled", "no_autostart"], adoption: ["selected", "not_selected", "excluded"],
  setup: ["ready", "required"], selection: ["selected", "disabled", "not_selected", "already_running"],
  action: ["start", "adopt", "skip"], outcome: ["started", "adopted", "skipped", "failed"],
  enrollment: ["managed", "adopted"], readiness: ["reached"], observation: ["failed", "overflow"],
} as const;
type Boundary = keyof typeof pairs;
type Event = { sequence: number; boundary: Boundary; result: string };
export type FixtureStartupPathObservation = Readonly<{
  schema: "service-lasso.fixture-startup-path.v1"; complete: boolean; events: readonly Readonly<Event>[];
}>;
export type FixtureStartupPathHook = {
  // Test-owned selector stays private and never enters the observation.
  serviceId: string;
  observe: (record: FixtureStartupPathObservation) => void;
};
type Collector = { hook: FixtureStartupPathHook; events: Event[]; complete: boolean; stopped: boolean };
// Async context carries only this invocation's observational collector. No
// control reader, process identity or enrollment authority resides here.
const context = new AsyncLocalStorage<Collector>();
export function observeFixtureStartupDiscovery(hasService: (serviceId: string) => boolean): void {
  const collector = context.getStore();
  if (!collector || collector.stopped) return;
  try { observeFixtureStartupPath("discovery", hasService(collector.hook.serviceId) ? "present" : "absent"); }
  catch { failObservation(collector); }
}
const snapshot = (collector: Collector): FixtureStartupPathObservation => Object.freeze({
  schema: "service-lasso.fixture-startup-path.v1", complete: collector.complete,
  events: Object.freeze(collector.events.map(event => Object.freeze({ ...event }))),
});
function append(collector: Collector, boundary: Boundary, result: string): void {
  collector.events.push({ sequence: collector.events.length + 1, boundary, result });
}
function failObservation(collector: Collector): void {
  collector.complete = false;
  if (collector.events.length < 32) append(collector, "observation", "failed");
  collector.stopped = true;
}
export function observeFixtureStartupPath<B extends Boundary>(
  boundary: B, result: (typeof pairs)[B][number], serviceId?: string,
): void {
  const collector = context.getStore();
  if (!collector || collector.stopped) return;
  try {
    if (serviceId !== undefined && serviceId !== collector.hook.serviceId) return;
    if (!(pairs[boundary] as readonly string[]).includes(result)) return;
    if (collector.events.length === 31) {
      append(collector, "observation", "overflow"); collector.complete = false; collector.stopped = true;
    } else append(collector, boundary, result);
    collector.hook.observe(snapshot(collector));
  } catch { failObservation(collector); }
}
export async function withFixtureStartupPathForTests<T>(hook: FixtureStartupPathHook | undefined, action: () => Promise<T>): Promise<T> {
  if (!hook || process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") return await action();
  const collector: Collector = { hook, events: [], complete: true, stopped: false };
  return await context.run(collector, async () => {
    try { return await action(); }
    finally {
      // A final attempt can deliver the closed observation-failure flag. Its
      // own failure remains neutral to success or the exact primary Error.
      try { hook.observe(snapshot(collector)); }
      catch {
        failObservation(collector);
        try { hook.observe(snapshot(collector)); } catch { /* observational */ }
      }
      collector.stopped = true;
    }
  });
}
