import type { ServiceLogEntryResponse } from "../../contracts/api.js";

export interface ServiceLogsResponse {
  logs: {
    serviceId: string;
    logPath: string;
    stdoutPath: string;
    stderrPath: string;
    entries: ServiceLogEntryResponse[];
  };
}

export function createServiceLogsResponse(logs: ServiceLogsResponse["logs"]): ServiceLogsResponse {
  return { logs };
}
