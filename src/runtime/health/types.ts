export interface HealthcheckReadinessOptions {
  interval?: number;
  retries?: number;
  start_period?: number;
  timeout?: number;
}

export interface ServiceHealthcheckBase extends HealthcheckReadinessOptions {
  id?: string;
  required?: boolean;
}

export interface ProcessHealthcheck extends ServiceHealthcheckBase {
  type: "process";
}

export interface HttpHealthcheck extends ServiceHealthcheckBase {
  type: "http";
  url: string;
  expected_status?: number;
  cookies?: Record<string, string>;
}

export interface TcpHealthcheck extends ServiceHealthcheckBase {
  type: "tcp";
  address?: string;
  host?: string;
  port?: string | number;
}

export interface UdpHealthcheck extends ServiceHealthcheckBase {
  type: "udp";
  address?: string;
  host?: string;
  port?: string | number;
  send: string;
  expect: string;
}

export interface FileHealthcheck extends ServiceHealthcheckBase {
  type: "file";
  file: string;
}

export interface VariableHealthcheck extends ServiceHealthcheckBase {
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

export interface ServiceHealthcheckResult {
  id: string;
  type: ServiceHealthcheck["type"];
  required: boolean;
  healthy: boolean;
  attempts: number;
  detail: string;
}

export interface ServiceHealthResult {
  type: ServiceHealthcheck["type"] | "aggregate" | "provider" | "unknown";
  healthy: boolean;
  detail: string;
  checks?: ServiceHealthcheckResult[];
}
