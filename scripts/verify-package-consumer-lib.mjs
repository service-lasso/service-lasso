export const PACKAGE_NAME = "@service-lasso/service-lasso";
export const DEFAULT_REGISTRY = "https://npm.pkg.github.com";

export function buildPackageSpec(version) {
  const trimmedVersion = version?.trim();
  return trimmedVersion ? `${PACKAGE_NAME}@${trimmedVersion}` : PACKAGE_NAME;
}

export function buildScopedRegistryConfig(registry = DEFAULT_REGISTRY) {
  const registryUrl = new URL(registry);
  const normalizedRegistry = registry.replace(/\/+$/, "");

  return [
    `@service-lasso:registry=${normalizedRegistry}`,
    `//${registryUrl.host}/:_authToken=\${NODE_AUTH_TOKEN}`,
    "",
  ].join("\n");
}

export function classifyPackageAccessFailure(errorText) {
  const text = String(errorText ?? "");

  if (
    /E401/i.test(text) ||
    /authentication token not provided/i.test(text) ||
    /requires authentication/i.test(text)
  ) {
    return {
      code: "missing_auth",
      message:
        "GitHub Packages npm installs require authentication. Provide NODE_AUTH_TOKEN with a classic PAT that has read:packages for local use, or use GITHUB_TOKEN with packages: read in GitHub Actions.",
    };
  }

  if (
    /E403/i.test(text) ||
    /permission_denied/i.test(text) ||
    /read_package/i.test(text) ||
    /read:packages/i.test(text)
  ) {
    return {
      code: "insufficient_scope",
      message:
        "The provided token is authenticated but cannot read the package. Local use needs a classic PAT with read:packages; cross-repo GitHub Actions also need package access granted in the package settings page.",
    };
  }

  if (/E404/i.test(text) || /not found/i.test(text) || /no match found/i.test(text)) {
    return {
      code: "not_found_or_inaccessible",
      message:
        "The package could not be resolved from GitHub Packages. Confirm the published version exists and that the token can see the package from this workflow or consumer repository.",
    };
  }

  return {
    code: "unknown_failure",
    message:
      "Package verification failed for a reason that was not recognized as a standard GitHub Packages auth error. Inspect the npm output and package settings before retrying.",
  };
}

export function getMissingTokenSummary() {
  return {
    ok: false,
    classification: "blocked",
    code: "missing_token",
    message:
      "NODE_AUTH_TOKEN is required to verify GitHub Packages installs. Use a classic PAT with read:packages locally, or run the verifier in GitHub Actions with GITHUB_TOKEN and packages: read.",
  };
}
