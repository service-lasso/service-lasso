import { verifyReleaseManifest, type ReleaseManifestVerificationReport } from "../release/manifest-verification.js";

export type ReleaseCliAction = "verify-manifest";

export interface ReleaseCliOptions {
  action: ReleaseCliAction;
  manifestPath: string;
  assetsRoot?: string;
  releaseVersion?: string;
}

export type ReleaseCliResult = ReleaseManifestVerificationReport & {
  action: ReleaseCliAction;
};

export async function runReleaseCliAction(options: ReleaseCliOptions): Promise<ReleaseCliResult> {
  return {
    action: options.action,
    ...(await verifyReleaseManifest({
      manifestPath: options.manifestPath,
      assetsRoot: options.assetsRoot,
      releaseVersion: options.releaseVersion,
    })),
  };
}
