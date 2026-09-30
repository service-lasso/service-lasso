const reasons = new Set([
  "ancestry_predates_parent_before_root",
  "ancestry_predates_parent_within_root",
]);
const parentBirthRelations = new Set([
  "parent_before_root",
  "parent_at_or_after_root",
]);
const childBirthRelations = new Set(["child_before_root"]);
const depthBuckets = new Set(["one", "two_to_four", "five_plus"]);

export type WindowsTreeInspectionMetadata = Record<string, string | boolean | null>;

// This is deliberately closed: process identity, dates, parent IDs, commands,
// paths, helper output, and exception text never cross this boundary.
export function projectWindowsTreeInspectionMetadata(value: unknown): WindowsTreeInspectionMetadata {
  try {
    if (!value || typeof value !== "object") return {};
    const metadata = value as Record<string, unknown>;
    const reason = metadata.windowsTreeInspectionLastRetry;
    const parentBirthRelation = metadata.windowsTreeInspectionParentBirthRelation;
    const childBirthRelation = metadata.windowsTreeInspectionChildBirthRelation;
    const rootFingerprintMatch = metadata.windowsTreeInspectionRootFingerprintMatch;
    const depthBucket = metadata.windowsTreeInspectionAncestryDepthBucket;
    const complete =
      typeof reason === "string" && reasons.has(reason) &&
      typeof parentBirthRelation === "string" && parentBirthRelations.has(parentBirthRelation) &&
      typeof childBirthRelation === "string" && childBirthRelations.has(childBirthRelation) &&
      typeof rootFingerprintMatch === "boolean" &&
      typeof depthBucket === "string" && depthBuckets.has(depthBucket);
    return complete
      ? {
          windowsTreeInspectionLastRetry: reason,
          windowsTreeInspectionParentBirthRelation: parentBirthRelation,
          windowsTreeInspectionChildBirthRelation: childBirthRelation,
          windowsTreeInspectionRootFingerprintMatch: rootFingerprintMatch,
          windowsTreeInspectionAncestryDepthBucket: depthBucket,
        }
      : {};
  } catch {
    return {};
  }
}

export function windowsTreeInspectionFailureMetadata(error: unknown): WindowsTreeInspectionMetadata {
  try {
    if (!error || typeof error !== "object") return {};
    return projectWindowsTreeInspectionMetadata(
      (error as { windowsTreeInspection?: unknown }).windowsTreeInspection,
    );
  } catch {
    return {};
  }
}
