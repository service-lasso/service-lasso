import {
  buildDiagnosticsBundle,
  buildDiagnosticsBundlePreview,
  type DiagnosticsBundlePreview,
  type DiagnosticsBundleOptions,
} from "../diagnostics/bundle.js";

export type DiagnosticsCliAction = "bundle";

export interface DiagnosticsCliOptions extends DiagnosticsBundleOptions {
  action: DiagnosticsCliAction;
  preview: boolean;
}

export interface DiagnosticsCliResult extends DiagnosticsBundlePreview {
  action: "bundle-preview";
}

export async function runDiagnosticsCliAction(options: DiagnosticsCliOptions): Promise<DiagnosticsCliResult> {
  if (!options.preview) {
    throw new Error('The "diagnostics bundle" command currently requires --preview.');
  }

  const bundle = await buildDiagnosticsBundle(options);
  return {
    action: "bundle-preview",
    ...buildDiagnosticsBundlePreview(bundle),
  };
}
