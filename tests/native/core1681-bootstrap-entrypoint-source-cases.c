/* Prospective actual production entrypoint/resource cases. SOURCE_UNRUN.
 * Include only in a separately reviewed native fixture image with the exact
 * module/source/managed-image/input binding and NEW complete ROOT admission.
 * No API shim, forged return, closed numeric handle or timeout-as-PASS.
 * A fixture owns an independent inspection thread/observer and the SAME owner
 * passed below. Genuine failure prerequisites must be separately supplied;
 * this source does not invent a native mechanism that causes them. */
#define wmain Core1681OriginalBootstrapEntrypoint
#include "../../src/runtime/execution/windows-managed-launcher-native-bootstrap.c"
#undef wmain
static int CountOriginalBootstrapSite(ConptyControl* owner, const char* site) {
  int count = 0;
  for (unsigned i = 0; i < owner->bootstrapCount; i++)
    if (strcmp(owner->bootstrap[i].site,site) == 0) ++count;
  return count;
}
static int OriginalBootstrapSiteFailed(ConptyControl* owner, const char* site) {
  for (unsigned i = 0; i < owner->bootstrapCount; i++)
    if (strcmp(owner->bootstrap[i].site,site) == 0) return owner->bootstrap[i].failure;
  return 0;
}
/* Actual wmain delegates its entire body here, without injected handles or
 * different creation/assignment/wait/cleanup calls. Fixture provides a zeroed
 * original owner, privately bound real inputs/control and actual host failure
 * circumstances. Its observer retains owner independently before dispatch. */
static int RunOriginalBootstrapEntrypointSourceCase(ConptyControl* sameOwner) {
  return RunBootstrapInvocation(sameOwner);
}
static int InspectOriginalOrdinaryEntrypointPositive(ConptyControl* sameOwner, int actualReturn) {
  return actualReturn == (int)sameOwner->originalExitCode && sameOwner->originalChildClosed &&
    CountOriginalBootstrapSite(sameOwner,"managed-child-create") == 1 &&
    CountOriginalBootstrapSite(sameOwner,"managed-child-primary-wait") == 1 &&
    CountOriginalBootstrapSite(sameOwner,"managed-child-exit-query") == 1 &&
    !OriginalBootstrapSiteFailed(sameOwner,"managed-child-primary-wait") &&
    !OriginalBootstrapSiteFailed(sameOwner,"managed-child-exit-query") &&
    !sameOwner->releaseFailed && !sameOwner->allocationReleaseFailed;
}
/* Independently observed ordinary original wait failure, never return/deadline
 * evidence. No managed/thread/input release or replacement wait/kill exists. */
static int InspectOrdinaryEntrypointWaitRetention(ConptyControl* sameOwner) {
  return CountOriginalBootstrapSite(sameOwner,"managed-child-create") == 1 &&
    CountOriginalBootstrapSite(sameOwner,"managed-child-primary-wait") == 1 &&
    OriginalBootstrapSiteFailed(sameOwner,"managed-child-primary-wait") &&
    !sameOwner->originalChildClosed && !sameOwner->originalChildAssigned &&
    sameOwner->originalChild.hProcess && sameOwner->originalChild.hThread &&
    sameOwner->originalHeldFile && sameOwner->originalHeldDirectoryCount > 0 &&
    sameOwner->releaseCount == 0 && sameOwner->containmentCount == 0 &&
    sameOwner->terminationCount == 0;
}
static int InspectUnassignedEntrypointWaitRetention(ConptyControl* sameOwner) {
  return CountOriginalBootstrapSite(sameOwner,"managed-child-assign") == 1 &&
    OriginalBootstrapSiteFailed(sameOwner,"managed-child-assign") &&
    CountOriginalBootstrapSite(sameOwner,"unassigned-child-terminate") == 1 &&
    CountOriginalBootstrapSite(sameOwner,"unassigned-child-wait") == 1 &&
    OriginalBootstrapSiteFailed(sameOwner,"unassigned-child-wait") &&
    !sameOwner->originalChildClosed && !sameOwner->originalChildAssigned &&
    sameOwner->originalChild.hProcess && sameOwner->originalHeldFile &&
    sameOwner->releaseCount == 0 && sameOwner->containmentCount == 0;
}
static int InspectOriginalUnassignedTerminationFailure(ConptyControl* sameOwner) {
  return InspectUnassignedEntrypointWaitRetention(sameOwner) &&
    OriginalBootstrapSiteFailed(sameOwner,"unassigned-child-terminate");
}
static int InspectOriginalEntrypointResumeFailure(ConptyControl* sameOwner) {
  return sameOwner->originalChildAssigned &&
    CountOriginalBootstrapSite(sameOwner,"managed-child-resume") == 1 &&
    OriginalBootstrapSiteFailed(sameOwner,"managed-child-resume") &&
    CountOriginalBootstrapSite(sameOwner,"managed-child-primary-wait") == 0;
}
static int InspectOriginalEntrypointExitFailure(ConptyControl* sameOwner) {
  return sameOwner->originalChildClosed &&
    CountOriginalBootstrapSite(sameOwner,"managed-child-primary-wait") == 1 &&
    CountOriginalBootstrapSite(sameOwner,"managed-child-exit-query") == 1 &&
    OriginalBootstrapSiteFailed(sameOwner,"managed-child-exit-query");
}
/* Actual original provider/hash/storage acquisition and release are inside
 * VerifyManagedLauncher. The fixture path must be the exact independently held
 * original managed input, not a manufactured digest or replacement pin. */
static int RunOriginalHashBindingSourceCase(ConptyControl* sameOwner,
    const wchar_t* originalManagedPath, HANDLE* actualHeldFile) {
  int valid = VerifyManagedLauncher(sameOwner,originalManagedPath,actualHeldFile);
  if (sameOwner->allocationReleaseFailed) RetainConpty();
  return valid;
}
static int InspectOriginalHashReleasePositive(ConptyControl* sameOwner) {
  return !sameOwner->allocationReleaseFailed && !sameOwner->hashHandle &&
    !sameOwner->hashProvider && !sameOwner->hashStorage &&
    CountOriginalBootstrapSite(sameOwner,"hash-destroy") == 1 &&
    CountOriginalBootstrapSite(sameOwner,"hash-provider-release") == 1 &&
    CountOriginalBootstrapSite(sameOwner,"hash-storage-release") == 1 &&
    !OriginalBootstrapSiteFailed(sameOwner,"hash-destroy") &&
    !OriginalBootstrapSiteFailed(sameOwner,"hash-provider-release") &&
    !OriginalBootstrapSiteFailed(sameOwner,"hash-storage-release");
}
static int InspectOriginalHashDestructionRetention(ConptyControl* sameOwner) {
  return sameOwner->allocationReleaseFailed && sameOwner->hashHandle &&
    sameOwner->hashProvider && sameOwner->hashStorage &&
    CountOriginalBootstrapSite(sameOwner,"hash-destroy") == 1 &&
    OriginalBootstrapSiteFailed(sameOwner,"hash-destroy") &&
    CountOriginalBootstrapSite(sameOwner,"hash-storage-release") == 0 &&
    CountOriginalBootstrapSite(sameOwner,"hash-provider-release") == 0;
}
static int RunOriginalEnvironmentReleaseSourceCase(ConptyControl* sameOwner) {
  return SanitizeLoaderEnvironmentOwned(sameOwner);
}
static int InspectOriginalEnvironmentRetention(ConptyControl* sameOwner) {
  return sameOwner->environmentBlock && sameOwner->allocationReleaseFailed &&
    CountOriginalBootstrapSite(sameOwner,"loader-environment-acquire") == 1 &&
    CountOriginalBootstrapSite(sameOwner,"loader-environment-release") == 1 &&
    OriginalBootstrapSiteFailed(sameOwner,"loader-environment-release");
}
