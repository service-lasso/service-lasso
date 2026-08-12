export const SUPPORTED_RELEASE_PLATFORMS = ["win32", "linux", "darwin"];

export function getExpectedReleaseAssetNames(version) {
  if (!version || typeof version !== "string") {
    throw new Error("A release version/tag is required to compute expected release asset names.");
  }

  return [
    `service-lasso-${version}.tar.gz`,
    `service-lasso-bundled-${version}.tar.gz`,
    ...SUPPORTED_RELEASE_PLATFORMS.map((platform) =>
      platform === "win32" ? `service-lasso-${version}-${platform}.zip` : `service-lasso-${version}-${platform}.tar.gz`,
    ),
    ...SUPPORTED_RELEASE_PLATFORMS.map((platform) =>
      platform === "win32"
        ? `service-lasso-bundled-${version}-${platform}.zip`
        : `service-lasso-bundled-${version}-${platform}.tar.gz`,
    ),
  ];
}

export function compareReleaseAssets(version, actualAssetNames) {
  const expected = getExpectedReleaseAssetNames(version);
  const actual = [...new Set(actualAssetNames)].sort();
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  return {
    version,
    expected,
    actual,
    missing: expected.filter((name) => !actualSet.has(name)),
    unexpected: actual.filter((name) => !expectedSet.has(name)),
  };
}
