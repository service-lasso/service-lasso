// Prospective externally observed F25 obligations. ALL_UNRUN; no fixture exists.
// This observer cannot manufacture original failures or establish native admission.
using System;
using System.IO;
using System.Linq;
using System.Threading;
using ServiceLasso.SourceAcquisition;
internal static class Core1681RecordingLifetimeSourceCases
{
    private static void Expect(bool value, string name)
    { if (!value) throw new InvalidDataException("SOURCE_CASE:" + name); }
    internal static void ObserveOriginalMsiPublicationFailure(Thread originalThread, MsiReadOnly owner,
        uint independentlyObservedOriginalHandle, long independentlyObservedOriginalResult,
        Exception independentlyObservedRecordingFailure, Func<bool> originalReadReturned,
        Func<int> actualOriginalReleaseCalls, Func<int> actualHeldClosureCalls)
    {
        NativeResource slot = owner.CurrentPendingResource;
        Expect(originalThread != null && originalThread != Thread.CurrentThread && originalThread.IsAlive,
            "original_live_read_thread");
        Expect(slot != null && slot.Handle != 0 && slot.Handle == independentlyObservedOriginalHandle &&
            slot.AcquisitionReturned && slot.AcquisitionResult == independentlyObservedOriginalResult,
            "same_genuine_original_output_before_record_publication");
        Expect(ReferenceEquals(owner.CurrentReceipt.RecordingFailure, independentlyObservedRecordingFailure) &&
            owner.CurrentRetention != null && ReferenceEquals(owner.CurrentRetention.Owner, owner),
            "same_original_owner_and_recording_failure");
        Expect(!originalReadReturned() && actualOriginalReleaseCalls() == 0 && actualHeldClosureCalls() == 0,
            "same_invocation_no_release_retry_or_held_cleanup");
        // A snapshot has no authority to terminate/retry/release the original thread.
    }
    internal static void ObserveOriginalInterruptionRecordingFailure(Thread originalThread, RetentionState retained,
        object originalOwner, Exception independentlyObservedOriginalInterruption,
        Exception independentlyObservedRecordingFailure, Action assertOriginalDependenciesHeld)
    {
        Expect(originalThread != null && originalThread != Thread.CurrentThread && originalThread.IsAlive &&
            ReferenceEquals(retained.Owner, originalOwner) && retained.CallbackCompleted,
            "same_live_original_owner_after_completed_once_callback");
        Expect(ReferenceEquals(retained.LastInterruptionException, independentlyObservedOriginalInterruption) &&
            ReferenceEquals(retained.RecordingFailure, independentlyObservedRecordingFailure),
            "original_interruption_preserved_when_ledger_allocation_failed");
        assertOriginalDependenciesHeld();
    }
    internal static void ObserveOriginalManagedRecordingFailure(
        ServiceLassoManagedLauncherNative.ManagedInvocation owner, Exception originalPrimary,
        int originalMappedResult, Exception originalObservation, Exception recordingFailure,
        IntPtr originalProcess, IntPtr originalJob, FileStream[] originalFiles,
        Func<bool> originalInvocationReturned, Func<int> actualDependentReleaseOrRetryCalls)
    {
        Expect(owner.PrimaryWaitPending && ReferenceEquals(owner.Primary, originalPrimary) &&
            owner.PrimaryResult == originalMappedResult && ReferenceEquals(owner.UnrecordedException, originalObservation) &&
            ReferenceEquals(owner.RecordingFailure, recordingFailure), "same_pending_primary_and_secondary_recording_failure");
        Expect(owner.Process == originalProcess && owner.Job == originalJob && originalProcess != IntPtr.Zero &&
            originalJob != IntPtr.Zero && owner.Files.SequenceEqual(originalFiles), "same_original_live_dependencies");
        Expect(!originalInvocationReturned() && actualDependentReleaseOrRetryCalls() == 0,
            "same_invocation_no_return_retry_termination_or_dependent_release");
    }
}
