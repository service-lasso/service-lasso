// Private evidence stays in the fixture. Only the closed summary is public.
export function createFixtureCleanupAdapter(fixture, operations) {
  return {
    snapshot: async () => {
      const registry = await operations.readRegistry(fixture.workspaceRoot);
      // Require the interrupted custody input again during teardown. Even a
      // primary failure before the action's read must not fabricate absence.
      const interrupted = await operations.readInterrupted(fixture.workspaceRoot);
      if (!Array.isArray(interrupted)) throw new Error("Interrupted fixture custody is missing.");
      const members = [...interrupted, ...fixture.custodyReaders.flatMap((read) => read())];
      for (const owner of registry.entries.filter((entry) => entry.ownerType === "service")) {
        if (!owner.identity) {
          if (owner.lifecycleState !== "stopped") throw new Error("Fixture ownership is incomplete.");
          continue;
        }
        members.push(owner.identity);
        const state = await operations.classify(owner);
        if (state === "owned") members.push(...await operations.capture({
          rootPid: owner.pid, rootIdentity: owner.identity, processGroup: owner.processGroup,
        }, { deadlineMs: Date.now() + 5_000 }));
        else if (state !== "not_running") throw new Error("Fixture ownership is unresolved.");
      }
      return members;
    },
    stop: () => operations.stop("matrix-service"),
    finalize: () => operations.finalize("matrix-service", Date.now() + 5_000),
    inspect: async (member) => (await operations.inspect(member.pid, { deadlineMs: Date.now() + 5_000 })).status,
  };
}

export function createFixtureCustody() {
  const members = new Map();
  let incomplete = false;
  return {
    retain(snapshot) {
      if (!Array.isArray(snapshot)) { incomplete = true; throw new Error("Invalid fixture custody snapshot."); }
      for (const member of snapshot) {
        if (!member || !Number.isSafeInteger(member.pid) || member.pid <= 0 ||
          typeof member.createdAt !== "string" || !member.createdAt ||
          typeof member.executablePath !== "string" || !member.executablePath ||
          typeof member.commandHash !== "string" || !/^[a-f0-9]{64}$/i.test(member.commandHash) ||
          Object.keys(member).sort().join(",") !== "commandHash,createdAt,executablePath,pid") {
          incomplete = true;
          throw new Error("Invalid fixture custody member.");
        }
        members.set(JSON.stringify(member), { ...member });
      }
    },
    async settle(adapter) {
      const failures = [];
      const attempt = async (stage, action) => {
        try { return await action(); }
        catch (error) { failures.push({ stage, error }); return undefined; }
      };
      await attempt("snapshot", async () => this.retain(await adapter.snapshot()));
      await attempt("stop", adapter.stop);
      await attempt("finalization", adapter.finalize);
      await attempt("snapshot", async () => this.retain(await adapter.snapshot()));
      let absent = !incomplete && !failures.some((entry) => entry.stage === "snapshot");
      for (const member of members.values()) {
        const status = await attempt("inspection", () => adapter.inspect(member));
        if (status !== "not_running") absent = false;
      }
      if (!absent) failures.push({ stage: "absence", error: new Error("Fixture member custody remains unresolved.") });
      return { failures, absent, memberCount: members.size };
    },
  };
}

export async function closeFixture({ primary, failures = [], custody, adapter, restore, reset, remove, report, recovery = "unknown" }) {
  let result;
  try {
    result = await custody.settle(adapter);
    failures.push(...result.failures);
    // A failed action retains even successfully settled evidence.
    if (!primary && failures.length === 0 && result.absent) {
      try { await remove(); await reset(); }
      catch (error) { failures.push({ stage: "removal", error }); }
    }
  } catch (error) { failures.push({ stage: "custody", error }); }
  finally {
    try { restore(); } catch (error) { failures.push({ stage: "environment", error }); }
  }
  const retained = Boolean(primary || failures.length || !result?.absent);
  try { report({ kind: "hard-crash-fixture-custody", recovery,
    stop: failures.some((entry) => entry.stage === "stop") ? "failed" : "settled",
    finalization: failures.some((entry) => entry.stage === "finalization") ? "failed" : "settled",
    absence: result?.absent ? "proven" : "unresolved", fixture: retained ? "retained" : "removed" }); }
  catch (error) { failures.push({ stage: "diagnostic", error }); }
  if (primary || failures.length) throw new AggregateError([
    ...(primary ? [primary] : []), ...failures.map((entry) => entry.error),
  ], "Hard-crash fixture action or terminal custody failed.");
}
