export interface ServiceLogsResponse {
  logs: {
    serviceId: string;
    logPath: string;
    entries: { level: "info"; message: string }[];
  };
}

export function createServiceLogsResponse(logs: ServiceLogsResponse["logs"]): ServiceLogsResponse {
  return { logs };
}
