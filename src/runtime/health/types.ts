export interface ProcessHealthcheck {
  type: "process";
}

export interface HttpHealthcheck {
  type: "http";
  url: string;
  expected_status?: number;
}

export interface TcpHealthcheck {
  type: "tcp";
  address: string;
}

export type ServiceHealthcheck = ProcessHealthcheck | HttpHealthcheck | TcpHealthcheck;

export interface ServiceHealthResult {
  type: ServiceHealthcheck["type"] | "unknown";
  healthy: boolean;
  detail: string;
}
