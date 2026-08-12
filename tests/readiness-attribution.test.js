import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import {
  attributeServiceReadiness,
} from "../dist/runtime/health/readinessAttribution.js";
import { waitForServiceReadiness } from "../dist/runtime/health/waitForReadiness.js";
import { inspectTcpListenerProcesses } from "../dist/runtime/process/listener.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";

const GENERATION = "11111111-1111-4111-8111-111111111111";
const OTHER_GENERATION = "22222222-2222-4222-8222-222222222222";
const ALLOCATION = "allocation-transaction";

function fixture(port = 41_001) {
  const service = {
    manifest: {
      id: "owned-service",
      ports: { http: port },
      healthcheck: {
        type: "http",
        url: `http://127.0.0.1:${port}/health?token=listener-secret`,
        expected_status: 200,
        retries: 1,
      },
    },
    serviceRoot: "C:\\private\\owned-service",
  };
  const lifecycle = {
    running: true,
    runtime: {
      ports: { http: port },
      generationId: GENERATION,
      allocationRevision: ALLOCATION,
    },
  };
  const expectedOwner = {
    ownerType: "service",
    ownerId: "owned-service",
    serviceId: "owned-service",
    generationId: GENERATION,
    pid: 501,
    identity: { pid: 501 },
    processGroup: { kind: "none", id: null },
    allocation: { revision: ALLOCATION, ports: { http: port }, endpoints: [] },
  };
  return { service, lifecycle, expectedOwner };
}

function options(expectedOwner, inspection, extraEntries = [], captureMembers = [{ pid: 501 }]) {
  return {
    workspaceRoot: "C:\\private\\workspace",
    generationId: GENERATION,
    allocationRevision: ALLOCATION,
    expectedPorts: { http: 41_001 },
    dependencies: {
      readRegistry: async () => ({ version: 1, updatedAt: "redacted", entries: [expectedOwner, ...extraEntries] }),
      classifyOwner: async () => "owned",
      captureMembers: async () => captureMembers,
      inspectListener: async () => inspection,
    },
  };
}

test("AC-4BJ.7 rejects a healthy expected endpoint served by an unrelated PID", async () => {
  const { service, lifecycle, expectedOwner } = fixture();
  const result = await attributeServiceReadiness(
    service,
    lifecycle,
    {},
    options(expectedOwner, { status: "listening", pids: [777] }),
  );
  assert.equal(result.ready, false);
  assert.match(result.message, /wrong_process_listener/);
  assert.deepEqual(result.evidence, {
    classification: "wrong_process_listener",
    checkedEndpointCount: 1,
  });
});

test("AC-4BJ.7 classifies a listener registered to another generation without exposing identity", async () => {
  const { service, lifecycle, expectedOwner } = fixture();
  const otherOwner = {
    ...expectedOwner,
    ownerId: "other-service",
    serviceId: "other-service",
    generationId: OTHER_GENERATION,
    pid: 777,
    identity: { pid: 777 },
  };
  const result = await attributeServiceReadiness(
    service,
    lifecycle,
    {},
    options(expectedOwner, { status: "listening", pids: [777] }, [otherOwner]),
  );
  assert.equal(result.ready, false);
  assert.equal(result.evidence.classification, "wrong_generation_listener");
  assert.match(result.message, /wrong_generation_listener/);

  const serialized = JSON.stringify(result);
  for (const forbidden of ["777", "41001", "listener-secret", "C:\\\\private", "/health", "commandHash"]) {
    assert.equal(serialized.includes(forbidden), false, `redacted result contains ${forbidden}`);
  }
});

test("AC-4BJ.7 accepts a listener owned by a verified descendant of the service root", async () => {
  const { service, lifecycle, expectedOwner } = fixture();
  const result = await attributeServiceReadiness(
    service,
    lifecycle,
    {},
    options(expectedOwner, { status: "listening", pids: [502] }, [], [{ pid: 502 }, { pid: 501 }]),
  );
  assert.equal(result.ready, true);
  assert.deepEqual(result.evidence, {
    classification: "owned_listener",
    checkedEndpointCount: 1,
  });
});

test("AC-4BJ.7 accepts a listener owned by the verified service root", async () => {
  const { service, lifecycle, expectedOwner } = fixture();
  const result = await attributeServiceReadiness(
    service,
    lifecycle,
    {},
    options(expectedOwner, { status: "listening", pids: [501] }),
  );
  assert.equal(result.ready, true);
  assert.equal(result.evidence.classification, "owned_listener");
});

test("AC-4BJ.7 rejects a mixed owned and unrelated listener set", async () => {
  const { service, lifecycle, expectedOwner } = fixture();
  const result = await attributeServiceReadiness(
    service,
    lifecycle,
    {},
    options(expectedOwner, { status: "listening", pids: [501, 777] }),
  );
  assert.equal(result.ready, false);
  assert.equal(result.evidence.classification, "wrong_process_listener");
});

test("AC-4BJ.7 fails closed when the healthy listener disappears before attribution", async () => {
  const { service, lifecycle, expectedOwner } = fixture();
  const result = await attributeServiceReadiness(
    service,
    lifecycle,
    {},
    options(expectedOwner, { status: "not_listening" }),
  );
  assert.equal(result.ready, false);
  assert.equal(result.evidence.classification, "listener_disappeared");
});

test("AC-4BJ.7 fails closed when listener ownership is unavailable", async () => {
  const { service, lifecycle, expectedOwner } = fixture();
  const result = await attributeServiceReadiness(
    service,
    lifecycle,
    {},
    options(expectedOwner, { status: "unknown", reason: "listener_owner_unverifiable" }),
  );
  assert.equal(result.ready, false);
  assert.equal(result.evidence.classification, "listener_owner_unverifiable");
});

test("AC-4BJ.7 rejects required HTTP and TCP targets outside the transaction allocation", async () => {
  for (const healthcheck of [
    {
      type: "http",
      url: "http://127.0.0.1:41999/health?token=outside-allocation-secret",
      expected_status: 200,
      retries: 1,
    },
    {
      type: "tcp",
      host: "127.0.0.1",
      port: 42_000,
      retries: 1,
    },
  ]) {
    const { service, lifecycle, expectedOwner } = fixture();
    service.manifest.healthcheck = healthcheck;
    let listenerInspections = 0;
    const attributionOptions = options(expectedOwner, { status: "listening", pids: [501] });
    attributionOptions.dependencies.inspectListener = async () => {
      listenerInspections += 1;
      return { status: "listening", pids: [501] };
    };

    const result = await attributeServiceReadiness(service, lifecycle, {}, attributionOptions);

    assert.equal(result.ready, false);
    assert.deepEqual(result.evidence, {
      classification: "ownership_evidence_mismatch",
      checkedEndpointCount: 0,
    });
    assert.equal(listenerInspections, 0);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["41999", "42000", "outside-allocation-secret", "/health", "C:\\private"]) {
      assert.equal(serialized.includes(forbidden), false, `redacted result contains ${forbidden}`);
    }
  }
});

test("AC-4BJ.7 active HTTP readiness cannot be satisfied by a wrong listener", async () => {
  const server = http.createServer((_request, response) => {
    response.statusCode = 200;
    response.end("ready");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP listener did not expose an address.");
  const { service, lifecycle, expectedOwner } = fixture(address.port);
  const attributionOptions = options(expectedOwner, { status: "listening", pids: [777] });
  attributionOptions.expectedPorts = { http: address.port };
  const initial = getLifecycleState(service.manifest.id);
  setLifecycleState(service.manifest.id, {
    ...initial,
    running: true,
    runtime: {
      ...initial.runtime,
      ...lifecycle.runtime,
    },
  });
  try {
    const result = await waitForServiceReadiness(service, {}, attributionOptions);
    assert.equal(result.health.healthy, true);
    assert.equal(result.ready, false);
    assert.equal(result.attribution.classification, "wrong_process_listener");
  } finally {
    resetLifecycleState();
    const closed = once(server, "close");
    server.close();
    server.closeIdleConnections();
    server.closeAllConnections();
    await closed;
  }
});

test("AC-4BJ.7 active TCP readiness cannot be satisfied by a wrong listener", async () => {
  const server = net.createServer((socket) => socket.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TCP listener did not expose an address.");
  const { service, lifecycle, expectedOwner } = fixture(address.port);
  service.manifest.healthcheck = {
    type: "tcp",
    host: "127.0.0.1",
    port: address.port,
    retries: 1,
  };
  const attributionOptions = options(expectedOwner, { status: "listening", pids: [777] });
  attributionOptions.expectedPorts = { http: address.port };
  const initial = getLifecycleState(service.manifest.id);
  setLifecycleState(service.manifest.id, {
    ...initial,
    running: true,
    runtime: { ...initial.runtime, ...lifecycle.runtime },
  });
  try {
    const result = await waitForServiceReadiness(service, {}, attributionOptions);
    assert.equal(result.health.healthy, true);
    assert.equal(result.ready, false);
    assert.equal(result.attribution.classification, "wrong_process_listener");
  } finally {
    resetLifecycleState();
    const closed = once(server, "close");
    server.close();
    await closed;
  }
});

test("AC-4BJ.7 Windows listener inspection returns only the matching endpoint owner", async () => {
  const inspection = await inspectTcpListenerProcesses("127.0.0.1", 41_001, {
    platform: "win32",
    runCommand: async () => ({
      stdout: [
        "Proto  Local Address          Foreign Address        State           PID",
        "TCP    127.0.0.1:41001        0.0.0.0:0              LISTENING       501",
        "TCP    192.0.2.2:41001        0.0.0.0:0              LISTENING       777",
      ].join("\r\n"),
    }),
  });
  assert.deepEqual(inspection, { status: "listening", pids: [501] });
});

test("AC-4BJ.7 Linux listener inspection binds the socket inode to its owning PID", async () => {
  const tcpTable = [
    "sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode",
    "0: 0100007F:A029 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 424242 1",
  ].join("\n");
  const inspection = await inspectTcpListenerProcesses("127.0.0.1", 41_001, {
    platform: "linux",
    readFile: async (filePath) => filePath === "/proc/net/tcp" ? tcpTable : "",
    readdir: async (filePath, options) => {
      if (filePath === "/proc" && options?.withFileTypes) {
        return [{ name: "501", isDirectory: () => true }];
      }
      if (filePath === "/proc/501/fd") return ["7"];
      return [];
    },
    readlink: async () => "socket:[424242]",
  });
  assert.deepEqual(inspection, { status: "listening", pids: [501] });
});

test("AC-4BJ.7 Linux listener inspection fails closed when a PID exceeds the descriptor bound", async () => {
  const tcpTable = [
    "sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode",
    "0: 0100007F:A029 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 424242 1",
  ].join("\n");
  let descriptorInspections = 0;
  const inspection = await inspectTcpListenerProcesses("127.0.0.1", 41_001, {
    platform: "linux",
    maxDescriptorsPerPid: 2,
    readFile: async (filePath) => filePath === "/proc/net/tcp" ? tcpTable : "",
    readdir: async (filePath, options) => {
      if (filePath === "/proc" && options?.withFileTypes) {
        return [{ name: "501", isDirectory: () => true }];
      }
      if (filePath === "/proc/501/fd") return ["1", "2", "3"];
      return [];
    },
    readlink: async () => {
      descriptorInspections += 1;
      return "socket:[999999]";
    },
  });
  assert.deepEqual(inspection, { status: "unknown", reason: "inspection_unavailable" });
  assert.equal(descriptorInspections, 2);
});

test("AC-4BJ.7 Linux listener inspection fails closed when its monotonic deadline expires", async () => {
  const tcpTable = [
    "sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode",
    "0: 0100007F:A029 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 424242 1",
  ].join("\n");
  let elapsed = 0;
  let descriptorInspections = 0;
  const inspection = await inspectTcpListenerProcesses("127.0.0.1", 41_001, {
    platform: "linux",
    inspectionTimeoutMs: 5,
    now: () => elapsed,
    readFile: async (filePath) => filePath === "/proc/net/tcp" ? tcpTable : "",
    readdir: async (filePath, options) => {
      if (filePath === "/proc" && options?.withFileTypes) {
        return [{ name: "501", isDirectory: () => true }];
      }
      if (filePath === "/proc/501/fd") {
        elapsed = 5;
        return ["7"];
      }
      return [];
    },
    readlink: async () => {
      descriptorInspections += 1;
      return "socket:[424242]";
    },
  });
  assert.deepEqual(inspection, { status: "unknown", reason: "inspection_unavailable" });
  assert.equal(descriptorInspections, 0);
});

test("AC-4BJ.7 platform listener inspection attributes a real loopback listener", async () => {
  const server = http.createServer((_request, response) => response.end("ready"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Listener did not expose an address.");
  try {
    const inspection = await inspectTcpListenerProcesses("127.0.0.1", address.port);
    assert.equal(inspection.status, "listening");
    assert.equal(inspection.pids.includes(process.pid), true);
  } finally {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  }
});
