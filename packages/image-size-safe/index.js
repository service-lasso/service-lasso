const unsupportedMessage =
  "Build-time image dimension parsing is disabled until an upstream parser fixes the tracked denial-of-service advisories.";

export const types = Object.freeze([]);
export function disableTypes() {}
export function imageSize() {
  throw new Error(unsupportedMessage);
}
export default imageSize;
