import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const togglePath = new URL("../docs/src/theme/ColorModeToggle/index.jsx", import.meta.url);
const configPath = new URL("../docs/docusaurus.config.js", import.meta.url);

test("docs theme selector defaults to Auto and clears explicit overrides", async () => {
  const toggle = await readFile(togglePath, "utf8");

  assert.match(toggle, /value=\{isBrowser \? \(value \?\? "auto"\) : "auto"\}/);
  assert.match(toggle, /event\.target\.value === "auto" \? null : event\.target\.value/);
  assert.match(toggle, /<option value="auto">Auto<\/option>/);
  assert.doesNotMatch(toggle, /<option value="system">System<\/option>/);
});

test("docs theme selector follows the system while Auto is selected", async () => {
  const config = await readFile(configPath, "utf8");

  assert.match(config, /respectPrefersColorScheme: true/);
});
