using Microsoft.Win32.SafeHandles;
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
public static class HeldHandleContract {
  private const uint GenericRead = 0x80000000, OpenExisting = 3, FileFlagOpenReparsePoint = 0x00200000, FileAttributeReparsePoint = 0x400;
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFile(string name, uint access, FileShare share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out ByHandleFileInformation information);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, System.Text.StringBuilder path, uint length, uint flags);
  [DllImport("advapi32.dll", SetLastError = true)] private static extern uint GetSecurityInfo(SafeFileHandle handle, uint objectType, uint securityInfo, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
  [StructLayout(LayoutKind.Sequential)] private struct ByHandleFileInformation { public uint Attributes, CreationTimeLow, CreationTimeHigh, LastAccessLow, LastAccessHigh, LastWriteLow, LastWriteHigh, VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow; }
  public sealed class Receipt : IDisposable { public SafeFileHandle Handle { get; private set; } public string CanonicalPath { get; private set; } public byte[] Sha256 { get; private set; } internal Receipt(SafeFileHandle h, string p, byte[] d) { Handle=h; CanonicalPath=p; Sha256=d; } public void Dispose() { Handle.Dispose(); } }
  private static RawSecurityDescriptor HeldSecurity(SafeFileHandle handle) {
    IntPtr owner, group, dacl, sacl, descriptor; if (GetSecurityInfo(handle, 1, 0x00000001 | 0x00000004, out owner, out group, out dacl, out sacl, out descriptor) != 0 || descriptor == IntPtr.Zero) throw new UnauthorizedAccessException("held security descriptor unavailable");
    try { int length = checked((int)GetSecurityDescriptorLength(descriptor)); byte[] bytes = new byte[length]; Marshal.Copy(descriptor, bytes, 0, length); return new RawSecurityDescriptor(bytes, 0); } finally { LocalFree(descriptor); }
  }
  public static Receipt OpenRootOwnedReadOnly(string reviewedPath, string expectedSha256Hex, string expectedOwnerSid) {
    if (string.IsNullOrWhiteSpace(reviewedPath) || string.IsNullOrWhiteSpace(expectedOwnerSid) || expectedSha256Hex == null || expectedSha256Hex.Length != 64) throw new UnauthorizedAccessException("invalid native contract input");
    var handle = CreateFile(reviewedPath, GenericRead, FileShare.Read, IntPtr.Zero, OpenExisting, FileFlagOpenReparsePoint, IntPtr.Zero);
    if (handle.IsInvalid) { handle.Dispose(); throw new UnauthorizedAccessException("held handle unavailable or a writer is present"); }
    try {
      ByHandleFileInformation before; if (!GetFileInformationByHandle(handle, out before) || (before.Attributes & FileAttributeReparsePoint) != 0 || before.NumberOfLinks != 1) throw new UnauthorizedAccessException("unsafe held object");
      RawSecurityDescriptor security = HeldSecurity(handle); var owner = security.Owner;
      if (owner == null || !StringComparer.OrdinalIgnoreCase.Equals(owner.Value, expectedOwnerSid)) throw new UnauthorizedAccessException("unexpected owner");
      if (security.DiscretionaryAcl != null) foreach (GenericAce ace in security.DiscretionaryAcl) {
        QualifiedAce rule = ace as QualifiedAce; if (rule == null) continue;
        var sid = rule.SecurityIdentifier;
        FileSystemRights mutable = FileSystemRights.WriteData | FileSystemRights.AppendData | FileSystemRights.Delete | FileSystemRights.Modify | FileSystemRights.FullControl;
        if (rule.AceQualifier == AceQualifier.AccessAllowed && sid != null && (sid.IsWellKnown(WellKnownSidType.WorldSid) || sid.IsWellKnown(WellKnownSidType.BuiltinUsersSid)) && (((FileSystemRights)rule.AccessMask & mutable) != 0)) throw new UnauthorizedAccessException("mutable broad DACL denied");
      }
      var builder = new System.Text.StringBuilder(32768); if (GetFinalPathNameByHandle(handle, builder, (uint)builder.Capacity, 0) == 0) throw new UnauthorizedAccessException("canonical handle path unavailable");
      byte[] digest; using (var readingHandle = new SafeFileHandle(handle.DangerousGetHandle(), false)) using (var stream = new FileStream(readingHandle, FileAccess.Read, 8192, false)) using (var sha = SHA256.Create()) { digest = sha.ComputeHash(stream); }
      ByHandleFileInformation after; string hex = BitConverter.ToString(digest).Replace("-", ""); if (!hex.Equals(expectedSha256Hex, StringComparison.OrdinalIgnoreCase) || !GetFileInformationByHandle(handle, out after) || before.VolumeSerialNumber != after.VolumeSerialNumber || before.FileIndexHigh != after.FileIndexHigh || before.FileIndexLow != after.FileIndexLow || before.FileSizeHigh != after.FileSizeHigh || before.FileSizeLow != after.FileSizeLow) throw new UnauthorizedAccessException("substitution or digest mismatch");
      return new Receipt(handle, builder.ToString(), digest);
    } catch { handle.Dispose(); throw; }
  }
  public static bool RejectPreOpenWriter(FileShare observedShare) { return (observedShare & (FileShare.Write | FileShare.Delete)) == 0; }
}
