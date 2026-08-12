#!/usr/bin/env node
import { compareReleaseAssets, getExpectedReleaseAssetNames } from "./release-asset-policy.mjs";

function usage() {
  console.error("Usage: node scripts/check-release-assets.mjs <version> <asset-name> [asset-name ...]");
  console.error("       node scripts/check-release-assets.mjs --expected <version>");
}

const args = process.argv.slice(2);

if (args[0] === "--expected") {
  const version = args[1];
  if (!version) {
    usage();
    process.exit(2);
  }

  for (const assetName of getExpectedReleaseAssetNames(version)) {
    console.log(assetName);
  }
  process.exit(0);
}

const [version, ...assetNames] = args;
if (!version || assetNames.length === 0) {
  usage();
  process.exit(2);
}

const comparison = compareReleaseAssets(version, assetNames);

console.log(`Release asset policy check for ${version}`);
console.log("");
console.log("Expected assets:");
for (const name of comparison.expected) {
  console.log(`- ${name}`);
}
console.log("");
console.log("Actual assets:");
for (const name of comparison.actual) {
  console.log(`- ${name}`);
}

if (comparison.missing.length > 0) {
  console.error("");
  console.error("Missing required assets:");
  for (const name of comparison.missing) {
    console.error(`- ${name}`);
  }
}

if (comparison.unexpected.length > 0) {
  console.error("");
  console.error("Unexpected assets:");
  for (const name of comparison.unexpected) {
    console.error(`- ${name}`);
  }
}

if (comparison.missing.length > 0 || comparison.unexpected.length > 0) {
  process.exit(1);
}

console.log("");
console.log("Release asset policy check passed.");
