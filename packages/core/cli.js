#!/usr/bin/env node

try {
  await import("../../dist/index.js");
} catch (error) {
  console.error("[service-lasso] packages/core CLI wrapper requires the root runtime to be built first.");
  throw error;
}
