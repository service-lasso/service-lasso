import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
const require = createRequire(import.meta.url);
const braces = require("braces");
const Policy = require("http-cache-semantics");

test("AC-4AJ.6 rejects deep strings and caller-provided recursive ASTs before walking", () => {
  const deep = "{".repeat(4000) + "a,b" + "}".repeat(4000);
  for (const call of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => call(deep), { name: "SyntaxError" });
    assert.throws(() => call("{)".repeat(4000)), { name: "SyntaxError" });
  }
  let ast = { type: "text", value: "leaf" };
  for (let i = 0; i < 100; i++) ast = { type: "brace", nodes: [ast] };
  const cyclic = { type: "root", nodes: [] };
  cyclic.nodes.push(cyclic);
  for (const call of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => call(ast), /safe depth/);
    assert.throws(() => call(cyclic), /cyclic/);
  }
});

test("ordinary brace compilation, expansion and docs file matching stay compatible", () => {
  assert.deepEqual(braces("docs/{api,reference}/*.md"), ["docs/(api|reference)/*.md"]);
  assert.deepEqual(braces.expand("file-{1..3}.md"), ["file-1.md", "file-2.md", "file-3.md"]);
  assert.equal(braces.stringify(braces.parse("a/{b,c}/d")), "a/{b,c}/d");
  assert.deepEqual(require("micromatch")(["docs/api/a.md", "docs/reference/b.md", "src/a.js"], "docs/{api,reference}/*.md"), ["docs/api/a.md", "docs/reference/b.md"]);
});

const req = { url: "https://example.test/docs", method: "GET", headers: { host: "example.test" } };
test("AC-4AJ.6 max-stale cannot revive security-zeroed cached responses", () => {
  for (const headers of [
    { "set-cookie": "synthetic-session=value", "cache-control": "max-age=600" },
    { "cache-control": "no-cache" },
    { "cache-control": "no-store" },
    { "cache-control": "private, max-age=600" },
    { "cache-control": "proxy-revalidate, max-age=600" },
    { vary: "*", "cache-control": "max-age=600" },
  ]) {
    const policy = new Policy(req, { status: 200, headers });
    assert.equal(policy.maxAge(), 0);
    for (const stale of ["max-stale=100000", "max-stale"]) {
      const incoming = { ...req, headers: { ...req.headers, "cache-control": stale } };
      assert.equal(policy.satisfiesWithoutRevalidation(incoming), false);
      assert.equal(policy.evaluateRequest(incoming).response, undefined);
      assert.equal(Policy.fromObject(policy.toObject()).satisfiesWithoutRevalidation(incoming), false);
    }
  }
});

test("explicit public caching with a positive TTL remains usable", () => {
  const policy = new Policy(req, { status: 200, headers: { "cache-control": "public, max-age=600" } });
  assert.equal(policy.satisfiesWithoutRevalidation(req), true);
  assert.equal(Policy.fromObject(policy.toObject()).satisfiesWithoutRevalidation(req), true);
});

test("all lockfile copies use the patched workspaces rather than vulnerable registry bytes", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url)));
  for (const name of ["braces", "http-cache-semantics"]) {
    const copies = Object.entries(lock.packages).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
    assert.ok(copies.length > 0);
    for (const [path, entry] of copies) {
      assert.equal(entry.link, true, path);
      assert.equal(entry.resolved, `packages/${name}-safe`, path);
    }
  }
});
