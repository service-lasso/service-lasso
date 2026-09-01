import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import * as tar from "tar";

import {
  extractPublishedPackageArchive,
  extractionCommand,
} from "../scripts/published-package-archive.mjs";

test("published qualification selects an explicit platform archive extractor", () => {
  const windows = extractionCommand("win32", "core.zip", "destination");
  assert.equal(windows.command, "powershell.exe");
  assert.match(windows.args.join(" "), /Expand-Archive/u);
  assert.doesNotMatch(windows.args.join(" "), /tar/u);

  for (const platform of ["linux", "darwin"]) {
    const posix = extractionCommand(platform, "core.tar.gz", "destination");
    assert.deepEqual(posix, {
      command: "tar",
      args: ["-xf", "core.tar.gz", "-C", "destination"],
    });
  }
  assert.throws(
    () => extractionCommand("aix", "core.tar.gz", "destination"),
    /Unsupported qualification platform/u,
  );
});

test("published qualification extracts a verified archive with the current platform path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "published-archive-"));
  try {
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    await mkdir(path.join(source, "release"), { recursive: true });
    await writeFile(path.join(source, "release", "identity.txt"), "verified\n");
    let archive;
    if (process.platform === "win32") {
      archive = path.join(root, "core.zip");
      const zip = new AdmZip();
      zip.addLocalFolder(source);
      zip.writeZip(archive);
    } else {
      archive = path.join(root, "core.tar.gz");
      await tar.create({ cwd: source, file: archive, gzip: true }, ["release"]);
    }
    await extractPublishedPackageArchive(
      archive,
      destination,
      process.platform,
    );
    assert.equal(
      await readFile(path.join(destination, "release", "identity.txt"), "utf8"),
      "verified\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
