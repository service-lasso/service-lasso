import { Header, Pax, ReadEntry } from "tar";

const metadataTypes = new Set(["ExtendedHeader", "OldExtendedHeader", "GlobalExtendedHeader", "NextFileHasLongPath", "OldGnuLongPath", "NextFileHasLongLinkpath"]);
const zero = bytes => bytes.every(byte => byte === 0);

// AC-7G.scoped-tar-parser.R2. Validate original physical framing, not a parser's
// end event. Use the locked public metadata decoder for effective payload sizes;
// the actual readers still enforce semantic inventory; R5 preserves strict
// header predicates while replacing mutable Parser dispatch.
export function assertScopedTarFraming(bytes) {
  const fail = () => { throw new Error("scoped TAR original framing/EOF differs"); };
  if (!Buffer.isBuffer(bytes) || bytes.length < 1024 || bytes.length > 512 * 1024 * 1024 || bytes.length % 512 !== 0) fail();
  let offset = 0, count = 0, extended, globalExtended;
  const ordinaryEntries = [];
  while (offset < bytes.length) {
    const block = bytes.subarray(offset, offset + 512);
    if (zero(block)) {
      if (extended || bytes.length - offset < 1024 || !zero(bytes.subarray(offset))) fail();
      return ordinaryEntries;
    }
    if (++count > 100_000) fail();
    const header = new Header(bytes, offset, extended, globalExtended);
    if (!header.cksumValid || !header.path || (/^(Symbolic)?Link$/u.test(header.type) ? !header.linkpath : !/^(Global)?ExtendedHeader$/u.test(header.type) && header.linkpath) || !Number.isSafeInteger(header.size) || header.size < 0 || header.size > 256 * 1024 * 1024) fail();
    const bodyStart = offset + 512;
    const next = bodyStart + Math.ceil(header.size / 512) * 512;
    if (next > bytes.length) fail();
    if (metadataTypes.has(header.type)) {
      // Header excludes pending PAX fields from intermediary metadata. ReadEntry
      // reapplies them to .size, so Parser's limit alone is not physical authority.
      if (header.size > 1024 * 1024) throw new Error("scoped TAR ignored member/metadata physical byte budget differs");
      if (header.size > 0) {
        const body = bytes.subarray(bodyStart, bodyStart + header.size).toString("utf8");
        if (header.type === "GlobalExtendedHeader") globalExtended = Pax.parse(body, globalExtended, true);
        else if (["ExtendedHeader", "OldExtendedHeader"].includes(header.type)) extended = Pax.parse(body, extended, false);
        else {
          extended ??= Object.create(null);
          extended[header.type === "NextFileHasLongLinkpath" ? "linkpath" : "path"] = body.replace(/\0.*/su, "");
        }
      }
    } else {
      // Header excludes global path/linkpath; ReadEntry instead reapplies a
      // global linkpath after local fields. Retain scoped local-or-raw authority
      // directly, including Header's type and directory zero-size semantics.
      ordinaryEntries.push({ type: header.type, size: header.size, path: extended?.path ?? header.path, linkpath: extended?.linkpath ?? header.linkpath, header, extended: extended ? { ...extended } : undefined, globalExtended: globalExtended ? { ...globalExtended } : undefined, bodyStart, bodyEnd: next });
      extended = undefined;
    }
    offset = next;
  }
  fail();
}

// R5: physical dispatch belongs to the complete framing pass. ReadEntry receives
// the same Header/local/global state and exact original body span, retaining its
// actual emitted interpretation without Parser's mutable-size metadata dispatch.
export async function readScopedTarEntries(bytes, ordinaryEntries, onReadEntry, onIgnoredEntry) {
  for (const authority of ordinaryEntries) {
    const entry = new ReadEntry(authority.header, authority.extended, authority.globalExtended);
    await new Promise((resolve, reject) => {
      entry.once("error", reject);
      entry.once("end", () => {
        if (entry.remain !== 0 || entry.blockRemain !== 0) reject(new Error("scoped TAR observed framing/body remainder differs"));
        else resolve();
      });
      try {
        if (entry.ignore || entry.meta) onIgnoredEntry(entry);
        else onReadEntry(entry);
        entry.resume();
        entry.end(bytes.subarray(authority.bodyStart, authority.bodyEnd));
      } catch (error) { reject(error); }
    });
  }
}
