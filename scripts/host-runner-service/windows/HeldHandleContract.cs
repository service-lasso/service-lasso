// Windows source contract: open the reviewed file once with no write/delete
// sharing, hash that SafeFileHandle, and pass only the held handle to launch.
using Microsoft.Win32.SafeHandles;
using System.IO;
internal static class HeldHandleContract {
  internal static FileStream OpenRootOwnedReadOnly(string reviewedPath) =>
    new FileStream(reviewedPath, FileMode.Open, FileAccess.Read, FileShare.Read, 8192, FileOptions.SequentialScan);
  internal static bool RejectPreOpenWriter(FileShare observedShare) =>
    (observedShare & (FileShare.Write | FileShare.Delete)) == 0;
}
