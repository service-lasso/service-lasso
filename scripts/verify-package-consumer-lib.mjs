export const PACKAGE_NAME = "@service-lasso/service-lasso";
export const NPMJS_REGISTRY = "https://registry.npmjs.org";
export const GITHUB_PACKAGES_REGISTRY = "https://npm.pkg.github.com";
export const DEFAULT_REGISTRY = NPMJS_REGISTRY;

export function buildPackageSpec(version) {
  const trimmedVersion = version?.trim();
  return trimmedVersion ? `${PACKAGE_NAME}@${trimmedVersion}` : PACKAGE_NAME;
}

export function buildScopedRegistryConfig(registry = DEFAULT_REGISTRY, { includeAuth = false } = {}) {
  const registryUrl = new URL(registry);
  const normalizedRegistry = registry.replace(/\/+$/, "");
  const lines = [`@service-lasso:registry=${normalizedRegistry}`];

  if (includeAuth) {
    lines.push(`//${registryUrl.host}/:_authToken=\${NODE_AUTH_TOKEN}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function registryRequiresToken(registry = DEFAULT_REGISTRY) {
  return registry.replace(/\/+$/, "") === GITHUB_PACKAGES_REGISTRY;
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
        "The selected package registry requires authentication. Provide NODE_AUTH_TOKEN with a token that can read the package, or use the public npm registry for anonymous public installs.",
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
        "The provided token is authenticated but cannot read the package. For GitHub Packages use a classic PAT with read:packages or GITHUB_TOKEN with packages: read and package access granted.",
    };
  }

  if (/E404/i.test(text) || /not found/i.test(text) || /no match found/i.test(text)) {
    return {
      code: "not_found_or_inaccessible",
      message:
        "The package could not be resolved from the selected registry. Confirm the published version exists and that the registry matches the package publish target.",
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
