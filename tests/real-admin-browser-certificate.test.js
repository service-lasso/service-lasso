import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { X509Certificate } from "node:crypto";

import { generateLocalhostCertificate } from "./fixtures/real-admin-browser-certificate.mjs";

test("real browser harness generates a CA-pinned localhost TLS certificate without external packages", async () => {
  const now = new Date("2026-09-01T00:00:00Z");
  const certificate = generateLocalhostCertificate(now);
  const parsed = new X509Certificate(certificate.cert);
  assert.match(parsed.subjectAltName ?? "", /DNS:localhost/u);
  assert.match(parsed.subjectAltName ?? "", /IP Address:127\.0\.0\.1/u);
  assert.equal(parsed.ca, true);
  assert.ok(new Date(parsed.validFrom) <= now);
  assert.ok(new Date(parsed.validTo) > now);

  const server = https.createServer(
    { key: certificate.private, cert: certificate.cert },
    (_request, response) => response.end("ready"),
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    const body = await new Promise((resolve, reject) => {
      https
        .get(
          {
            hostname: "127.0.0.1",
            port: address.port,
            ca: certificate.cert,
            rejectUnauthorized: true,
          },
          (response) => {
            let value = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              value += chunk;
            });
            response.on("end", () => resolve(value));
          },
        )
        .once("error", reject);
    });
    assert.equal(body, "ready");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("real browser harness emits a minimal positive serial when random input starts with zero", () => {
  const serialSeed = Buffer.alloc(16);
  serialSeed[1] = 1;
  const certificate = generateLocalhostCertificate(
    new Date("2026-09-01T00:00:00Z"),
    serialSeed,
  );
  assert.doesNotThrow(() => new X509Certificate(certificate.cert));
});
