import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Pinned release of the pseudo-terminal host bundled into Core artifacts.
 * Every platform asset is digest-checked before it is staged.
 */
export const PTY_HELPER_RELEASE = {
  repository: "service-lasso/service-lasso-pty",
  tag: "v0.1.1",
  assets: [
    {
      platform: "win32-x64",
      name: "service-lasso-pty-windows-amd64.exe",
      executable: "service-lasso-pty.exe",
      sha256: "e0f7266ea12e38214db992bbbb185332966ac0b05c6afa359b266759d82b8dec",
    },
    {
      platform: "linux-x64",
      name: "service-lasso-pty-linux-amd64",
      executable: "service-lasso-pty",
      sha256: "71f56e6df50f7465a632eb94bba7f3008f73050a79d2672c41ade80bd67b8188",
    },
    {
      platform: "linux-arm64",
      name: "service-lasso-pty-linux-arm64",
      executable: "service-lasso-pty",
      sha256: "818978e4fd226f14a2005ae33e891f66b7e668dc9d45f2fa29b05964a14f701e",
    },
    {
      platform: "darwin-x64",
      name: "service-lasso-pty-darwin-amd64",
      executable: "service-lasso-pty",
      sha256: "676782bc7ef8436872d805454c16aee3bdf8f2792488b2514ebc0255e9d6dc25",
    },
    {
      platform: "darwin-arm64",
      name: "service-lasso-pty-darwin-arm64",
      executable: "service-lasso-pty",
      sha256: "1d607fda97ceb7cbacd192c36f1a1931e72e5a852676b4d6cb1ab10ba0962071",
    },
  ],
};

function assetUrl(name) {
  return `https://github.com/${PTY_HELPER_RELEASE.repository}/releases/download/${PTY_HELPER_RELEASE.tag}/${name}`;
}

/**
 * Download each pinned helper into `native/pty/<platform>/` and write the
 * checksums manifest the runtime verifies before spawning a terminal service.
 */
export async function stagePtyHelpers({ artifactRoot, token = process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN ?? process.env.GITHUB_TOKEN } = {}) {
  if (!artifactRoot) {
    throw new Error("stagePtyHelpers requires an artifact root");
  }
  const root = path.join(artifactRoot, "native", "pty");
  const checksums = {};
  for (const asset of PTY_HELPER_RELEASE.assets) {
    const response = await fetch(assetUrl(asset.name), {
      headers: {
        accept: "application/octet-stream",
        ...(token ? { authorization: `Bearer ${String(token).trim()}` } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      throw new Error(`PTY helper asset ${asset.name} download failed with HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.sha256) {
      throw new Error(`PTY helper asset ${asset.name} checksum mismatch`);
    }
    const directory = path.join(root, asset.platform);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, asset.executable), bytes, { mode: 0o755 });
    checksums[`${asset.platform}/${asset.executable}`] = digest;
  }
  await writeFile(path.join(root, "checksums.json"), `${JSON.stringify(checksums, null, 2)}\n`, { mode: 0o600 });
  return checksums;
}
