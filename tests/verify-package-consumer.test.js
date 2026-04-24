import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPackageSpec,
  buildScopedRegistryConfig,
  classifyPackageAccessFailure,
  DEFAULT_REGISTRY,
  getMissingTokenSummary,
} from "../scripts/verify-package-consumer-lib.mjs";

test("buildPackageSpec returns the scoped package with and without a version", () => {
  assert.equal(buildPackageSpec(), "@service-lasso/service-lasso");
  assert.equal(buildPackageSpec("2026.4.24-a1b2c3d"), "@service-lasso/service-lasso@2026.4.24-a1b2c3d");
});

test("buildScopedRegistryConfig writes a scoped npmrc entry for the registry host", () => {
  assert.equal(
    buildScopedRegistryConfig(DEFAULT_REGISTRY),
    "@service-lasso:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n",
  );
});

test("classifyPackageAccessFailure recognizes missing authentication", () => {
  const classified = classifyPackageAccessFailure("npm error code E401\nauthentication token not provided");
  assert.equal(classified.code, "missing_auth");
});

test("classifyPackageAccessFailure recognizes insufficient package scope", () => {
  const classified = classifyPackageAccessFailure("npm error code E403\npermission_denied: read_package");
  assert.equal(classified.code, "insufficient_scope");
});

test("classifyPackageAccessFailure recognizes inaccessible package lookups", () => {
  const classified = classifyPackageAccessFailure("npm error code E404\npackage not found");
  assert.equal(classified.code, "not_found_or_inaccessible");
});

test("getMissingTokenSummary reports the missing-token blocker explicitly", () => {
  const summary = getMissingTokenSummary();
  assert.equal(summary.ok, false);
  assert.equal(summary.code, "missing_token");
});
