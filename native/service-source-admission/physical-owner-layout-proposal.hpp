#pragma once
#include <array>
#include <cstdint>
#include <type_traits>

// Inert CE2 whole-review candidate. Not a production allocator or authority.
// No native operation, enrollment, receipt or wire serialization is defined.
namespace slcore::physical_owner_proposal {
struct alignas(16) ExtentRecord64 {
  std::uint64_t ownerGeneration, extentGeneration, offset, requestedBytes;
  std::uint64_t roundedBytes, previous, next, stateAndClass;
};
struct alignas(16) NativeCell128 {
  std::uint64_t ownerGeneration, rootGeneration, cellGeneration, nativeTypeAndState;
  std::uint64_t rawHandle, acquisitionAttempt, closeAdmission, closeResult;
  std::uint64_t ioHead, borrowerHead, sourceAssociation, birthAssociation;
  std::uint64_t clockAssociation, objectAssociation, failureAssociation, next;
};
struct alignas(16) BorrowerLink96 {
  std::uint64_t ownerGeneration, rootGeneration, extentGeneration, borrowerGeneration;
  std::uint64_t offset, byteLength, objectAssociation, ioAssociation;
  std::uint64_t role, beginAssociation, endAndState, next;
};
struct alignas(16) Attempt144 {
  // Private storage order avoids implicit padding. Never memcpy to a codec.
  std::uint64_t ownerGeneration, rootGeneration, attemptGeneration;
  std::uint64_t monotonicTick;
  std::uint64_t objectAssociation, birthAssociation, sourceImageAssociation;
  std::uint64_t taskAssociation, clockAssociation, ioAssociation, nativeCellAssociation;
  std::uint64_t inputViewAssociation, outputViewAssociation, stackAssociation, archiveEffectAssociation;
  std::uint32_t sourceApi, sourceTransition, rawInputLength, rawOutputLength;
  std::uint8_t entered, disposition, resultDefinedness, privacyState;
  std::array<std::uint8_t, 4> reserved;
};
struct alignas(16) ArchiveIndex64 {
  std::uint64_t archiveGeneration, archiveBackingOrdinal, archiveByteOffset;
  std::uint64_t archiveRecordByteLength, originalAttemptOrdinal, originalRawViewOrdinal;
  std::uint32_t originalOffset, byteLength, observedState, nextPageSlot;
};
struct alignas(16) PrivacyRange16 {
  std::uint64_t originalOffset;
  std::uint32_t byteLength;
  std::uint8_t sourceDomain;
  std::array<std::uint8_t, 3> reserved;
};
struct alignas(16) Root128 {
  std::uint64_t sourceAssociation, nativeBase, reservedBytes, committedBytes;
  std::uint64_t originalGeometry, freeExtentHead, cellHead, borrowerHead;
  std::uint64_t attemptHead, archiveIndexHead, failureHead, lifecycleAssociation;
  std::uint64_t calibrationAssociation, ownerGeneration, rootGeneration, transitionSerial;
};
struct alignas(16) Result128 {
  std::uint64_t nativeScalar, nativeError, rawHandle, actualPid, actualTid;
  std::uint64_t requestedFlags, attemptAssociation, actualBodyBytes, inputAssociation;
  std::uint64_t outputAssociation, cellAssociation, ioAssociation, stackAssociation, publication;
  std::uint32_t sourceApi;
  std::uint16_t disposition;
  std::uint8_t nativeCallEntered, resultDefinedness;
  std::array<std::uint8_t, 8> reserved;
};
struct alignas(16) Receipt128 {
  std::uint64_t originalRun, generation, effectAssociation, state;
  std::uint64_t firstAttempt, lastAttempt, objectAssociation, sourceAssociation;
  std::uint64_t clockAssociation, archiveAssociation, durabilityAssociation, ioClosure;
  std::uint64_t borrowerAssociation, consumerAssociation, replayAssociation, next;
};
struct alignas(16) JournalRowIndex64 {
  std::array<std::uint8_t, 36> originalId;
  std::uint32_t collectionAndState, originalOffset, byteLength, previous, next;
  std::array<std::uint8_t, 8> reserved;
};
struct alignas(16) CapsuleNamespaceHeader816 {
  std::array<std::uint8_t, 256> catalogIdentity;
  std::array<std::uint8_t, 240> manifestPath;
  std::array<std::uint8_t, 128> templateId;
  std::array<std::uint8_t, 40> templateCommit;
  std::array<std::uint8_t, 64> templateVersion;
  std::array<std::uint8_t, 32> contractDigest;
  std::uint32_t entryCount;
  std::array<std::uint16_t, 5> originalTextLengths;
  std::array<std::uint8_t, 2> reserved;
  std::array<std::uint64_t, 5> originalLeaseAssociations;
};
struct alignas(16) CapsuleNamespaceEntry288 {
  std::array<std::uint8_t, 240> originalPath;
  std::uint16_t pathLength;
  std::uint8_t observedMode, authoredBytes;
  std::uint32_t observedByteCount;
  std::array<std::uint8_t, 32> originalSha;
  std::array<std::uint8_t, 8> reserved;
};
struct alignas(16) CapsuleReadEntry288 {
  std::array<std::uint8_t, 240> originalPath;
  std::uint16_t pathLength;
  std::uint8_t observedMode, reserved;
  std::uint32_t observedByteCount;
  std::uint64_t originalRawOffset;
  std::array<std::uint8_t, 32> originalSha;
};
struct alignas(16) CapsuleReadHeader160 {
  std::array<std::uint64_t, 6> originalLeaseAssociations;
  std::uint32_t entryCount, originalFrameBytes;
  std::uint64_t observedExpandedBytes;
  std::array<std::uint8_t, 32> originalFrameSha, originalWholeSha, originalTerminalMac;
};
struct alignas(16) SourceMemberIndex96 {
  std::uint64_t originalOrdinal, headerOffset, pathOffset, bodyOffset, bodyLength;
  std::array<std::uint8_t, 32> originalRawSha;
  std::array<std::uint8_t, 20> originalGitObject;
  std::uint8_t originalType, originalModeLength;
  std::array<std::uint8_t, 2> reserved;
};
// Inert FIRSTPASS source-bank lineage proposal. This record alone grants no
// borrower, archive handoff, immutable interval or source authority.
struct alignas(16) SourceMemberCapture64 {
  std::uint64_t originalBankOrdinal, originalBankGeneration, originalInputCell;
  std::uint64_t firstAttempt, lastAttempt, actualReturnedBytes, originalHistoryChain;
  std::uint32_t state, reserved;
};
#define SLCORE_PROPOSED_RECORD(Type, Size) \
  static_assert(sizeof(Type) == Size && alignof(Type) == 16); \
  static_assert(std::is_trivially_copyable_v<Type> && std::is_standard_layout_v<Type>)
SLCORE_PROPOSED_RECORD(ExtentRecord64, 64);
SLCORE_PROPOSED_RECORD(NativeCell128, 128);
SLCORE_PROPOSED_RECORD(BorrowerLink96, 96);
SLCORE_PROPOSED_RECORD(Attempt144, 144);
SLCORE_PROPOSED_RECORD(ArchiveIndex64, 64);
SLCORE_PROPOSED_RECORD(PrivacyRange16, 16);
SLCORE_PROPOSED_RECORD(Root128, 128);
SLCORE_PROPOSED_RECORD(Result128, 128);
SLCORE_PROPOSED_RECORD(Receipt128, 128);
SLCORE_PROPOSED_RECORD(JournalRowIndex64, 64);
SLCORE_PROPOSED_RECORD(CapsuleNamespaceHeader816, 816);
SLCORE_PROPOSED_RECORD(CapsuleNamespaceEntry288, 288);
SLCORE_PROPOSED_RECORD(CapsuleReadEntry288, 288);
SLCORE_PROPOSED_RECORD(CapsuleReadHeader160, 160);
SLCORE_PROPOSED_RECORD(SourceMemberIndex96, 96);
SLCORE_PROPOSED_RECORD(SourceMemberCapture64, 64);
#undef SLCORE_PROPOSED_RECORD
}  // namespace slcore::physical_owner_proposal
