import { bootstrapReleaseMetadataToken } from "./operator-tool-packaging-lib.mjs";

// Delete the CI-only credential before loading the verifier or permitting any child process.
bootstrapReleaseMetadataToken();
await import("./verify-mcp-packaged.mjs");
