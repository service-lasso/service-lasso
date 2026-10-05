# NQ1 prospective original-parser regression vectors

Status: UNRUN; declarative vectors for #1643 CA03/CA04/CA06 and NQ1. No executable test driver, parser acceptance, native receipt or qualification is claimed. Each future test must invoke the actual implemented native parser/factory and retain its original native observations; a model repeating a predicate is insufficient. Existing protected gates stay intact.

## Fixture construction and independent assertions

Start from a separately admitted source tuple with all four original raw assets, complete expected inventory, original canonical policy and immutable baseline manifest. Source selection is external authority; adversarial fixtures never enroll a tuple. Build a complete valid authored inventory using only permitted fields/config and generated closed6 provenance. Encode a ZIP independently of the decoder, with little-endian local+central records, UTF8 flag0800, 100644 attrs, method0 or actual RFC1951 method8 and independent CRC32. Record exact original declaration and whole bytes. Give the factory a genuine held `NativeStageRead` created from the original stage writer; observe actual EOF, not a mock `eof:true`.

Success asserts every returned path/mode/raw byte/length/hash independently against the source fixture, sorted inventory and existing TS digest definition, all original native read borrowers and zero-byte EOF, complete source association, and no emitted effect before qualification. Capture original allocator/copy owners; observe actual later ended controls before any FREE assertion. Failure checks no qualified result, original failure classification and retained unresolved owner/resources; merely catching an exception is insufficient. All corruptions update outer CRC/SHA/declaration when necessary so the intended inner predicate is reached.

## ZIP and deflate

| ID | Original input construction | Required outcome |
| --- | --- | --- |
| NQ-Z01 | Entire inventory with stored zero-byte and nonempty files; repeat with fixed/dynamic deflate and independent expected bytes | Complete equal inventory and digests; all three block kinds exercised |
| NQ-Z02 | Valid deflate stream with overlapping distance1 copies, cross-block history and non-byte-aligned terminal code | Exact output/CRC and consumed input, no duplicate expanded envelope |
| NQ-Z03 | Max allowed compressed/expanded/entry/count/ratio/depth at each current actual owner boundary; one unit above in a separate fixture | Bound accepted; above rejected at original tighter bound |
| NQ-Z04 | Full64MiB accepted inventory within original128MiB domain, maximum legal per-entry8MiB, legitimate owner maximumTotalBytes | Entire byte inventory/capsule emission supported with tracked single expanded allocation set |
| NQ-Z05 | Same fixture has early genuine zero read, nonzero read at declared end, changed held object, declared SHA mismatch or late original read | Deny and retain the original read/failure associations, no manufactured terminal EOF |
| NQ-Z06 | EOCD truncated, moved before a tail byte, comment, split disk, mismatched counts or overflowing central offsets | Unsafe rejection before out-of-range access |
| NQ-Z07 | Needed21, flags0/0808/encrypted, method9, extra/comment/disk, directory/symlink/special/0755 attrs | Unsafe rejection; executable source final mode never authorizes ZIP0755 |
| NQ-Z08 | Central/local independent mismatch in name/needed/flags/method/CRC/sizes/nameLength/extra | Unsafe at correspondence predicate despite rehashed whole archive |
| NQ-Z09 | Local records overlap, gap, prefix, duplicate offset, central gap or unreferenced extra local record | Exact contiguous complete region predicate denies |
| NQ-Z10 | Deflate invalid block3, missing EOB, bad LEN/NLEN, oversubscribed alphabets, illegal repeat16 first, reserved length/distance, beyond-window distance | Native decoder denies actual malformed stream |
| NQ-Z11 | Output expected length reached before end code, exact stream followed by junk, extra unused full byte, CRC mismatch or output overrun | No length-only/CRC-only acceptance; complete stream consumption required |
| NQ-Z12 | Every truncation boundary in separately encoded fixed/dynamic/stored blocks and repeat/copy tokens | Every incomplete original denies without unintended allocation growth |

## Gzip, TAR and four-asset associations

| ID | Original input construction | Required outcome |
| --- | --- | --- |
| NQ-A01 | Original gzip with each optional header combination and correct FHCRC; exact canonical TAR including first PAX/directory/policy members | Equal complete baseline and raw policy asset |
| NQ-A02 | Bad optional length/NUL/headerCRC, reserved gzip flags, changed trailer CRC/ISIZE, concatenated stream/trailing byte | Deny under existing single original gzip profile |
| NQ-A03 | Bad octal/header checksum, nonzero bytes after cString NUL, invalid UTF8, special/link record, wrong PAX commit/order/mode | Original canonical TAR rejection |
| NQ-A04 | Omit or duplicate a file/directory/policy; incorrect exact mode/length/hash; nonzero block padding; one terminator block; unaligned/nonzero tail | Complete inventory and original terminal predicate deny |
| NQ-A05 | Correct raw hashes with wrong asset order/name/descriptor tuple/tag/kind or policy contract semantic digest; wrong sums whitespace/order | Actual raw/semantic predicates deny despite outer hash agreement |
| NQ-A06 | Foreign/missing source/publication association with matching catalog row/asset bytes/native OS owner/provider MAC | No source qualification or parser-positive authority |

## Ordered JSON, patterns and authoring

| ID | Original input construction | Required outcome |
| --- | --- | --- |
| NQ-J01 | Pretty member order intentionally differs from lexicographic order; numeric keys2/10/01 mixed with insertion keys; nested arrays and empty containers | Match exact ECMAScript pretty and canonical byte rules separately |
| NQ-J02 | Finite numeric spellings1e0/-0/1.00/1e-7/1e21/subnormal/rounding tie; normalized canonical pretty counterpart | Reader Number conversion and serializer match actual TS; raw pretty equality selects exact bytes |
| NQ-J03 | BOM/invalidUTF8/lone surrogates/decoded duplicate `id` and `\u0069d`/trailing JSON/depth/token/member/string-byte limits | Actual original strict bounds and duplicate predicate deny |
| NQ-J04 | Current policy regex with Unicode escape/property class, lookaround/backreference, casefold and multiline anchors; exact valid and invalid counterparts | Match existing u/iu/imu semantics, no ASCII/std::regex substitute |
| NQ-J05 | Expensive legal pattern/match reaches original deadline, changed source engine/Unicode association or allocator uncertainty | Preserve original end/ownership; no renewed end or uncharged matcher |
| NQ-J06 | Edit exactly allowed id/name/description/version/enabled/developers/tags; local origin and github-derived repository counterparts | Accept only exact typed owner pattern/byte/shape rules |
| NQ-J07 | Change locked command/provider/isolation/artifact/secret/url/container or add/remove locked key; coherently rehash manifest/ZIP | `template_difference_forbidden` contract reached; no authoredBytes shortcut |
| NQ-J08 | Forbidden config filename/value with mixed case/Unicode/multiline, invalidUTF8, config aggregate bound/above, unknown config path | Exact complete owner patterns/path set and quota enforced |
| NQ-J09 | Provenance7th field/wrong tuple/repository/archiveSHA; local origin with repository; derived origin with archiveSHA; wrong derived URL | Existing closed6/origin/repository equality rejection |
| NQ-J10 | Correct authored manifest but declared serviceId/version/manifestSHA differs independently | Actual declaration correspondence denies; declaration never rewritten |

## Complete general manifest validation and integration

For each frozen `validateServiceManifest` helper, retain a valid full baseline counterpart and construct an independently schema-invalid baseline (outer catalog and policy hashes recomputed only as adversarial data, never source approval). Exercise healthcheck alternatives and IDs; env maps; outputvarregex compile; safe log paths and unique IDs; stdin; all hook phases; monitoring/restart/doctor; setup steps/outputs/creates/fingerprint/rerun/provider dependencies; files root IDs/path/mode; isolation exact keys/limits; endpoint kinds/forbidden env blocks/ports; actions modes/command requirement/payload recursive shape/schedules/cron/workflow steps; broker imports/aliases/buckets/exports/generated-secret uniqueness/access grants/writeback/collision; artifact archive/platform/checksum XOR; updates active artifact/install window/running-service dependencies; top schedules prohibition; root execservice declared dependency. Also exercise properties that the actual general validator ignores: native repetition must not invent global closed-object rejection.

NQ-I01 emits chunks from the returned retained inventory, seals an actual native capsule, verifies every accepted entry with `authoredBytes=false`, then changes one allowed authored raw byte after qualification without changing baseline authority. Readback/association must deny; old authoring permission cannot qualify new bytes. NQ-I02 rotates/transfers catalog/source/native object between qualification/emission/seal and verifies retained original association failure. NQ-I03 fails every allocation/read/parser/inflate/emission/flush/native-close boundary and independently observes retained failure carrier/control/charge; no response receipt invents closure. NQ-I04 verifies real later/restarted engine original stage lookup/parse/binding/capsule association plus original native receipt/Audit/recovery effects. These are required future real integration cases, not proof supplied by this proposal.
