import {
  ZipArchive,
  addLocalFolderToArchive,
} from "../../dist/runtime/files/safe-zip.js";

export { ZipArchive, addLocalFolderToArchive };

/**
 * Creates one in-memory ZIP archive for tests that previously used adm-zip.
 */
export function createTestZip() {
  return new ZipArchive();
}
