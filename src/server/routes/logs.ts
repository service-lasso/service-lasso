import type { ServiceLogEntryResponse } from "../../contracts/api.js";

export interface ServiceLogsResponse {
  logs: {
    serviceId: string;
    logPath: string;
    stdoutPath: string;
    stderrPath: string;
    entries: ServiceLogEntryResponse[];
    archives: {
      archiveId: string;
      archivedAt: string;
      directoryPath: string;
      logPath: string;
      stdoutPath: string;
      stderrPath: string;
    }[];
    retention: {
      maxArchives: number;
    };
  };
}

export function createServiceLogsResponse(logs: ServiceLogsResponse["logs"]): ServiceLogsResponse {
  return { logs };
}
