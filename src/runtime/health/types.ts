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

export interface FileHealthcheck {
  type: "file";
  file: string;
}

export interface VariableHealthcheck {
  type: "variable";
  variable: string;
}

export type ServiceHealthcheck =
  | ProcessHealthcheck
  | HttpHealthcheck
  | TcpHealthcheck
  | FileHealthcheck
  | VariableHealthcheck;

export interface ServiceHealthResult {
  type: ServiceHealthcheck["type"] | "unknown";
  healthy: boolean;
  detail: string;
}
