import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const packageLock = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const codeqlWorkflow = await readFile(
  new URL("../.github/workflows/codeql.yml", import.meta.url),
  "utf8",
);

test("CodeQL lifecycle steps stay on one immutable action revision", () => {
  const revisions = [
    ...codeqlWorkflow.matchAll(
      /github\/codeql-action\/(?:init|autobuild|analyze)@([a-f0-9]{40})/gu,
    ),
  ].map((match) => match[1]);

  assert.equal(revisions.length, 3);
  assert.equal(new Set(revisions).size, 1);
});

test("development dependency replacements resolve to the reviewed safe boundaries", () => {
  assert.equal(
    packageLock.packages["node_modules/image-size"].link,
    true,
    "image-size must resolve to the fail-closed workspace replacement",
  );
  assert.equal(
    packageLock.packages["packages/image-size-safe"].version,
    "2.0.3",
  );
  assert.equal(
    packageLock.packages["node_modules/serialize-javascript"].version,
    "7.1.0",
  );
  assert.equal(packageJson.overrides.qs, "6.16.0");
  assert.equal(packageJson.overrides.sockjs.uuid, "11.1.1");
  assert.equal(packageLock.packages["node_modules/uuid"].version, "11.1.1");
  assert.equal(packageLock.packages["node_modules/qs"].version, "6.16.0");
  assert.equal(packageLock.packages["node_modules/fast-uri"].version, "3.1.7");
});

/**
 * Nested copies of qs must also resolve to the patched override.
 * Advisory GHSA-4mjr-xmp4-gh2g / GHSA-x5fp-wj9c-mxmx require >= 6.16.0.
 */
test("every lockfile qs copy is the patched 6.16.0 override", () => {
  const qsPackages = Object.entries(packageLock.packages).filter(
    ([name, pkg]) =>
      (name === "node_modules/qs" || name.endsWith("/node_modules/qs")) &&
      typeof pkg.version === "string",
  );
  assert.ok(qsPackages.length > 0, "expected at least one lockfile qs entry");
  for (const [name, pkg] of qsPackages) {
    assert.equal(pkg.version, "6.16.0", `${name} must resolve to patched qs`);
  }
});

/**
 * Express and body-parser still parse query/body strings through qs.parse.
 * The override must keep that CommonJS call surface working.
 */
test("patched qs keeps the Express and body-parser parse surface", () => {
  const qs = require("qs");
  const parsed = qs.parse("service=echo&port=17883");
  assert.equal(parsed.service, "echo");
  assert.equal(parsed.port, "17883");
  assert.equal(typeof qs.stringify({ service: "echo" }), "string");

  const express = require("express");
  assert.equal(typeof express, "function");
  const bodyParser = require("body-parser");
  assert.equal(typeof bodyParser.json, "function");
  assert.equal(typeof bodyParser.urlencoded, "function");
});

test("the patched uuid override retains the CommonJS surface used by sockjs", () => {
  const uuid = require("uuid");
  const sockjs = require("sockjs");
  assert.equal(uuid.v4().length, 36);
  assert.equal(typeof sockjs.createServer().installHandlers, "function");
});

test("image dimension parsing fails closed instead of accepting attacker-controlled formats", async () => {
  const imageSize = await import("image-size");
  assert.deepEqual(imageSize.types, []);
  assert.throws(
    () => imageSize.imageSize(new Uint8Array([0x69, 0x63, 0x6e, 0x73])),
    /image dimension parsing is disabled/i,
  );

  const fromFile = await import("image-size/fromFile");
  await assert.rejects(
    fromFile.imageSizeFromFile("untrusted.icns"),
    /image dimension parsing is disabled/i,
  );
});
