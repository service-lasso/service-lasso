import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import * as tar from "tar";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function assertMissing(targetPath) {
  await assert.rejects(access(targetPath), (error) => error?.code === "ENOENT");
}

function createZipWithTraversalEntry() {
  const zip = new AdmZip();
  zip.addFile("runtime/service.mjs", Buffer.from('console.log("safe");\n', "utf8"));
  zip.addFile("aa/escaped.txt", Buffer.from("unsafe", "utf8"));

  const archive = zip.toBuffer();
  const safeName = Buffer.from("aa/escaped.txt", "utf8");
  const traversalName = Buffer.from("../escaped.txt", "utf8");
  assert.equal(safeName.length, traversalName.length);

  let replacements = 0;
  let offset = 0;
  while ((offset = archive.indexOf(safeName, offset)) !== -1) {
    traversalName.copy(archive, offset);
    offset += traversalName.length;
    replacements += 1;
  }
  assert.equal(replacements, 2, "ZIP entry name should occur in local and central headers");
  return archive;
}

function writeTarOctal(header, offset, length, value) {
  header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

function createTarGzWithEntries(entries) {
  const chunks = [];
  for (const [entryName, entryContent] of entries) {
    const content = Buffer.from(entryContent, "utf8");
    const header = Buffer.alloc(512);
    header.write(entryName, 0, 100, "ascii");
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, content.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");

    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    chunks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }

  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

test("production archive dependencies are pinned to fixed releases", async () => {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const lockfile = JSON.parse(await readFile(path.join(repoRoot, "package-lock.json"), "utf8"));

  assert.equal(manifest.dependencies["adm-zip"], "0.6.0");
  assert.equal(manifest.dependencies.tar, "7.5.22");
  assert.equal(lockfile.packages["node_modules/adm-zip"].version, "0.6.0");
  assert.equal(lockfile.packages["node_modules/tar"].version, "7.5.22");
});

test("adm-zip extraction preserves valid content without allowing traversal outside the destination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-zip-security-"));
  const archivePath = path.join(root, "crafted.zip");
  const destinationPath = path.join(root, "extracted");
  await mkdir(destinationPath);
  await writeFile(archivePath, createZipWithTraversalEntry());

  try {
    const archive = new AdmZip(archivePath);
    assert.equal(archive.getEntries().some((entry) => entry.entryName === "../escaped.txt"), true);
    archive.extractAllTo(destinationPath, true);

    assert.equal(await readFile(path.join(destinationPath, "runtime", "service.mjs"), "utf8"), 'console.log("safe");\n');
    await assertMissing(path.join(root, "escaped.txt"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tar extraction preserves valid content and rejects traversal outside the destination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-tar-security-"));
  const archivePath = path.join(root, "crafted.tgz");
  const destinationPath = path.join(root, "extracted");
  const warnings = [];
  await mkdir(destinationPath);
  await writeFile(archivePath, createTarGzWithEntries([
    ["runtime/service.mjs", 'console.log("safe");\n'],
    ["../escaped.txt", "unsafe"],
  ]));

  try {
    await tar.extract({
      file: archivePath,
      cwd: destinationPath,
      preservePaths: false,
      onwarn: (code, message) => warnings.push({ code, message }),
    });

    assert.equal(await readFile(path.join(destinationPath, "runtime", "service.mjs"), "utf8"), 'console.log("safe");\n');
    await assertMissing(path.join(root, "escaped.txt"));
    assert.equal(warnings.some(({ message }) => message.includes("path contains '..'")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
