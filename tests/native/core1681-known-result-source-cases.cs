// Prospective original-effect cases: SOURCE_UNRUN. No supplied status, mocked
// API, fake handle, replacement provider, or fabricated OOM supplies authority.
// A separately admitted actor must establish the actual primitive and secondary
// failure independently while observing the SAME production invocation owner.
using System;
using System.IO;
using System.Linq;
using ServiceLasso.SourceAcquisition;

internal static class Core1681KnownResultSourceCases
{
    private static void Expect(bool condition, string name)
    { if (!condition) throw new InvalidDataException("SOURCE_CASE:" + name); }

    // Genuine live child handle opened with SYNCHRONIZE but without query access.
    // The fixture verifies the production helper's mapping; it never assigns 123.
    internal static void OriginalDirectoryExitQueryFailure(
        ServiceLassoManagedLauncherNative.ManagedInvocation sameOwner,
        IntPtr originalLiveSynchronizeHandle, int independentlyObservedError)
    {
        uint code;
        bool known = ServiceLassoManagedLauncherNative.ObserveDirectorySyncChildExit(
            sameOwner, originalLiveSynchronizeHandle, out code);
        Expect(!known && sameOwner.KnownPrimaryFailure &&
            sameOwner.PrimaryNativeStatus == independentlyObservedError &&
            sameOwner.PrimaryResult == 123, "actual_query_failure_settles_123");
        Expect(sameOwner.Outcomes.Count(o => o.Site == "directory-sync-child-exit-query") == 1,
            "actual_query_issued_and_observed_once");
    }

    // Observe after the actual FALSE CreateProcess and independently established
    // diagnostic failure. No secondary exception may restore unresolved issuance.
    internal static void ObserveKnownNoChildAfterSecondaryFailure(
        ServiceLassoManagedLauncherNative.ManagedInvocation sameOwner,
        int independentlyObservedError, int independentlyMappedResult,
        Exception independentlyObservedSecondary)
    {
        Expect(sameOwner.KnownPrimaryFailure && !sameOwner.ChildIssuanceUnresolved &&
            sameOwner.PrimaryNativeStatus == independentlyObservedError &&
            sameOwner.PrimaryResult == independentlyMappedResult &&
            ReferenceEquals(sameOwner.RecordingFailure, independentlyObservedSecondary),
            "known_false_primitive_survives_secondary_failure");
        Expect(sameOwner.Process == IntPtr.Zero && sameOwner.Thread == IntPtr.Zero,
            "false_never_invents_child");
        Expect(sameOwner.Outcomes.Where(o => o.Attempted).All(o => o.Closed && !o.Failed),
            "all_independently_safe_original_closes_continue");
    }

    // Negative private-owner observation while an actual interop throw or TRUE
    // invalid child evidence remains unresolved. The actor must not call cleanup.
    internal static void ObserveUnknownIssuanceRetained(
        ServiceLassoManagedLauncherNative.ManagedInvocation sameOwner,
        Exception independentlyObservedOriginal)
    {
        Expect(sameOwner.ChildIssuanceUnresolved && !sameOwner.KnownPrimaryFailure &&
            ReferenceEquals(sameOwner.Primary, independentlyObservedOriginal),
            "unknown_original_issuance_same_owner_primary");
        Expect(!sameOwner.Outcomes.Any(o => o.Site == "managed-job-release" && o.Attempted),
            "unresolved_child_denies_original_job_release");
    }

    // Actual MsiReadOnly.Read uses actual original-module exports and held input.
    // The admitted observer records original call counts separately. A recording
    // failure at either successful close must not skip view or database release.
    internal static void ObserveSuccessfulMsiClosesAfterSecondaryFailure(
        MsiReceipt originalReceipt, Exception independentlyObservedPrimary,
        Exception independentlyObservedSecondary, int independentlyObservedViewCloses,
        int independentlyObservedHandleCloses)
    {
        var resources = originalReceipt.Resources.Where(r => r.Handle != 0).ToArray();
        Expect(resources.Length > 1 && resources.Any(r => r.View) &&
            resources.Any(r => r.Kind == "database"), "genuine_original_view_database_roster");
        Expect(resources.All(r => r.CloseStatus.HasValue && r.CloseStatus.Value == 0) &&
            resources.Where(r => r.View).All(r => r.ViewCloseStatus.HasValue && r.ViewCloseStatus.Value == 0),
            "successful_original_closes_not_unknown_after_observation_failure");
        Expect(originalReceipt.CloseObservationFailed && originalReceipt.Eligibility == "UNQUALIFIED_INPUT" &&
            ReferenceEquals(originalReceipt.OriginalException, independentlyObservedPrimary) &&
            ReferenceEquals(originalReceipt.RecordingFailure, independentlyObservedSecondary),
            "secondary_failure_cannot_replace_primary_or_qualify");
        Expect(independentlyObservedViewCloses == resources.Count(r => r.View) &&
            independentlyObservedHandleCloses == resources.Length, "all_original_closes_once_without_retry");
    }

    // Negative prerequisite denial: independently observed original call count
    // remains zero. Observe while the genuine owner is retained, never retry it.
    internal static void ObserveMsiClosePrerequisiteDenial(
        NativeResource originalResource, int independentlyObservedCloseCalls)
    {
        Expect(originalResource.Handle != 0 && !originalResource.CloseStatus.HasValue &&
            independentlyObservedCloseCalls == 0, "before_failure_denies_original_close");
    }

    // Genuine nonzero original close result remains failed and retains ownership.
    internal static void ObserveGenuineMsiFailedClose(
        NativeResource originalResource, uint independentlyObservedStatus,
        int independentlyObservedCloseCalls)
    {
        Expect(independentlyObservedStatus != 0 && originalResource.CloseStatus.HasValue &&
            originalResource.CloseStatus.Value == independentlyObservedStatus &&
            originalResource.Handle != 0 && independentlyObservedCloseCalls == 1,
            "genuine_failed_close_not_retried_or_released");
    }
}
