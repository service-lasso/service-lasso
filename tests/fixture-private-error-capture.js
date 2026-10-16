import { types } from "node:util";

const retained = new WeakMap();
const constructed = new WeakMap();
// A data-capture constructor, not a native/denial capability. Only a known
// primitive diagnostic is captured; the original Error remains independent.
export function createFixtureOwnedError(message) {
  if (typeof message !== "string") throw new TypeError("Owned diagnostic requires primitive text.");
  const original = new Error(message);
  constructed.set(original, { message });
  return original;
}
// Exact originals are retained independently of the useful data projection.
export function retainFixtureOriginals(owner, rows) {
  retained.set(owner, rows.map(row => ({ stage: row.stage, original: row.error })));
}
export function fixtureOriginalsMatch(owner, originals) {
  const rows = retained.get(owner);
  return !!rows && rows.length === originals.length && rows.every((row, index) => Object.is(row.original, originals[index]));
}
export function captureFixtureErrors(rows) {
  const seen = new Map(); let characters = 0, nodes = 0;
  const unavailable = () => { throw new Error("Useful private failure capture unavailable; originals retained."); };
  const text = value => {
    if (value.length > 16384 || (characters += value.length) > 65536) unavailable();
    return value;
  };
  const data = (object, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor && !Object.hasOwn(descriptor, "value")) unavailable();
    return descriptor;
  };
  const copy = (original, depth) => {
    if (depth > 8 || ++nodes > 64) unavailable();
    if (original === null) return null;
    if (original === undefined) return { kind: "undefined" };
    if (typeof original === "string") return text(original);
    if (typeof original === "boolean" || typeof original === "number" && Number.isFinite(original)) return original;
    if ((typeof original !== "object" && typeof original !== "function") || types.isProxy(original) || !types.isNativeError(original)) unavailable();
    if (seen.has(original)) return { kind: "cycle", ordinal: seen.get(original) };
    const ordinal = seen.size; seen.set(original, ordinal);
    const owned = constructed.get(original);
    if (owned) return { ordinal, message: text(owned.message) };
    // Pinned V8 JSReceiver::GetOwnPropertyDescriptor treats JS accessor pairs
    // as descriptors, not calls. Native Error's stack accessor is NEVER touched
    // (neither enumeration nor stack/name/prototype/formatter inspection).
    // Eligible fields are exact own message/cause/errors DATA properties only.
    const message = data(original, "message"), cause = data(original, "cause"), errors = data(original, "errors");
    if (!message || typeof message.value !== "string") unavailable();
    const result = { ordinal, message: text(message.value) };
    if (cause) result.cause = copy(cause.value, depth + 1);
    if (errors) {
      const actual = errors.value;
      if (types.isProxy(actual) || !Array.isArray(actual)) unavailable();
      const length = data(actual, "length");
      if (!length || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > 64) unavailable();
      result.errors = [];
      for (let index = 0; index < length.value; index++) {
        const element = data(actual, String(index)); if (!element) unavailable();
        result.errors.push(copy(element.value, depth + 1));
      }
    }
    return result;
  };
  const snapshot = rows.map((row, ordinal) => ({ stage: row.stage, ordinal, error: copy(row.error, 0) }));
  const json = JSON.stringify(snapshot);
  if (Buffer.byteLength(json, "utf8") > 65536) unavailable();
  return json;
}
