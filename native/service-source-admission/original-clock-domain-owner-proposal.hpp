#pragma once
// SOURCE ARCHITECTURE PROPOSAL ONLY. These declarations are NOT an allocator,
// actual root, realm, source approval or positive production implementation.
// Primary owns the selected backing and definitions after ENTIRE review.
#include <cstddef>
#include <cstdint>

namespace slcore {
class OriginalNativeAdmissionOwner;
class OriginalProcessLifecycleLease;
class OriginalSourceClockProgressGraph;
class OriginalCaptureAuthorityLease;
class OriginalSamplerLease;
class OriginalPeerDomainLease;
class OriginalAuthenticatedChannelLease;
class OriginalMandatoryArchiveLease;

// Native cell identity is owner-assigned, non-reusable while any original raw
// history/borrower exists. It is not a PID, file descriptor or wire authority.
struct OriginalClockCellIdentity {
  std::uint64_t ownerGeneration=0,rootGeneration=0,cellGeneration=0;
};
struct OriginalClockNativeResult {
  bool nativeCallEntered=false;
  std::int64_t result=0;
  std::uint64_t nativeError=0;
  std::uintptr_t rawHandle=0;
  std::uint64_t actualProcess=0,actualThread=0;
  std::uint64_t requestedFlags=0,attempt=0;
  // Input/body extents and API identity were reserved/bound BEFORE the syscall;
  // result/error are captured immediately before any other native API call.
  std::size_t actualBodyBytes=0;
};
class OriginalClockFrameLease;
class OriginalClockHandleCellLease;
class OriginalClockRootLease {
  // Primary-defined intrusive owner/root references. No shared_ptr control
  // allocation and no destructor-driven native close or history retirement.
  OriginalNativeAdmissionOwner* owner_=nullptr;
  OriginalClockCellIdentity root_{};
public:
  OriginalClockRootLease(const OriginalClockRootLease&)=delete;
  OriginalClockRootLease& operator=(const OriginalClockRootLease&)=delete;
  OriginalClockRootLease(OriginalClockRootLease&&)noexcept;
  ~OriginalClockRootLease()noexcept; // releases caller borrower ONLY
  bool sameOriginalOwner(const OriginalNativeAdmissionOwner&)const noexcept;
  // Concrete primary enrollment reserves root/control/lifecycle/error/terminal
  // capacity before any clock native query; failure performs no acquisition.
  static OriginalClockRootLease enroll(OriginalNativeAdmissionOwner&,
      const OriginalProcessLifecycleLease&,const OriginalSourceClockProgressGraph&);
  OriginalClockFrameLease reserveNativeFrame(std::uint32_t sourceApi,
      std::size_t exactInputBytes,std::size_t maximumOutputBytes,
      std::size_t nativeStackBytes,std::uint64_t sourceTransition);
  OriginalClockHandleCellLease reserveEmptyNativeCell(std::uint32_t sourceApi);
  // Borrowing a published frame enrolls real borrower metadata in this SAME
  // arena before returning. The retained root outlives every such caller.
  OriginalClockFrameLease borrowOriginalFrame(OriginalClockCellIdentity);
  // Monotonic denial is owner-serialized; original failure storage already
  // exists. It never allocates, formats strings, throws or ends custody.
  void denyOriginal(const OriginalClockFrameLease&)noexcept;
  // Publication locks are short metadata transitions, never held during IO.
  void publishOriginalFrame(OriginalClockFrameLease&)noexcept;
  // Retirement is a native owner operation after actual ended IO/zero actual
  // borrowers/full mandatory archive readback; no logical Budget.closed path.
  void requestOriginalRetirement(const OriginalMandatoryArchiveLease&)noexcept;
};
class OriginalClockFrameLease {
  OriginalNativeAdmissionOwner* owner_=nullptr;
  OriginalClockCellIdentity frame_{};
public:
  OriginalClockFrameLease(const OriginalClockFrameLease&)=delete;
  OriginalClockFrameLease& operator=(const OriginalClockFrameLease&)=delete;
  OriginalClockFrameLease(OriginalClockFrameLease&&)noexcept;
  ~OriginalClockFrameLease()noexcept; // borrower only; retained root keeps bytes
  std::uint8_t* unpublishedInput()noexcept;
  std::uint8_t* unpublishedOutput()noexcept;
  std::size_t outputCapacity()const noexcept;
  // Nonthrowing stores into already allocated root-linked extent. Immutable
  // after publication. The result body is the actual native output, not hash.
  void commitOriginalResult(const OriginalClockNativeResult&)noexcept;
  OriginalClockNativeResult retainedResult()const noexcept;
  const std::uint8_t* retainedInput()const noexcept;
  const std::uint8_t* retainedOutput()const noexcept;
  OriginalClockCellIdentity identity()const noexcept;
  std::uint64_t originalAttempt()const noexcept;
};
class OriginalClockHandleCellLease {
  OriginalNativeAdmissionOwner* owner_=nullptr;
  OriginalClockCellIdentity cell_{};
public:
  OriginalClockHandleCellLease(const OriginalClockHandleCellLease&)=delete;
  OriginalClockHandleCellLease& operator=(const OriginalClockHandleCellLease&)=delete;
  OriginalClockHandleCellLease(OriginalClockHandleCellLease&&)noexcept;
  ~OriginalClockHandleCellLease()noexcept; // NEVER closes/retries/frees a cell
  // Must be the FIRST non-native action after syscall result/error capture.
  // It adopts successful raw handle AND retains invalid/query failure facts.
  void commitOriginalAcquisition(OriginalClockFrameLease&,
      const OriginalClockNativeResult&)noexcept;
  std::uintptr_t retainedRawHandle()const noexcept;
  OriginalClockCellIdentity identity()const noexcept;
  // Serialized transition checks ended users/IO and binds exactly one already
  // reserved close frame before admitting the once-only actual native call.
  // false means no syscall (not-created, already attempted or live borrowers).
  bool beginOriginalClose(OriginalClockFrameLease&)noexcept;
  void commitOriginalClose(OriginalClockFrameLease&,
      const OriginalClockNativeResult&)noexcept;
};

// These are actual source/native owning associations, not callbacks, boolean
// domain attestations, requested PID/tid or foreign wire/profile records.
class OriginalClockThreadCustodyProposal {
public:
  static OriginalSamplerLease retainOriginalCaptureSampler(
      OriginalClockRootLease&,const OriginalProcessLifecycleLease&);
  static OriginalSamplerLease retainOriginalWorkerSampler(
      OriginalClockRootLease&,const OriginalCaptureAuthorityLease&,
      const OriginalProcessLifecycleLease&);
  static OriginalPeerDomainLease retainOriginalAuthenticatedPeerDomain(
      OriginalClockRootLease&,const OriginalSamplerLease&,
      const OriginalAuthenticatedChannelLease&,
      const OriginalProcessLifecycleLease&);
};
}
