import { Header, Pax } from "tar";

const metadataTypes = new Set(["ExtendedHeader", "OldExtendedHeader", "GlobalExtendedHeader", "NextFileHasLongPath", "OldGnuLongPath", "NextFileHasLongLinkpath"]);
const zero = bytes => bytes.every(byte => byte === 0);

// AC-7G.scoped-tar-parser.R2. Validate original physical framing, not a parser's
// end event. Use the locked public metadata decoder for effective payload sizes;
// the actual readers still enforce semantic inventory and strict parser errors.
export function assertScopedTarFraming(bytes) {
  const fail = () => { throw new Error("scoped TAR original framing/EOF differs"); };
  if (!Buffer.isBuffer(bytes) || bytes.length < 1024 || bytes.length > 512 * 1024 * 1024 || bytes.length % 512 !== 0) fail();
  let offset = 0, count = 0, extended, globalExtended;
  while (offset < bytes.length) {
    const block = bytes.subarray(offset, offset + 512);
    if (zero(block)) {
      if (extended || bytes.length - offset < 1024 || !zero(bytes.subarray(offset))) fail();
      return;
    }
    if (++count > 100_000) fail();
    const header = new Header(bytes, offset, extended, globalExtended);
    if (!header.cksumValid || !Number.isSafeInteger(header.size) || header.size < 0 || header.size > 256 * 1024 * 1024) fail();
    const bodyStart = offset + 512;
    const next = bodyStart + Math.ceil(header.size / 512) * 512;
    if (next > bytes.length) fail();
    if (metadataTypes.has(header.type)) {
      // Oversized metadata is left to the actual parser's ignoredEntry denial;
      // never parse or install an override that the parser itself will ignore.
      if (header.size > 0 && header.size <= 1024 * 1024) {
        const body = bytes.subarray(bodyStart, bodyStart + header.size).toString("utf8");
        if (header.type === "GlobalExtendedHeader") globalExtended = Pax.parse(body, globalExtended, true);
        else if (["ExtendedHeader", "OldExtendedHeader"].includes(header.type)) extended = Pax.parse(body, extended, false);
        else {
          extended ??= Object.create(null);
          extended[header.type === "NextFileHasLongLinkpath" ? "linkpath" : "path"] = body.replace(/\0.*/su, "");
        }
      }
    } else extended = undefined;
    offset = next;
  }
  fail();
}
