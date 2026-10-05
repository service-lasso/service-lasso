// SOURCE ONLY prospective real-native harness cases. No mock owner, callback
// grant, admitted realm, qualified kernel or allocator receipt is supplied.
#include "original-clock-domain.hpp"
#include <cassert>

namespace slcore::prospective {
// Harness must provide an actually pre-enrolled SAME original owner root with
// authentic lifecycle/progress/terminal capacity before invoking this case.
void actualProcessAcquisitionRetainsNativeReturn(OriginalClockRootLease& root,
    std::uint64_t originalSourceTransition){
  auto result=originalClockDetail::retainCurrentProcess(root,originalSourceTransition);
  const auto body=result.frame.retainedResult();
  assert(body.attempt==result.frame.originalAttempt());
  assert(result.cell.identity().ownerGeneration==result.frame.identity().ownerGeneration);
#ifdef _WIN32
  assert(body.result!=0&&body.nativeError==0&&body.rawHandle!=0);
#else
  assert(body.result>=0&&body.nativeError==0&&body.actualProcess>0);
#endif
  // This is raw native acquisition proof only; it is never peer/source/domain
  // qualification or a successful constructor from a boolean assertion.
  originalClockDetail::attemptOriginalNativeClose(root,result.cell,originalSourceTransition);
}
// All these cases require the original production native owner/actor graph;
// declarations intentionally have no fixture producer or synthetic success.
void allocationFailureBeforeEveryNativeAcquireRetainsNoUnownedHandle(
    OriginalNativeAdmissionOwner&,const OriginalProcessLifecycleLease&,
    const OriginalSourceClockProgressGraph&);
void firstAndLastBorrowerAbandonmentKeepsOriginalFailedRootAndRawBytes(
    OriginalNativeAdmissionOwner&,const OriginalMandatoryArchiveLease&);
void actualCaptureAndWorkerTaskBirthDomainCorrelation(
    OriginalClockRootLease&,const OriginalCaptureAuthorityLease&,
    const OriginalProcessLifecycleLease&);
void actualSameAndDifferentTimeNamespaceDeniedRightsAndRecycledTask(
    OriginalClockRootLease&,const OriginalSamplerLease&,
    const OriginalAuthenticatedChannelLease&);
void actualSetnsExecTransitionAndBackAndDuplicateTransferredChannelDenial(
    OriginalClockRootLease&,const OriginalAuthenticatedChannelLease&,
    const OriginalProcessLifecycleLease&);
void actualOriginalRawCloseErrorAttemptAndNoDestructorRetry(
    OriginalClockRootLease&,OriginalClockHandleCellLease&);
void original10s40sTokenAuthQueueProviderStorageAndReceiverAdoptOnce(
    OriginalClockRootLease&,const OriginalCaptureAuthorityLease&,
    const OriginalPeerDomainLease&);
void full67108864JourneyWithAll23Peak134217728AndMandatoryRawArchive(
    OriginalNativeAdmissionOwner&,const OriginalSourceClockProgressGraph&,
    const OriginalMandatoryArchiveLease&);
// These are mandatory missing native harness sources, not passing assertions.
// Their exact source fixtures follow selected concrete owner/native actor APIs;
// no import/compile/native/test/ACL/ENV execution is authorised here.
}