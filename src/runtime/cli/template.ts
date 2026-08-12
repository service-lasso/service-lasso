import { discoverServices } from "../discovery/discoverServices.js";
import { buildTemplateUpgradeCompatibilityReport, type TemplateUpgradeCompatibilityReport } from "../template/upgrade-compatibility.js";

export type TemplateCliAction = "check-upgrade";

export interface TemplateCliOptions {
  action: TemplateCliAction;
  targetServicesRoot: string;
  coreServicesRoot?: string;
}

export type TemplateCliResult = TemplateUpgradeCompatibilityReport & {
  action: "check-upgrade";
};

export async function runTemplateCliAction(options: TemplateCliOptions): Promise<TemplateCliResult> {
  const coreServicesRoot = options.coreServicesRoot ?? "./services";
  const [currentServices, targetServices] = await Promise.all([
    discoverServices(coreServicesRoot),
    discoverServices(options.targetServicesRoot),
  ]);

  return {
    action: options.action,
    ...buildTemplateUpgradeCompatibilityReport({
      currentCoreRoot: coreServicesRoot,
      targetServicesRoot: options.targetServicesRoot,
      currentServices,
      targetServices,
    }),
  };
}
