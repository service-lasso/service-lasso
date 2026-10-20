// Only trusted bigint:true OS stats may create these private identities.
const U64_MAX = 18446744073709551615n;
export const DIRECTORY_IDENTITY_SCHEMA = "service-lasso.native-directory-identity.v1";
export function nativeUnsigned(value) { return typeof value === "bigint" && value >= 0n && value <= U64_MAX; }
export function nativeIdentity(entry) {
  if (!nativeUnsigned(entry.dev) || !nativeUnsigned(entry.ino) || entry.ino === 0n || !nativeUnsigned(entry.size) || typeof entry.mtimeNs !== "bigint") throw new Error("first_custody_exact_file_identity_unavailable");
  return { dev: entry.dev, ino: entry.ino, size: entry.size, mtimeNs: entry.mtimeNs };
}
export function sameNativeIdentity(left, right) {
  const a = nativeIdentity(left), b = nativeIdentity(right);
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;
}
export function directoryIdentity(entry) {
  if (!nativeUnsigned(entry.dev) || !nativeUnsigned(entry.ino) || entry.ino === 0n) throw new Error("first_custody_directory_identity_unavailable");
  return { schema: DIRECTORY_IDENTITY_SCHEMA, dev: entry.dev.toString(10), ino: entry.ino.toString(10) };
}
function decimal(value, positive) {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(value) && BigInt(value) <= U64_MAX && (!positive || value !== "0");
}
export function validDirectoryIdentity(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === "dev,ino,schema" && value.schema === DIRECTORY_IDENTITY_SCHEMA && decimal(value.dev, false) && decimal(value.ino, true);
}
export function sameDirectoryIdentity(a, b) {
  return validDirectoryIdentity(a) && validDirectoryIdentity(b) && a.dev === b.dev && a.ino === b.ino;
}
// UID/GID/mode remain bounded exact numbers in persisted ownership records.
export function nativeOwnerNumber(value) {
  if (!nativeUnsigned(value) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("first_custody_exact_owner_unavailable");
  return Number(value);
}