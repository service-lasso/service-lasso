export type ProviderKind = "direct" | "node" | "python" | "java";

export interface ProviderExecutionPlan {
  provider: ProviderKind;
  providerServiceId: string | null;
  executable: string;
  args: string[];
  commandPreview: string;
  providerEnv: Record<string, string>;
  commandRoot: string | null;
}
