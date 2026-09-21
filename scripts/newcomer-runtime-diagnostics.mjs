import { lifecycleFailureDiagnostic } from "./lifecycle-failure-diagnostics.mjs";

const startupServices = new Set(["@nginx", "@traefik", "echo-service", "@serviceadmin"]);

// Read-only and best effort. Never return raw response/error/URL content.
export async function collectStartupFailure(runtimeUrl, serviceId, { request = fetch, budgetMs = 5000 } = {}) {
  const result = { kind: "newcomer-startup-failure", serviceId: startupServices.has(serviceId) ? serviceId : null, observations: [] };
  try {
    const base = new URL(runtimeUrl);
    if (!result.serviceId || base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.username || base.password) return result;
    const deadline = Date.now() + Math.min(5000, Math.max(1, Number.isFinite(budgetMs) ? budgetMs : 5000));
    for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt += 1) {
      const controller = new AbortController();
      let timer;
      try {
        const pending = Promise.resolve().then(async () => {
          const response = await request(new URL(`/api/services/${encodeURIComponent(serviceId)}`, base).href, { method: "GET", signal: controller.signal });
          const body = response.ok ? await response.json() : null;
          return JSON.parse(lifecycleFailureDiagnostic({ httpStatus: response.status, state: body?.service?.lifecycle }));
        });
        const observation = await Promise.race([pending, new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("diagnostic_timeout")); }, Math.max(1, Math.min(1500, deadline - Date.now())));
        })]);
        result.observations.push(observation);
        if (observation.attemptStatus === "failed" || observation.attemptStatus === "blocked") break;
      } catch {
        result.observations.push({ diagnostic: "metadata_unavailable" });
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
      if (attempt < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
    }
  } catch {
    // A missing or malformed runtime address must not prevent owned cleanup.
  }
  return result;
}

export async function retainStartupFailure(runtimeUrl, serviceId, persist, options) {
  try {
    await persist(JSON.stringify(await collectStartupFailure(runtimeUrl, serviceId, options)));
  } catch {
    // Diagnostic I/O is never allowed to replace the original proof failure.
  }
}
