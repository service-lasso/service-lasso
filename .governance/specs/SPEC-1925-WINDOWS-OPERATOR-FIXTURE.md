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

WIN-FIXTURE-3 controlled test budgets: Windows synthetic launch/ready/stalled
initialization use 20s/15s/15s, compared with unchanged POSIX 5s/4s/1s.
These budgets include the new matching-host PowerShell privacy setup before the
controlled condition. The stalled case must observe its actual initialization
entry marker before asserting forced termination and failed cleanup. They are
ordinary test setup budgets, not product/native deadlines; no further widening
is authorized by this slice.

Observed hosted evidence (2026-11-15): run43614942357, exact3efaccf0e82b4f97fa9eaa157dd25e1c9811e1f8,
both Ubuntu and Windows jobs terminal SUCCESS. Windows passed all10 protocol/
privacy cases and the actual fresh Core build/authenticated read smoke. Its
receipt records Node22.23.2/npm10.9.8/TypeScript7.0.2, build exit0,
artifact SHA256 2d56792a3841f38e5e478da419c2d6b8c557543d0df36d7f4c8b6b25bbc580fb,
inventory SHA256 99377a00064fcc02380f6772afd97fd4e9dc682b4106927bcdf330ad1385f5f2,
actual initialization, natural child0, no forced termination, server/parent
port closure and credential removal. Public privacy evidence contains no SID/ACE
values. Linux additionally passed the genuine five-action lifecycle/control
preservation test. Earlier Windows setup/EEXIST/dirty-source failures remain
failed observations, not retroactively passed. Workflow-only9e130a57 adds the
checkout-policy trigger and has separate host checks. This is ordinary source
API integration; template/native/privileged admission and publication excluded.
