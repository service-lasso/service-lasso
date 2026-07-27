export interface HealthcheckReadinessOptions {
  interval?: number;
  retries?: number;
  start_period?: number;
  timeout?: number;
}

export interface ProcessHealthcheck extends HealthcheckReadinessOptions {
  type: "process";
}

export interface HttpHealthcheck extends HealthcheckReadinessOptions {
  type: "http";
  url: string;
  expected_status?: number;
}

export interface TcpHealthcheck extends HealthcheckReadinessOptions {
  type: "tcp";
  address?: string;
  host?: string;
  port?: string | number;
}

export interface UdpHealthcheck extends HealthcheckReadinessOptions {
  type: "udp";
  address?: string;
  host?: string;
  port?: string | number;
  send: string;
  expect: string;
}

export interface FileHealthcheck extends HealthcheckReadinessOptions {
  type: "file";
  file: string;
}

export interface VariableHealthcheck extends HealthcheckReadinessOptions {
  type: "variable";
  variable: string;
}

export type ServiceHealthcheck =
  | ProcessHealthcheck
  | HttpHealthcheck
  | TcpHealthcheck
  | UdpHealthcheck
  | FileHealthcheck
  | VariableHealthcheck;

export interface ServiceHealthResult {
  type: ServiceHealthcheck["type"] | "provider" | "unknown";
  healthy: boolean;
  detail: string;
}
