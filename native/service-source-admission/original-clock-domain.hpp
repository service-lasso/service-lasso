#pragma once
// Selected whole source algorithm, pending PRIMARY physical owner/lifecycle
// definitions and different ENTIRE architecture review. No positive producer
// exists merely because a declaration below has a native-sounding name.
#include "original-clock-domain-owner-proposal.hpp"
#include <cstring>
#include <utility>
#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#include <fcntl.h>
#include <cerrno>
#include <sys/syscall.h>
#endif

namespace slcore {
// Exact same-owner retained cell+acquisition frame; no Handle destructor. A
// failure returns this actual rooted outcome instead of unwinding a native FD.
struct OriginalClockRetainedAcquisition {
  OriginalClockHandleCellLease cell;
  OriginalClockFrameLease frame;
};
namespace originalClockDetail {
inline OriginalClockRetainedAcquisition retainCurrentProcess(
    OriginalClockRootLease& root,std::uint64_t sourceTransition){
#ifdef _WIN32
  // Frame/cell/control/terminal reservations MUST all succeed before native IO.
  auto frame=root.reserveNativeFrame(1,0,sizeof(HANDLE),sizeof(HANDLE),sourceTransition);
  auto cell=root.reserveEmptyNativeCell(1);
  HANDLE held=nullptr;
  const auto result=DuplicateHandle(GetCurrentProcess(),GetCurrentProcess(),
      GetCurrentProcess(),&held,0,FALSE,DUPLICATE_SAME_ACCESS);
  const auto error=result?0:GetLastError();
  OriginalClockNativeResult raw{};raw.nativeCallEntered=true;raw.result=result;raw.nativeError=error;
  raw.rawHandle=reinterpret_cast<std::uintptr_t>(held);raw.requestedFlags=DUPLICATE_SAME_ACCESS;
  raw.attempt=frame.originalAttempt();raw.actualBodyBytes=0; // return scalars are in raw
  // Nonthrowing adoption happens before record formatting/allocation/validation.
  cell.commitOriginalAcquisition(frame,raw);
  if(!result||held==nullptr||held==INVALID_HANDLE_VALUE)root.denyOriginal(frame);
#else
  auto frame=root.reserveNativeFrame(1,sizeof(pid_t),sizeof(int),sizeof(pid_t)+sizeof(int),sourceTransition);
  auto cell=root.reserveEmptyNativeCell(1);
  // Native actual PID observation belongs in the pre-enrolled frame. It must
  // correlate to the lifecycle root; it is never accepted from a request.
  const auto pid=getpid();
  std::memcpy(frame.unpublishedInput(),&pid,sizeof(pid));
  const auto fd=static_cast<int>(syscall(SYS_pidfd_open,pid,0));
  const auto error=fd<0?errno:0;
  OriginalClockNativeResult raw{};raw.nativeCallEntered=true;raw.result=fd;raw.nativeError=error;
  raw.rawHandle=static_cast<std::uintptr_t>(fd);raw.actualProcess=pid;
  raw.attempt=frame.originalAttempt();raw.actualBodyBytes=0;
  cell.commitOriginalAcquisition(frame,raw);
  if(pid<=0||fd<0)root.denyOriginal(frame);
#endif
  root.publishOriginalFrame(frame);
  return {std::move(cell),std::move(frame)};
}
// Source-private only: every call below uses a source-derived held parent and
// literal member/actual current native ID. This is not a public path producer.
#ifndef _WIN32
inline OriginalClockRetainedAcquisition retainLiteralChild(
    OriginalClockRootLease& root,const OriginalClockHandleCellLease& parent,
    const char* literal,std::size_t literalBytes,int sourceFlags,
    std::uint64_t sourceTransition){
  auto frame=root.reserveNativeFrame(2,literalBytes,sizeof(int),sizeof(int),sourceTransition);
  auto cell=root.reserveEmptyNativeCell(2);
  // Primary frame owns exact literal input extent; no temporary std::string.
  for(std::size_t i=0;i<literalBytes;++i)frame.unpublishedInput()[i]=static_cast<std::uint8_t>(literal[i]);
  const auto fd=openat(static_cast<int>(parent.retainedRawHandle()),literal,sourceFlags);
  const auto error=fd<0?errno:0;
  OriginalClockNativeResult raw{};raw.nativeCallEntered=true;raw.result=fd;raw.nativeError=error;
  raw.rawHandle=static_cast<std::uintptr_t>(fd);raw.requestedFlags=sourceFlags;
  raw.attempt=frame.originalAttempt();raw.actualBodyBytes=0;
  cell.commitOriginalAcquisition(frame,raw);
  if(fd<0)root.denyOriginal(frame);
  root.publishOriginalFrame(frame);return {std::move(cell),std::move(frame)};
}
#endif
inline void attemptOriginalNativeClose(OriginalClockRootLease& root,
    OriginalClockHandleCellLease& cell,std::uint64_t sourceTransition){
  auto frame=root.reserveNativeFrame(3,0,sizeof(OriginalClockCellIdentity),0,sourceTransition);
  // Source serializes cell/users/IO once-only close admission. False performs
  // NO native call and is not a successful close or physical retirement.
  if(!cell.beginOriginalClose(frame)){root.publishOriginalFrame(frame);return;}
  const auto original=cell.retainedRawHandle();
#ifdef _WIN32
  const auto result=CloseHandle(reinterpret_cast<HANDLE>(original));
  const auto error=result?0:GetLastError();
#else
  const auto result=::close(static_cast<int>(original));
  const auto error=result<0?errno:0;
#endif
  OriginalClockNativeResult raw{};raw.nativeCallEntered=true;raw.result=result;raw.nativeError=error;
  raw.rawHandle=original;raw.attempt=frame.originalAttempt();raw.actualBodyBytes=0;
  cell.commitOriginalClose(frame,raw); // once result+error+identity retained
#ifdef _WIN32
  if(!result)root.denyOriginal(frame);
#else
  if(result<0)root.denyOriginal(frame); // EINTR retained unresolved, NEVER retry
#endif
  root.publishOriginalFrame(frame);
}
}
// Full capture/worker/peer algorithms join actual primary lifecycle/physical
// leases; declarations cannot manufacture those leases or a positive Deadline.
class OriginalClockThreadCustody {
public:
  static OriginalSamplerLease retainOriginalCaptureSampler(
      OriginalClockRootLease&,const OriginalProcessLifecycleLease&);
  static OriginalSamplerLease retainOriginalWorkerSampler(
      OriginalClockRootLease&,const OriginalCaptureAuthorityLease&,
      const OriginalProcessLifecycleLease&);
};
class OriginalClockDomainCustody {
public:
  static OriginalPeerDomainLease retainOriginalPeerDomain(
      OriginalClockRootLease&,const OriginalSamplerLease&,
      const OriginalAuthenticatedChannelLease&,
      const OriginalProcessLifecycleLease&);
};
}
