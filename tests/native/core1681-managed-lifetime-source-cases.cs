// Prospective ORIGINAL managed production lifetime seams. SOURCE_UNRUN.
// Compile only with the separately reviewed original managed source and exact
// runtime/reference/module/input closure after NEW complete ROOT admission.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

internal static class Core1681ManagedLifetimeSourceCases
{
    // Actual original Main launch body. Requires native-sanitized, exact reviewed
    // payload/managed module/runtime/reference files and real failure conditions.
    // Separate observer retains this SAME owner; no return/deadline qualifies it.
    internal static int RunOriginalManagedEntrypoint(ServiceLassoManagedLauncherNative.ManagedInvocation sameOwner)
    {
        return ServiceLassoManagedLauncherNative.RunManagedInvocation(sameOwner);
    }
    // The admitted fixture must supply valid original payload/gates and a real
    // existing non-executable target, or independently observed ACL denial, so
    // original CreateProcessW actually returns FALSE (not a pre-create check).
    // No shim, closed slot, supplied status or fixture exception creates it.
    internal static void OriginalManagedKnownFalseSettles(
        ServiceLassoManagedLauncherNative.ManagedInvocation sameOwner,
        int independentlyExpectedWin32Error, int independentlyExpectedMappedFailure)
    {
        int result = ServiceLassoManagedLauncherNative.RunManagedInvocation(sameOwner);
        var create = sameOwner.Outcomes.Single(o => o.Site == "target-original-create" && o.Failed);
        Expect(create.Exception is Win32Exception && create.NativeStatus == independentlyExpectedWin32Error &&
            ((Win32Exception)create.Exception).NativeErrorCode == independentlyExpectedWin32Error &&
            ReferenceEquals(sameOwner.Primary, create.Exception), "known_false_original_error_identity");
        Expect(result == independentlyExpectedMappedFailure && result >= 102 && result <= 112 && result != 103 &&
            result != 104 && result != 105 && result != 106 && sameOwner.PrimaryResult == result,
            "known_false_returns_same_failure_mapping");
        Expect(!sameOwner.ChildIssuanceUnresolved && !sameOwner.Failed && sameOwner.Process == IntPtr.Zero &&
            sameOwner.Thread == IntPtr.Zero && sameOwner.Outcomes.Where(o => o.Attempted).All(o => o.Closed && !o.Failed),
            "known_false_no_child_all_original_retirements_closed");
        Expect(sameOwner.Outcomes.Any(o => o.Site == "managed-job-release" && o.Closed),
            "known_false_original_job_released_after_containment");
    }
    // Genuine acquired HMAC retirement through the actual production helper.
    // A failure case needs separately observed original Dispose failure; no
    // failing subclass, fabricated exception or native acceptance claim.
    internal static void OriginalProgressRetirementPositive(HMACSHA256 acquiredHmac)
    {
        var owner = new ServiceLassoManagedLauncherNative.ManagedInvocation(new List<FileStream>());
        HMACSHA256 original = acquiredHmac;
        ServiceLassoManagedLauncherNative.RetireProgressOwned(owner, ref acquiredHmac);
        var outcome = owner.Outcomes.Single(o => o.Site == "progress-retirement");
        Expect(ReferenceEquals(outcome.Resource, original) && outcome.Closed && !owner.Failed && acquiredHmac == null,
            "actual_original_progress_retirement_positive");
        ServiceLassoManagedLauncherNative.RetireProgressOwned(owner, ref acquiredHmac);
        Expect(owner.Outcomes.Count == 1, "original_progress_retirement_once");
    }
    internal static void ObserveOriginalProgressRetirementFailure(ServiceLassoManagedLauncherNative.ManagedInvocation owner,
        HMACSHA256 independentlyObservedOriginal, Exception independentlyObservedException)
    {
        var outcome = owner.Outcomes.Single(o => o.Site == "progress-retirement" && o.Attempted);
        Expect(owner.Failed && !outcome.Closed && outcome.Failed &&
            ReferenceEquals(owner.Progress, independentlyObservedOriginal) &&
            ReferenceEquals(outcome.Resource, independentlyObservedOriginal) &&
            ReferenceEquals(outcome.Exception, independentlyObservedException), "same_original_progress_failure_retained");
    }
    internal static void OriginalEnvironmentApplicationRollbackSourceCase()
    {
        var owner = new ServiceLassoManagedLauncherNative.ManagedInvocation(new List<FileStream>());
        var rows = new[] {
            new ServiceLassoManagedLauncherNative.EnvironmentOverride { name = "SERVICE_LASSO_C123_PRIVATE_FIXTURE", value = "owned" },
            new ServiceLassoManagedLauncherNative.EnvironmentOverride { name = "invalid=name", value = "rejected" }
        };
        Exception original = null;
        try { ServiceLassoManagedLauncherNative.ApplyTargetEnvironmentOverrides(rows, owner); }
        catch (Exception failure) { original = failure; }
        Expect(original != null && ReferenceEquals(owner.Primary, original), "application_original_primary_preserved");
        Expect(owner.Outcomes.Count(o => o.Site == "target-environment-clear" && o.Attempted) == 2,
            "every_original_rollback_attempt_observed");
        Expect(owner.Outcomes.Any(o => o.Site == "target-environment-clear" && o.Failed && o.Exception != null),
            "independent_real_invalid_name_rollback_exception_preserved");
        int count = owner.Outcomes.Count;
        ServiceLassoManagedLauncherNative.ClearTargetEnvironmentOverrides(rows, owner, rows.Length);
        Expect(owner.Outcomes.Count == count && ReferenceEquals(owner.Primary, original), "rollback_no_retry_no_primary_replacement");
        // Invalid-name CLR helper proof only. Main's validated payload denies
        // this input before application; this is not a native Main failure.
    }
    internal static void OriginalEnvironmentApplicationAndClearPositive()
    {
        // This name must belong to the separately admitted isolated fixture.
        var owner = new ServiceLassoManagedLauncherNative.ManagedInvocation(new List<FileStream>());
        var rows = new[] {
            new ServiceLassoManagedLauncherNative.EnvironmentOverride { name = "SERVICE_LASSO_C123_PRIVATE_FIXTURE", value = "owned" }
        };
        ServiceLassoManagedLauncherNative.ApplyTargetEnvironmentOverrides(rows, owner);
        ServiceLassoManagedLauncherNative.ClearTargetEnvironmentOverrides(rows, owner, rows.Length);
        Expect(!owner.Failed && owner.Outcomes.Count == 2 &&
            owner.Outcomes.All(o => o.Attempted && o.Closed && ReferenceEquals(o.Resource, rows[0])),
            "actual_original_environment_application_clear_positive");
        ServiceLassoManagedLauncherNative.ClearTargetEnvironmentOverrides(rows, owner, rows.Length);
        Expect(owner.Outcomes.Count == 2, "original_environment_clear_once");
    }
    internal static void ObserveActualMainCreatePrimaryAndLaterEnvironmentFailure(
        ServiceLassoManagedLauncherNative.ManagedInvocation sameOwner, Exception originalCreate,
        object originalEnvironmentRow, Exception originalRetirement)
    {
        Expect(ReferenceEquals(sameOwner.Primary, originalCreate), "actual_create_primary_not_replaced");
        Expect(sameOwner.Outcomes.Any(o => (o.Site == "target-original-create" || o.Site == "target-original-create-throw") &&
            o.Failed && ReferenceEquals(o.Exception, originalCreate)), "original_create_observation_preserved");
        Expect(sameOwner.Outcomes.Any(o => o.Site == "target-environment-clear" && o.Failed &&
            ReferenceEquals(o.Resource, originalEnvironmentRow) && ReferenceEquals(o.Exception, originalRetirement)),
            "later_original_environment_failure_retained");
        Expect(sameOwner.Failed, "actual_main_retirement_denies_success");
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr original);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetProcessId(IntPtr original);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint originalPid);
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
    // Keep the independently acquired exited process object held throughout.
    // A real SYNCHRONIZE-only handle can wait for closure but lacks process query
    // rights. This authors an actual FALSE query after actual WAIT_OBJECT0; it
    // fabricates neither outcome and does not preclose/reuse a numeric slot.
    internal static void OriginalDirectorySyncKnownClosedQueryFailure(IntPtr heldExitedProcess,
        IntPtr thread, IntPtr directory, FileStream helper)
    {
        uint originalPid = GetProcessId(heldExitedProcess);
        Expect(originalPid != 0, "original_held_process_pid");
        IntPtr synchronizeOnly = OpenProcess(0x00100000, false, originalPid);
        Expect(synchronizeOnly != IntPtr.Zero, "actual_original_synchronize_only_process");
        var owner = new ServiceLassoManagedLauncherNative.ManagedInvocation(new List<FileStream> { helper });
        owner.Process = synchronizeOnly; owner.Thread = thread; owner.Directory = directory;
        bool closed = ServiceLassoManagedLauncherNative.ObserveDirectorySyncChildWait(owner, synchronizeOnly);
        Expect(closed, "actual_original_wait_object_zero");
        uint exitCode;
        bool known = ServiceLassoManagedLauncherNative.ObserveDirectorySyncChildExit(owner, synchronizeOnly, out exitCode);
        var query = owner.Outcomes.Single(o => o.Site == "directory-sync-child-exit-query");
        Expect(!known && query.Failed && query.NativeStatus == 5 && query.Exception is Win32Exception &&
            ReferenceEquals(owner.Primary, query.Exception) && !owner.Failed, "actual_access_denied_query_primary_not_release_failure");
        owner.PrimaryResult = 123; // original production directory mapping
        ServiceLassoManagedLauncherNative.FinishDirectorySyncInvocation(owner, closed, ref thread, ref synchronizeOnly, ref directory);
        Expect(owner.PrimaryResult == 123 && ReferenceEquals(owner.Primary, query.Exception) && query.Failed &&
            !owner.Failed && synchronizeOnly == IntPtr.Zero && thread == IntPtr.Zero && directory == IntPtr.Zero &&
            owner.Outcomes.Where(o => o.Attempted).All(o => o.Closed && !o.Failed), "known_closed_query_failure_settles_only_after_all_safe_releases");
        GC.KeepAlive(heldExitedProcess); // external owner still owns this handle
    }
    // External admitted observer reads SAME live invocation after a genuine
    // original interop throw/invalid issuance. It never writes the disposition.
    internal static void ObserveOriginalUnresolvedIssuance(ServiceLassoManagedLauncherNative.ManagedInvocation owner)
    {
        Expect(owner.ChildIssuanceUnresolved && owner.Primary != null,
            "unknown_original_issuance_same_primary_and_owner");
        Expect(!owner.Outcomes.Any(o => o.Site == "target-process-release" || o.Site == "directory-sync-process-release" ||
            o.Site == "bound-file-release"), "unknown_issuance_never_releases_child_inputs");
    }
    // F21 external SAME-live-owner observation only. A separately admitted
    // native fixture must independently establish the original initiating
    // interop call threw before its return, original handle/file identity and
    // ongoing retention. No callback/shim/preclosed numeric slot/supplied status
    // or this observer can manufacture that failure mechanism. It remains absent.
    internal static void ObserveOriginalPrimaryWaitUnavailable(
        ServiceLassoManagedLauncherNative.ManagedInvocation owner,
        Exception independentlyObservedOriginalException, IntPtr originalProcess, IntPtr originalJob,
        FileStream[] originalFiles, int independentlyExpectedMappedFailure)
    {
        Expect(owner.PrimaryWaitPending && ReferenceEquals(owner.Primary, independentlyObservedOriginalException) &&
            owner.PrimaryResult == independentlyExpectedMappedFailure, "same_pending_primary_wait_exception_result");
        var unavailable = owner.Outcomes.Single(o => o.Site == "target-primary-wait-unavailable");
        Expect(unavailable.Failed && ReferenceEquals(unavailable.Exception, independentlyObservedOriginalException) &&
            !owner.Outcomes.Any(o => o.Site == "target-primary-wait"), "unavailable_not_actual_wait_observation");
        Expect(owner.Process == originalProcess && owner.Job == originalJob && originalProcess != IntPtr.Zero &&
            originalJob != IntPtr.Zero && owner.Files.SequenceEqual(originalFiles), "same_original_live_wait_dependencies");
        Expect(!owner.Outcomes.Any(o => o.Site == "unassigned-process-terminate" || o.Site == "unassigned-process-wait" ||
            o.Site == "managed-job-terminate" || o.Site == "managed-job-accounting" || o.Site == "managed-process-wait" ||
            o.Site == "managed-job-release" || o.Site == "target-process-release" || o.Site == "bound-file-release"),
            "pending_original_wait_no_retry_termination_or_dependent_release");
        // Independently safe environment/progress retirement is still allowed;
        // no process-exit/deadline receipt proves nonreturn or this owner custody.
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
