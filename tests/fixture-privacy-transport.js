// Source-owned bounded transport on the original child stdout. Correlation is
// local to one execFile invocation; it supplies no hostile-host authentication.
export const fixturePrivacyBootstrap = `
$ErrorActionPreference='Stop'
$WarningPreference='SilentlyContinue'
$InformationPreference='SilentlyContinue'
$ProgressPreference='SilentlyContinue'
$script:fixtureNonce=$env:SERVICE_LASSO_FIXTURE_PRIVACY_NONCE
$script:fixtureRole=$env:SERVICE_LASSO_FIXTURE_PRIVACY_ROLE
$script:fixtureSequence=0
function Emit-FixtureFrame([string]$event) {
  $script:fixtureSequence++
  [Console]::Out.Write('SLFP2|'+$script:fixtureNonce+'|'+$script:fixtureRole+'|'+$script:fixtureSequence+'|'+$event+[char]10)
}
Emit-FixtureFrame 'boot_enter'
Emit-FixtureFrame 'parse_enter'
try { $payload=[ScriptBlock]::Create($env:SERVICE_LASSO_FIXTURE_PRIVACY_PAYLOAD) }
catch { $privateParseError=$_; Emit-FixtureFrame 'parse_failed'; exit 1 }
Emit-FixtureFrame 'parse_ok'
// Restore the original payload's script scope: its source-owned failure and
// disposal functions use $script: state. Invoke only the parsed in-memory block.
try { . $payload }
catch { $privateInvocationError=$_; exit 1 }
`;

const normal = ["boot_enter", "parse_enter", "parse_ok", "compiler_enter", "compiler_ok"];
const native = /^(?:acquire|information|type|redirect|security|owner|inventory|identity|descriptor|protect|readback)$/;
const finalResponses = [JSON.stringify({ schema: "service-lasso.fixture-privacy-response.v1", outcome: "passed", operation: null }),
  ...["compiler", "prepare", "acquire", "information", "type", "redirect", "security", "owner", "inventory", "identity", "descriptor", "protect", "readback", "release"]
    .map(operation => JSON.stringify({ schema: "service-lasso.fixture-privacy-response.v1", outcome: "failed", operation }))];
export function createFixturePrivacyDecoder(nonce, role) {
  if (!/^[0-9a-f]{32}$/.test(nonce) || !["v", "p"].includes(role)) throw new Error("Invalid privacy transport binding.");
  let bytes = 0;
  let witnessBytes = 0;
  let pending = "";
  let final = "";
  let malformed = false;
  let terminal = false;
  const events = [];
  const fail = () => { malformed = true; pending = ""; final = ""; };
  return {
    invalidate: fail,
    feed(chunk) {
      if (malformed) return;
      // Check before retaining/converting the incoming bytes.
      const size = typeof chunk === "string" ? Buffer.byteLength(chunk) : Buffer.isBuffer(chunk) ? chunk.length : 16_385;
      if (bytes + size > 16_384) { fail(); return; }
      bytes += size;
      const text = typeof chunk === "string" ? chunk : chunk.toString("latin1");
      if (/[^\x00-\x7f]/.test(text)) { fail(); return; }
      for (const character of text) {
        if (final !== "") { final += character; continue; }
        if (pending === "" && character === "{") { final = character; continue; }
        if (pending.length + 1 > 128) { fail(); return; }
        pending += character;
        if (!"SLFP2|".startsWith(pending) && !pending.startsWith("SLFP2|")) { fail(); return; }
        if (character !== "\n") continue;
        const line = pending;
        pending = "";
        if (line.length > 128 || witnessBytes + line.length > 768 || events.length >= 6 || terminal) { fail(); return; }
        const match = /^SLFP2\|([0-9a-f]{32})\|(v|p)\|([1-6])\|([a-z_]+)\n$/.exec(line);
        if (!match || match[1] !== nonce || match[2] !== role || Number(match[3]) !== events.length + 1) { fail(); return; }
        const event = match[4];
        const index = events.length;
        const alternate = (index === 2 && event === "parse_failed") || (index === 4 && event === "compiler_failed");
        if (!alternate && (index < 5 ? event !== normal[index] : !event.startsWith("native_enter_") || !native.test(event.slice(13)))) { fail(); return; }
        events.push(event);
        witnessBytes += line.length;
        terminal = alternate;
      }
    },
    finish(decodeFinal) {
      let response;
      let partial = false;
      if (!malformed && pending === "" && final !== "") response = decodeFinal(final);
      if (final !== "" && response === undefined) {
        partial = finalResponses.some(value => value.startsWith(final));
        if (!partial) malformed = true;
      }
      // Compiler failure keeps the original failed final JSON; it cannot pass.
      if (response !== undefined && (events.length < 5 ||
        (terminal && response !== "compiler") || (response === "compiler" && !terminal) ||
        (!terminal && events.length === 5 && response !== "prepare") ||
        (response === "passed" && events.length !== 6))) {
        malformed = true; response = undefined;
      }
      return Object.freeze({ response,
        observation: Object.freeze({ schema: "service-lasso.fixture-privacy-transport.v2",
          state: malformed ? "malformed" : partial || pending !== "" || final === "" ? "unavailable" : "complete",
          events: Object.freeze([...events]) }) });
    },
  };
}
