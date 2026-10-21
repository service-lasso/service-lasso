import { constants } from 'node:fs';
import { lstat, realpath, open, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const parent = fileURLToPath(new URL('../../.tmp', import.meta.url));
const retainedFailures = new WeakMap();
const identity = info => `${info.dev}:${info.ino}`;
const samePath = (left, right) => process.platform === 'win32'
  ? left.toLowerCase() === right.toLowerCase() : left === right;

// The fixed parent is an explicit external admission input. These observations
// do not issue ROOT or infer source ownership from a uid/path/EEXIST flag.
// Missing parent fails closed; this helper never adopts/creates a scratch parent.
export async function createF25PrivateTemp() {
  const state = { parent, root: undefined, nativeOwner: undefined, parentHandle: undefined,
    rootHandle: undefined, originals: [], borrowers: 0, settled: false };
  const failure = original => {
    state.originals.push(original);
    const error = new Error('F25 private temp custody is unavailable.');
    retainedFailures.set(error, state); return error;
  };
  let parentInfo, rootInfo;
  const verifyParent = async (checkHeld = true) => {
    const named = await lstat(parent, { bigint: true });
    if (!named.isDirectory() || named.isSymbolicLink() || identity(named) !== identity(parentInfo) ||
        !samePath(await realpath(parent), parent)) throw new Error('F25 fixed parent correspondence failed.');
    if (checkHeld && state.parentHandle && identity(await state.parentHandle.stat({ bigint: true })) !== identity(parentInfo))
      throw new Error('F25 held parent correspondence failed.');
    if (process.platform === 'linux' && (named.uid !== BigInt(process.getuid()) || (named.mode & 0o022n) !== 0n))
      throw new Error('F25 fixed parent uid/mode prerequisite failed.');
  };
  const verifyRoot = async (checkHeld = true) => {
    await verifyParent(checkHeld);
    const named = await lstat(state.root, { bigint: true });
    if (!named.isDirectory() || named.isSymbolicLink() || identity(named) !== identity(rootInfo) ||
        !samePath(await realpath(state.root), state.root)) throw new Error('F25 fresh temp correspondence failed.');
    if (checkHeld && state.rootHandle && identity(await state.rootHandle.stat({ bigint: true })) !== identity(rootInfo))
      throw new Error('F25 held fresh temp correspondence failed.');
    if (process.platform === 'linux' && (named.uid !== BigInt(process.getuid()) || (named.mode & 0o077n) !== 0n))
      throw new Error('F25 fresh temp is not private.');
  };
  const settle = async remove => {
    if (state.settled || state.borrowers) throw failure(new Error('F25 temp settlement state failed.'));
    const failures = [];
    try { if (rootInfo) await verifyRoot(); } catch (original) { failures.push(original); }
    if (state.nativeOwner) {
      try { await state.nativeOwner.verify(); await state.nativeOwner.handoff(); } catch (original) { failures.push(original); }
      try { await state.nativeOwner.release(); } catch (original) { failures.push(original); }
    }
    for (const handle of [state.rootHandle, state.parentHandle])
      if (handle) { try { await handle.close(); } catch (original) { failures.push(original); } }
    state.settled = true;
    // Only the genuine fresh creation above supplies this removal operand.
    // Failed/pending owners retain their original directory and private state.
    if (remove && !failures.length && state.root && rootInfo) {
      try { await verifyRoot(false); await rm(state.root, { recursive: true }); }
      catch (original) { failures.push(original); }
    }
    if (failures.length) {
      state.originals.push(...failures);
      const error = new Error('F25 temp settlement failed; originals retained.');
      retainedFailures.set(error, state); throw error;
    }
  };
  try {
    parentInfo = await lstat(parent, { bigint: true });
    await verifyParent();
    if (process.platform === 'linux') {
      state.parentHandle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await verifyParent();
      state.root = await mkdtemp(path.join(parent, 'f25-ast-'));
      rootInfo = await lstat(state.root, { bigint: true });
      state.rootHandle = await open(state.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    } else if (process.platform === 'win32') {
      // Fixed genuine native birth/held-parent/principal/SD implementation,
      // not a copied receipt or inherited-ACL mkdir authority.
      const { createPrivateDiagnosticDirectory } = await import('../fixture-diagnostic-creator.js');
      state.nativeOwner = await createPrivateDiagnosticDirectory(parent, 'f25-ast-', owner => {
        state.nativeOwner = owner; state.root = owner.root;
      });
      rootInfo = await lstat(state.root, { bigint: true });
    } else throw new Error('F25 private temp platform is unsupported.');
    await verifyRoot();
    return { root: state.root,
      async borrow(action) {
        if (state.settled || state.borrowers) throw failure(new Error('F25 temp borrower state failed.'));
        await verifyRoot(); state.borrowers++;
        try { return state.nativeOwner ? await state.nativeOwner.borrow(action) : await action(); }
        finally { state.borrowers--; }
      }, settle };
  } catch (original) {
    state.originals.push(original);
    try { await settle(false); } catch (later) { state.originals.push(later); }
    const error = new Error('F25 private temp acquisition failed; originals retained.');
    retainedFailures.set(error, state); throw error;
  }
}
