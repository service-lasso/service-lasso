import { lstat, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";
import { assertCoreNativeOwnerAsset } from "./operator-tool-tui-pair-contract.mjs";
const unsettledWriters = new WeakMap();

// Owned byte correspondence only. These descriptors do not authenticate loaded
// images or native holder/producer identities.
export async function settleTuiPairResources(resources) {
  const failures = [];
  for (const resource of resources) {
    try { await resource.close(); } catch (original) { failures.push(original); }
  }
  return failures;
}
async function regularFile(file, resources) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > 256 * 1024 * 1024) throw new Error("TUI pair file is not bounded regular bytes");
  const handle = await open(file, "r"); resources.push(handle);
  const actual = await handle.stat();
  if (!actual.isFile() || actual.dev !== before.dev || actual.ino !== before.ino || actual.size !== before.size) throw new Error("TUI pair file changed during readback");
  return handle;
}
async function boundedReadback(handle) {
  const before = await handle.stat();
  if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > 256 * 1024 * 1024) throw new Error("TUI pair readback capacity differs");
  const bytes = Buffer.alloc(before.size + 1); let offset = 0;
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  const after = await handle.stat();
  if (offset !== before.size || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino) throw new Error("TUI pair readback changed");
  return bytes.subarray(0, offset);
}
async function writeExclusive(file, bytes) {
  const writer = await open(file, "wx", 0o755);
  let primary, primaryRecorded = false;
  try { await writer.writeFile(bytes); } catch (original) { primaryRecorded = true; primary = original; }
  try { await writer.close(); }
  catch (original) {
    const failure = new AggregateError([...(primaryRecorded ? [primary] : []), original], "TUI pair writer settlement failed");
    unsettledWriters.set(failure, { writer, bytes });
    throw failure;
  }
  if (primaryRecorded) throw primary;
}
export async function extractTuiPair({ archivePath, asset, root }) {
  const resources = [];
  try {
    const archiveHandle = await regularFile(archivePath, resources);
    const archive = await boundedReadback(archiveHandle);
    const contract = { platform: asset.platform, name: asset.name, sha256: asset.sha256,
      executable: asset.executable, members: asset.members };
    const members = assertCoreNativeOwnerAsset(contract, archive);
    // No adoption of an existing extraction root, including an empty one.
    await mkdir(root);
    await mkdir(path.join(root, ".service-lasso-tui"));
    const readbacks = [], readers = [];
    for (const member of members) {
      const file = path.join(root, ...member.path.split("/"));
      // Settle writable descriptors before execution (Linux rejects execution
      // while a writable descriptor is open); retain read descriptors through use.
      await writeExclusive(file, member.bytes);
      const reader = await regularFile(file, resources);
      readers.push({ file, handle: reader, member });
      const bytes = await boundedReadback(reader); readbacks.push(bytes);
      if (!bytes.equals(member.bytes)) throw new Error("TUI pair extracted member readback differs");
    }
    const verifyInventory = async () => {
      for (const directory of [root, path.join(root, ".service-lasso-tui")]) {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("TUI pair extraction directory changed");
      }
      const rootEntries = await readdir(root, { withFileTypes: true });
      const privateEntries = await readdir(path.join(root, ".service-lasso-tui"), { withFileTypes: true });
      if (rootEntries.length !== 2 || rootEntries.some(entry => entry.isSymbolicLink() ||
        (entry.name === asset.executable ? !entry.isFile() : entry.name === ".service-lasso-tui" ? !entry.isDirectory() : true)) ||
        privateEntries.length !== 1 || privateEntries[0].name !== path.posix.basename(members[1].path) ||
        !privateEntries[0].isFile() || privateEntries[0].isSymbolicLink()) throw new Error("TUI pair extracted inventory differs");
    };
    await verifyInventory();
    // Repeat framing/digest checks for BOTH complete readbacks, after the closed
    // inventory check, retaining archive and member originals through caller use.
    for (let index = 0; index < members.length; index++) {
      if (!readbacks[index].equals(members[index].bytes)) throw new Error("TUI pair readback changed");
    }
    let closed = false, settlement;
    return {
      executable: path.join(root, asset.executable),
      async verifyReadbacks() {
        if (closed) throw new Error("TUI pair descriptors are settled");
        await verifyInventory();
        for (const { file, handle, member } of readers) {
          const named = await lstat(file), held = await handle.stat();
          if (!named.isFile() || named.isSymbolicLink() || !held.isFile() || named.dev !== held.dev || named.ino !== held.ino ||
              held.size !== member.bytes.length) throw new Error("TUI pair readback identity differs");
          const bytes = await boundedReadback(handle);
          if (!bytes.equals(member.bytes)) throw new Error("TUI pair readback bytes differ");
        }
        await verifyInventory();
      },
      close() {
        if (!settlement) {
          closed = true;
          settlement = (async () => {
            // Keep the byte originals reachable until every descriptor settles.
            const failures = await settleTuiPairResources(resources);
            void archive; void members; void readbacks;
            if (failures.length) throw new AggregateError(failures, "TUI pair descriptor settlement failed");
          })();
        }
        return settlement;
      },
    };
  } catch (original) {
    const later = await settleTuiPairResources(resources);
    if (later.length) throw new AggregateError([original, ...later], "TUI pair extraction and settlement failed");
    throw original;
  }
}
