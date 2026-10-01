import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("AC-8A launchd package is root-owned, resident and owner-activated", () => {
  const plist = read("scripts/host-runner-service/darwin/com.service-lasso.host-runner.plist.in");
  const install = read("scripts/host-runner-service/darwin/install.sh");
  assert.match(plist, /com\.service-lasso\.host-runner/); assert.match(plist, /KeepAlive/);
  assert.match(install, /id -u\).*0/); assert.match(install, /-o root -g wheel -m 0500/);
  assert.match(install, /launchctl bootstrap system/); assert.doesNotMatch(install, /curl|brew install|github token/i);
});

test("AC-8C/8D Darwin source uses held descriptors and closes one-use capability", () => {
  const source = read("scripts/host-runner-service/darwin/service-lasso-host-runner.c");
  assert.match(source, /fstat\(fd/); assert.match(source, /CC_SHA256_Update/);
  assert.match(source, /xpc_dictionary_dup_fd\(message, "parent_fd"\)/);
  assert.match(source, /xpc_dictionary_dup_fd\(message, "leaf_fd"\)/);
  assert.match(source, /xpc_dictionary_dup_fd\(message, "capability_fd"\)/);
  assert.match(source, /expiry > \(uint64_t\)time/); assert.match(source, /exact_digest\(message, "parent_sha256"/);
  assert.match(source, /exact_digest\(message, "leaf_sha256"/); assert.match(source, /close\(capability\)/);
  assert.doesNotMatch(source, /lstat\(|ReadFile|open\(.*path/i);
});

test("AC-8B/8E source retains Darwin identity and explicit non-native boundaries", () => {
  const source = read("scripts/host-runner-service/darwin/service-lasso-host-runner.c");
  const owner = read("docs/operations/host-runner-service-owner-package.md");
  assert.match(source, /xpc_connection_get_audit_token/); assert.match(source, /proc_pidinfo/);
  assert.match(source, /proc_pidpath/); assert.match(source, /audit_token_to_pid/);
  assert.match(owner, /Native acceptance remains unavailable/); assert.match(owner, /csops/);
});

test("AC-8E platform contracts reject mutable pre-open writer paths", () => {
  const linux = read("scripts/host-runner-service/linux/sealed-fd-contract.c");
  const windows = read("scripts/host-runner-service/windows/HeldHandleContract.cs");
  assert.match(linux, /F_GET_SEALS/); assert.match(linux, /F_SEAL_WRITE/);
  assert.match(windows, /FileShare\.Read/); assert.match(windows, /FileShare\.Write \| FileShare\.Delete/);
});
