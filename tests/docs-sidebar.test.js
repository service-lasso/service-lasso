import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sidebarPath = path.join(root, "docs", "sidebars.js");

const expectedGettingStartedLabels = [
  "Getting started",
  "Beginner — Todo app",
  "Intermediate — Make the Todo durable",
  "Advanced — Add a Go Todo API service",
  "Advanced — Add Zitadel SSO to Todo",
  "Advanced — Package Todo as a desktop app",
  "Advanced — Provision secrets as RAM files",
  "Advanced — Proxy FastCGI services with Caddy",
  "Advanced — Run Nextcloud behind Caddy",
  "Advanced — Resolve secrets from OpenBao",
];

test("docs Getting started sidebar labels are clean and use em dashes", async () => {
  const source = await readFile(sidebarPath, "utf8");

  assert.doesNotMatch(source, /[ÃÂ]|â€|\uFFFD/u, "docs sidebar must not contain mojibake");

  const category = source.indexOf('label: "Getting started"');
  assert.ok(category >= 0, "Getting started sidebar category must exist");
  const itemsStart = source.indexOf("items: [", category);
  assert.ok(itemsStart >= 0, "Getting started sidebar category must contain items");
  const itemsEnd = source.indexOf("] },", itemsStart);
  assert.ok(itemsEnd > itemsStart, "Getting started sidebar category must close");
  const block = source.slice(itemsStart, itemsEnd);

  const labels = [...block.matchAll(/label: "([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(labels, expectedGettingStartedLabels);

  for (const label of labels) {
    assert.match(label, /^(?:Getting started|(?:Beginner|Intermediate|Advanced) — )/u, label);
  }
});

test("every Getting started sidebar doc id resolves to a docs source file", async () => {
  const source = await readFile(sidebarPath, "utf8");
  const category = source.indexOf('label: "Getting started"');
  const itemsStart = source.indexOf("items: [", category);
  const itemsEnd = source.indexOf("] },", itemsStart);
  const block = source.slice(itemsStart, itemsEnd);
  const ids = [...block.matchAll(/id: "([^"]+)"/gu)].map((match) => match[1]);

  assert.equal(new Set(ids).size, ids.length, "Getting started doc ids must be unique");
  assert.equal(ids.length, expectedGettingStartedLabels.length);

  for (const id of ids) {
    assert.doesNotMatch(id, /(?:^|\/)\.\.(?:\/|$)|^[A-Za-z]:|^[/\\]/u, `unsafe doc id: ${id}`);
    const candidates = [".md", ".mdx"].map((extension) => path.join(root, "docs", `${id}${extension}`));
    let resolved = false;
    for (const candidate of candidates) {
      try {
        await access(candidate);
        resolved = true;
        break;
      } catch {
        // Try the next supported docs extension.
      }
    }
    assert.ok(resolved, `Getting started doc id does not resolve: ${id}`);
  }
});
