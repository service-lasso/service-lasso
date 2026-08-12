"use strict";

const unsupportedMessage =
  "Build-time image dimension parsing is disabled until an upstream parser fixes the tracked denial-of-service advisories.";
function setConcurrency() {}
async function imageSizeFromFile() {
  throw new Error(unsupportedMessage);
}
module.exports = { imageSizeFromFile, setConcurrency };
