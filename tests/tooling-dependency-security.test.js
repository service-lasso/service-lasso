import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";

const require = createRequire(import.meta.url);
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));

test("compression releases its actual gzip stream after a client disconnect", { timeout: 15_000 }, async () => {
  const zlib = require("node:zlib");
  const descriptor = Object.getOwnPropertyDescriptor(zlib, "createGzip");
  let gzip;
  Object.defineProperty(zlib, "createGzip", { configurable: true, value(...args) {
    gzip = descriptor.value(...args);
    return gzip;
  } });
  let finishClose;
  const closed = new Promise((resolve) => { finishClose = resolve; });
  const middleware = require("compression")({ threshold: 0 });
  const server = http.createServer((request, response) => middleware(request, response, () => {
    response.setHeader("Content-Type", "text/plain");
    response.write(Buffer.alloc(128 * 1024));
    response.flush();
    response.once("close", () => setImmediate(finishClose));
  }));
  let client;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    client = http.get({ host: "127.0.0.1", port: server.address().port, headers: { "Accept-Encoding": "gzip" } });
    const [response] = await once(client, "response");
    assert.equal(response.headers["content-encoding"], "gzip");
    response.on("error", () => {});
    await once(response, "data");
    response.destroy();
    await closed;
    assert.ok(gzip, "middleware must create an actual gzip stream");
    assert.equal(gzip.destroyed, true, "premature close must release the stream");
  } finally {
    client?.destroy();
    Object.defineProperty(zlib, "createGzip", descriptor);
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("every copy of the six newly reported tooling roots uses its official patched release", () => {
  const patched = {
    compression: "1.8.2", joi: "17.13.8", katex: "0.18.2",
    "postcss-selector-parser": "7.1.6", "source-map-js": "1.2.2", tinypool: "2.1.2",
  };
  for (const [name, version] of Object.entries(patched)) {
    const copies = Object.entries(lock.packages).filter(([path]) =>
      path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
    assert.ok(copies.length > 0, `missing ${name}`);
    for (const [path, metadata] of copies) assert.equal(metadata.version, version, path);
  }
});

test("Joi retains normal Docusaurus validation and rejects prototype-changing message codes", () => {
  const Joi = require("joi");
  const schema = Joi.object({ title: Joi.string().required(), port: Joi.number().integer() });
  assert.equal(schema.validate({ title: "Docs", port: 17883 }).error, undefined);
  assert.ok(schema.validate({ port: "invalid" }).error);
  const hostile = JSON.parse('{"__proto__":"polluted"}');
  assert.throws(() => Joi.string().messages(hostile), /__proto__/);
  assert.throws(() => Joi.string().messages({ english: hostile }), /__proto__/);
});

test("KaTeX retains Mermaid rendering modes without inheriting renderer trust", async () => {
  // Mermaid's core build dynamically imports the default KaTeX renderer.
  const { default: katex } = await import("katex");
  for (const output of ["mathml", "htmlAndMathml"]) {
    const rendered = katex.renderToString("x^2", { throwOnError: true, displayMode: true, output });
    assert.match(rendered, /<math/);
  }
  assert.throws(() => katex.renderToString(String.raw`\unknowncommand`, { throwOnError: true }));
  const inheritedTrust = Object.assign(Object.create({ trust: true }), { throwOnError: true });
  assert.doesNotMatch(katex.renderToString(String.raw`\href{https://example.com}{x}`, inheritedTrust), /<a href=/);
  assert.match(katex.renderToString(String.raw`\href{https://example.com}{x}`, { trust: true }), /<a href=/);
  assert.equal(typeof require.resolve("katex/dist/katex.css"), "string");
});

test("source-map-js retains mapping round trips and rejects invalid indexed offsets", () => {
  const { SourceMapConsumer, SourceMapGenerator, SourceNode } = require("source-map-js");
  const generator = new SourceMapGenerator({ file: "bundle.js" });
  generator.addMapping({ generated: { line: 1, column: 0 }, original: { line: 1, column: 0 }, source: "input.js" });
  const consumer = new SourceMapConsumer(generator.toJSON());
  assert.equal(consumer.originalPositionFor({ line: 1, column: 0 }).source, "input.js");
  assert.equal(SourceNode.fromStringWithSourceMap("x;", consumer).toString(), "x;");
  for (const line of [-1, 0.5, "1", 10_000_001]) {
    assert.throws(() => new SourceMapConsumer({ version: 3, sections: [{
      offset: { line, column: 0 }, map: generator.toJSON(),
    }] }), /offset/);
  }
});

test("actual CSS callers retain selector transformation and namespace behavior", async () => {
  const postcss = require("postcss");
  const run = async (name, css, options) =>
    (await postcss([require(name)(options)]).process(css, { from: undefined })).css;
  const calculated = await run("postcss-calc", '[data-size="calc(1px + 1px)"]{width:calc(1px + 1px)}', { selectors: true });
  assert.match(calculated, /data-size=.?2px/);
  assert.match(calculated, /width:2px/);
  const namespaces = await run("postcss-discard-unused", '@namespace used "urn:used";@namespace unused "urn:unused";[used|name]{color:red}');
  assert.match(namespaces, /urn:used/);
  assert.doesNotMatch(namespaces, /urn:unused/);
  const merged = await run("postcss-merge-rules", '[data-x=a]{color:red}[data-x=b]{color:red}');
  assert.match(merged, /\[data-x=a\],\[data-x=b\]/);
  const minified = await run("postcss-minify-selectors", '.a:nth-child(1),.a:nth-child(1){color:red}');
  assert.match(minified, /\.a:first-child/);
  assert.equal((minified.match(/first-child/g) ?? []).length, 1);
  const unique = await run("postcss-unique-selectors", '.b,.a,.b{color:red}');
  assert.equal(unique, '.a,.b{color:red}');
  const hacks = await run("stylehacks", '* html .old{color:red}.modern{color:blue}', { overrideBrowserslist: ["chrome 120"] });
  assert.doesNotMatch(hacks, /\.old/);
  assert.match(hacks, /\.modern/);
  // Exercise the real default/advanced cssnano chain, including AST mutation.
  for (const preset of ["default", "advanced"]) {
    const result = await postcss([require("cssnano")({ preset })]).process('.a:nth-child(1),.a:nth-child(1){margin:0px;color:rgb(255,0,0)}', { from: undefined });
    assert.match(result.css, /first-child/);
    assert.match(result.css, /margin:0/);
    assert.match(result.css, /color:red/);
  }
});

test("Tinypool retains the Docusaurus worker contract and ignores inherited worker options", async () => {
  const { default: Tinypool } = await import("tinypool");
  const hostile = new URL("./fixtures/tooling-worker-must-not-load.mjs", import.meta.url).href;
  const inherited = { filename: hostile, execArgv: ["--import", hostile], env: { NODE_OPTIONS: `--import ${hostile}` } };
  const options = Object.assign(Object.create(inherited), {
    filename: new URL("./fixtures/tooling-ssg-worker.mjs", import.meta.url).href,
    minThreads: 2, maxThreads: 2, concurrentTasksPerWorker: 1,
    runtime: "worker_threads", isolateWorkers: false,
    workerData: { params: { title: "Docs" } }, resourceLimits: {},
  });
  const pool = new Tinypool(options);
  try {
    const tasks = [{ id: 1, pathnames: ["/a"] }, { id: 2, pathnames: ["/b", "/c"] }];
    const results = await Promise.all(tasks.map((task) => pool.run(task, Object.create(inherited))));
    assert.deepEqual(results.map((result) => result.pathnames), tasks.map((task) => task.pathnames));
    for (const result of results) {
      assert.ok(result.workerId > 0);
      assert.equal(result.title, "Docs");
      assert.equal(result.isWorkerThread, true);
    }
  } finally {
    await pool.destroy();
  }
});
