export interface ProcessHealthcheck {
  type: "process";
}

export interface HttpHealthcheck {
  type: "http";
  url: string;
  expected_status?: number;
}

export type ServiceHealthcheck = ProcessHealthcheck | HttpHealthcheck;

export interface ServiceHealthResult {
  type: ServiceHealthcheck["type"] | "unknown";
  healthy: boolean;
  detail: string;
}
