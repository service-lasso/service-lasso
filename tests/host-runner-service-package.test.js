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
  assert.match(plist, /MachServices/);
  assert.match(install, /id -u\).*0/); assert.match(install, /-o root -g wheel -m 0500/);
  assert.match(install, /launchctl bootstrap system/); assert.match(install, /codesign --verify/); assert.match(install, /mktemp/); assert.match(install, /old_binary/); assert.doesNotMatch(install, /curl|brew install|github token/i);
});

test("AC-8C/8D Darwin source uses held descriptors and daemon-issued one-use capability", () => {
  const source = read("scripts/host-runner-service/darwin/service-lasso-host-runner.c");
  assert.match(source, /fstat\(fd/); assert.match(source, /CC_SHA256_Update/);
  assert.match(source, /xpc_dictionary_dup_fd\(message, "parent_fd"\)/);
  assert.match(source, /xpc_dictionary_dup_fd\(message, "leaf_fd"\)/);
  assert.match(source, /issue_capability/); assert.match(source, /consume_capability/); assert.match(source, /revoke_peer/);
  assert.match(source, /expiry > \(uint64_t\)time/); assert.match(source, /exact_digest\(message, "parent_sha256"/);
  assert.match(source, /exact_digest\(message, "leaf_sha256"/); assert.match(source, /close\(capability\)/);
  assert.match(source, /reviewed_client/); assert.match(source, /strict_code_identity/); assert.match(source, /CLIENT_REQUIREMENT/);
  assert.match(source, /grants\[i\]\.birth/); assert.match(source, /grants\[i\]\.image_sha256/);
  assert.match(source, /memcmp\(envelope, "SLHR", 4\)/); assert.doesNotMatch(source, /for \(ssize_t i = 0; i \+ SHA_LEN <= n/);
  assert.doesNotMatch(source, /xpc_dictionary_get_string\(message, "(?:parent|leaf|capability)_path"/);
});

test("AC-8B/8E source owns a resident primary, captures its audit identity, and keeps activation boundaries honest", () => {
  const source = read("scripts/host-runner-service/darwin/service-lasso-host-runner.c");
  const owner = read("docs/operations/host-runner-service-owner-package.md");
  assert.match(source, /posix_spawn/); assert.match(source, /TASK_AUDIT_TOKEN/); assert.match(source, /csops/);
  assert.match(source, /proc_pidinfo/); assert.match(source, /pbi_ppid != getpid/); assert.match(source, /audit_token_to_pid/);
  assert.match(source, /hash_pid_image/); assert.match(source, /O_NOFOLLOW/); assert.match(source, /reap_primary_on_exit/);
  assert.match(source, /strcmp\(argv\[2\], STATE_DIR\)/); assert.match(source, /private-receipt\.log/);
  assert.match(owner, /Native acceptance remains unavailable/); assert.match(owner, /csops/);
});

test("AC-8E platform contracts reject mutable pre-open writer paths", () => {
  const linux = read("scripts/host-runner-service/linux/sealed-fd-contract.c");
  const windows = read("scripts/host-runner-service/windows/HeldHandleContract.cs");
  assert.match(linux, /F_GET_SEALS/); assert.match(linux, /F_GETFL/); assert.match(linux, /O_ACCMODE/); assert.match(linux, /F_SEAL_WRITE/); assert.match(linux, /SHA256/);
  assert.match(windows, /CreateFile/); assert.match(windows, /FileFlagOpenReparsePoint/); assert.match(windows, /GetFileInformationByHandle/); assert.match(windows, /null DACL denied/); assert.match(windows, /BuiltinAdministratorsSid/); assert.match(windows, /FileShare\.Write \| FileShare\.Delete/);
});

test("installer restores all replaced state and denies links before privileged mutation", () => {
  const install = read("scripts/host-runner-service/darwin/install.sh");
  const uninstall = read("scripts/host-runner-service/darwin/uninstall.sh");
  assert.match(install, /safe_ancestors/); assert.match(install, /safe_node/);
  assert.match(install, /old_binary/); assert.match(install, /old_plist/); assert.match(install, /was_loaded/);
  assert.match(install, /launchctl bootstrap system "\$plist"/); assert.match(install, /rollback\(\)/);
  assert.match(install, /rm -f "\$old_binary" "\$old_plist"/);
  assert.match(uninstall, /launchctl bootout/); assert.match(uninstall, /launchctl print "\$label"/);
});

test("producer contract is versioned and binds consumer acceptance to a generated candidate hash", () => {
  const contract = JSON.parse(read("scripts/host-runner-service/contract-v1.json"));
  const build = read("scripts/host-runner-service/darwin/build.sh");
  assert.equal(contract.protocol, "service-lasso.host-runner.v1");
  assert.equal(contract.consumer, "service-lasso-cli");
  assert.match(JSON.stringify(contract), /capability_fd/); assert.match(JSON.stringify(contract), /parent_leaf_binding/); assert.match(build, /candidate_sha256/);
  assert.match(contract.non_claims[0], /CLI acceptance/);
});
