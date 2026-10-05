// Prospective ORIGINAL managed production lifetime seams. SOURCE_UNRUN.
// Compile only with the separately reviewed original managed source and exact
// runtime/reference/module/input closure after NEW complete ROOT admission.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

internal static class Core1681ManagedLifetimeSourceCases
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr original);
    private static void Expect(bool condition, string claim)
    {
        if (!condition) throw new InvalidOperationException(claim);
    }
    // Inputs must be actual separately acquired original process/thread/file
    // handles, with genuine process closure proved by the admitted fixture.
    // Neither handle numbers nor a test declaration establish that provenance.
    internal static void OriginalManagedReleasePositive(IntPtr exitedProcess, IntPtr thread, FileStream[] files)
    {
        var owner = new ServiceLassoManagedLauncherNative.ManagedInvocation(new List<FileStream>(files));
        owner.Process = exitedProcess; owner.Thread = thread;
        ServiceLassoManagedLauncherNative.FinishManagedReleases(owner, ref thread, ref exitedProcess);
        Expect(thread == IntPtr.Zero && exitedProcess == IntPtr.Zero && !owner.Failed,
            "managed_original_native_release_positive");
        Expect(owner.Outcomes.Count == 2 + files.Length && owner.Outcomes.All(o => o.Attempted && o.Closed && !o.Failed),
            "managed_complete_original_release_roster");
        int count = owner.Outcomes.Count;
        ServiceLassoManagedLauncherNative.FinishManagedReleases(owner, ref thread, ref exitedProcess);
        Expect(owner.Outcomes.Count == count, "managed_successful_releases_not_repeated");
    }
    // Artificial acquired-then-closed numeric slots, not proof that ordinary
    // safe CloseHandle naturally fails. No new handle acquisition may occur
    // between this close and actual production release. External observer must
    // inspect SAME invocation/owner; timeout or process exit is never PASS.
    internal static void OriginalManagedReleaseRetention(IntPtr exitedProcess, IntPtr thread,
        FileStream[] files, bool closeThread)
    {
        var owner = new ServiceLassoManagedLauncherNative.ManagedInvocation(new List<FileStream>(files));
        owner.Process = exitedProcess; owner.Thread = thread;
        owner.Primary = new InvalidOperationException("original fixture primary failure");
        IntPtr original = closeThread ? thread : exitedProcess;
        Expect(CloseHandle(original), "fixture_original_preclose_observed");
        ServiceLassoManagedLauncherNative.FinishManagedReleases(owner, ref thread, ref exitedProcess);
        throw new InvalidOperationException("retention_must_not_return");
    }
    internal static void OriginalDirectorySyncPositive(IntPtr exitedProcess, IntPtr thread, IntPtr directory, FileStream helper)
    {
        var owner = new ServiceLassoManagedLauncherNative.ManagedInvocation(new List<FileStream> { helper });
        owner.Process = exitedProcess; owner.Thread = thread; owner.Directory = directory;
        bool closed = ServiceLassoManagedLauncherNative.ObserveDirectorySyncChildWait(owner, exitedProcess);
        Expect(closed, "directory_sync_original_process_wait_positive");
        ServiceLassoManagedLauncherNative.FinishDirectorySyncInvocation(owner, closed, ref thread, ref exitedProcess, ref directory);
        Expect(!owner.Failed && thread == IntPtr.Zero && exitedProcess == IntPtr.Zero && directory == IntPtr.Zero,
            "directory_sync_original_safe_closure_positive");
        Expect(owner.Outcomes.Count(o => o.Attempted && o.Closed) == 4,
            "directory_sync_all_original_releases_observed");
    }
    // Actual wait failure with separately retained live child custody. The
    // admitted fixture must retain its independent original child handle while
    // this deliberately closed numeric wait slot is observed. That duplicate
    // does not supply closure of this route or authority to release its inputs.
    internal static void OriginalDirectorySyncWaitRetention(IntPtr liveChildWaitSlot, IntPtr thread,
        IntPtr directory, FileStream helper)
    {
        var owner = new ServiceLassoManagedLauncherNative.ManagedInvocation(new List<FileStream> { helper });
        owner.Process = liveChildWaitSlot; owner.Thread = thread; owner.Directory = directory;
        Expect(CloseHandle(liveChildWaitSlot), "fixture_original_wait_slot_preclose");
        bool closed = ServiceLassoManagedLauncherNative.ObserveDirectorySyncChildWait(owner, liveChildWaitSlot);
        ServiceLassoManagedLauncherNative.FinishDirectorySyncInvocation(owner, closed, ref thread, ref liveChildWaitSlot, ref directory);
        throw new InvalidOperationException("original_failed_wait_must_retain_inputs");
    }
    internal static void OriginalDirectorySyncReleaseRetention(IntPtr exitedProcess, IntPtr thread,
        IntPtr directory, FileStream helper, int slot)
    {
        var owner = new ServiceLassoManagedLauncherNative.ManagedInvocation(new List<FileStream> { helper });
        owner.Process = exitedProcess; owner.Thread = thread; owner.Directory = directory;
        bool closed = ServiceLassoManagedLauncherNative.ObserveDirectorySyncChildWait(owner, exitedProcess);
        Expect(closed && slot >= 0 && slot <= 2, "fixture_actual_original_child_closed");
        IntPtr original = slot == 0 ? thread : slot == 1 ? exitedProcess : directory;
        Expect(CloseHandle(original), "fixture_original_release_slot_preclose");
        ServiceLassoManagedLauncherNative.FinishDirectorySyncInvocation(owner, closed, ref thread, ref exitedProcess, ref directory);
        throw new InvalidOperationException("directory_sync_failed_release_must_retain");
    }
    // Separately admitted external SAME-owner observation for genuine original
    // FileStream Dispose failure: no subclass, API shim or fake native result.
    internal static void ObserveOriginalRetainedRelease(ServiceLassoManagedLauncherNative.ManagedInvocation owner,
        string failedSite, int ordinal, int expectedAttempted)
    {
        var original = owner.Outcomes.Single(o => o.Site == failedSite && o.Ordinal == ordinal && o.Attempted);
        Expect(owner.Failed && original.Failed && !original.Closed, "original_failed_release_retained");
        Expect(original.Handle != IntPtr.Zero || original.File != null, "original_object_not_cleared");
        Expect(owner.Outcomes.Count(o => o.Attempted) == expectedAttempted,
            "all_independently_safe_original_releases_once");
        Expect(owner.Outcomes.Any(o => o.Attempted && o.Closed), "later_independent_safe_closures_retained");
        Expect(owner.Primary != null || owner.PrimaryResult == 0, "primary_outcome_retained_alongside_release_failure");
    }
    internal static void ObserveOriginalWaitRetention(ServiceLassoManagedLauncherNative.ManagedInvocation owner)
    {
        Expect(owner.Outcomes.Single(o => o.Site == "directory-sync-child-wait").Failed,
            "original_failed_wait_status_preserved");
        Expect(owner.Process != IntPtr.Zero && owner.Directory != IntPtr.Zero && owner.Files.Count == 1 &&
            owner.Outcomes.All(o => !o.Attempted), "failed_wait_releases_no_live_child_or_input");
    }
}
