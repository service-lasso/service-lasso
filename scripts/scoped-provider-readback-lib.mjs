const BYTE_LIMIT = 256 * 1024 * 1024;
export async function boundedProviderBody(response, maximum = BYTE_LIMIT) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > maximum)) throw new Error("provider declared body budget differs");
  if (!response.body) throw new Error("provider body missing");
  const reader = response.body.getReader(), pieces = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error("provider body byte budget exceeded"); }
      pieces.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  if (size === 0) throw new Error("provider body empty");
  return Buffer.concat(pieces, size);
}
export async function readAuthenticatedArtifact(url, repository, token) {
  const initial = new URL(url);
  if (initial.origin !== "https://api.github.com" || initial.username || initial.password || !initial.pathname.startsWith(`/repos/${repository}/actions/artifacts/`) || !/^\/repos\/[^/]+\/[^/]+\/actions\/artifacts\/[1-9][0-9]*\/zip$/u.test(initial.pathname)) throw new Error("artifact source URL differs");
  const signal = AbortSignal.timeout(15_000);
  const response = await fetch(initial.href, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" }, redirect: "manual", signal });
  if (response.status === 302) {
    const location = new URL(response.headers.get("location"), initial);
    if (location.protocol !== "https:" || location.username || location.password || !(location.hostname.endsWith(".blob.core.windows.net") || location.hostname.endsWith(".actions.githubusercontent.com"))) throw new Error("artifact signed redirect differs");
    const body = await fetch(location.href, { redirect: "error", signal });
    if (!body.ok) throw new Error("artifact signed body unavailable");
    return boundedProviderBody(body);
  }
  if (!response.ok) throw new Error("artifact body unavailable");
  return boundedProviderBody(response);
}
export async function readOwnedReleaseAsset(url, repository, token) {
  if (!["service-lasso/service-lasso", "service-lasso/lasso-serviceadmin", "service-lasso/lasso-secretsbroker"].includes(repository)) throw new Error("release asset repository is not source-owned");
  const initial = new URL(url);
  if (initial.origin !== "https://api.github.com" || initial.username || initial.password || !new RegExp(`^/repos/${repository}/releases/assets/[1-9][0-9]*$`, "u").test(initial.pathname) || initial.search || initial.hash) throw new Error("release asset source URL differs");
  const signal = AbortSignal.timeout(15_000);
  const headers = { accept: "application/octet-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(initial.href, { headers, redirect: "manual", signal });
  if (response.status === 302) {
    const location = new URL(response.headers.get("location"), initial);
    if (location.protocol !== "https:" || location.username || location.password || !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(location.hostname)) throw new Error("release asset signed redirect differs");
    const body = await fetch(location.href, { redirect: "error", signal });
    if (!body.ok) throw new Error("release asset signed body unavailable");
    return boundedProviderBody(body);
  }
  if (!response.ok) throw new Error("release asset body unavailable");
  return boundedProviderBody(response);
}
