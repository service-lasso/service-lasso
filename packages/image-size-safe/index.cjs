"use strict";

const unsupportedMessage =
  "Build-time image dimension parsing is disabled until an upstream parser fixes the tracked denial-of-service advisories.";
const types = Object.freeze([]);
function disableTypes() {}
function imageSize() {
  throw new Error(unsupportedMessage);
}
module.exports = imageSize;
module.exports.default = imageSize;
module.exports.disableTypes = disableTypes;
module.exports.imageSize = imageSize;
module.exports.types = types;
