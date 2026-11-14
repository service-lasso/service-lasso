# Ordinary Windows shared fixture portability — #1925

Active fixture-only slice WIN-FIXTURE-1..4. Existing current-owner+SYSTEM privacy
policy, existing Core API/auth and ordinary source build; no new authority,
provider settings, privilege escalation, DPAPI adoption, protected native journal
or Windows native authoring/package qualification.

WIN-FIXTURE-1: Explicit --npm-cli selects an absolute regular npm-cli.js, records
its SHA256 and version, and invokes through exact process.execPath with literal
argument arrays/shell:false. Windows build mode requires it; Linux default remains
compatible. Record selected Node binary hash. npm's declared build command remains
npm run build; no new download, shell interpolation or lifecycle hook is introduced.

WIN-FIXTURE-2: Reusable scripts/operator-e2e-fixture-private.mjs exports
createPrivateDirectory(absentAbsolutePath), verifyPrivateDirectory(path), and
writePrivateJsonFile(file,value) and additive writePrivateFile(file,bytesOrString).
The generic exclusive writer caps8MiB and zeros only an internal copy; JSON caps
1MiB. Both perform empty-file owner/ACL preparation before held writes. Linux verifies current-owner0700/0600. Windows
uses constant reviewed operator-e2e-fixture-private-dir.ps1 through absolute
System32 PowerShell -NoProfile -NonInteractive -File with literal arguments.
Create/read back current TokenUser owner, protected root DACL, only current owner
and SYSTEM FullControl inheritable entries; refuse unexpected/denied ACEs,
reparse/redirects, wrong owner, invalid path or pre-existing create target. Never
claim Unix mode bits establish NTFS privacy. No secret/raw evidence write before
private root verification. Exclusive connection file is created empty, inherited
ACL and owner read back, then the held file is written; recheck named identity
and directory/file permissions. Raw errors/credentials never reach stdout.

WIN-FIXTURE-3: Preserve finite worker/controller cleanup and evidence truth.
Windows TerminateProcess semantics may force SIGTERM before POSIX SIGKILL; report
observed termination as failed, never natural cleanup PASS. Add private APPDATA/
LOCALAPPDATA paths before Core import. Existing source/artifact/actual token actor
and read-only smoke contracts remain unchanged.

WIN-FIXTURE-4: Dedicated hosted Ubuntu/Windows x64 CI performs scripts-disabled
npm ci, fixture privacy/protocol/path/failure tests and fresh source-built real
Core authenticated read smoke with natural teardown. Windows additionally proves
actual DACL privacy and refusal of extra ACE/reparse paths; source-only mocks do
not qualify Windows. Linux separately runs actual operator-source-e2e-lifecycle
five-action test against the same fresh build, never labeled Windows acceptance.
Distinct root source review precedes execution; actual Windows terminal CI PASS,
normal squash/develop merge, postmerge applicable proof and clean closure required.
Freeze landed fixture SHA for both client platform consumers.

WIN-FIXTURE-4 checkout prerequisite: packages/core/cli.js uses LF explicitly.
The Windows source-clean preflight identified its sole changed path by matching
the bounded status hash; npm bin-links normalizes CRLF shebangs even with install
scripts disabled. Preserve the source-clean gate by stable checkout bytes, never
restore/ignore a modified source after installation.
