export interface ApiErrorBody {
  error: string;
  message: string;
  statusCode: number;
}

export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class LifecycleStateError extends Error {
  readonly code = "invalid_lifecycle_state";
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "LifecycleStateError";
  }
}

export function toApiErrorBody(error: unknown): ApiErrorBody {
  if (error instanceof ApiError) {
    return {
      error: error.code,
      message: error.message,
      statusCode: error.statusCode,
    };
  }

  if (error instanceof LifecycleStateError) {
    return {
      error: error.code,
      message: error.message,
      statusCode: error.statusCode,
    };
  }

  if (typeof error === "object" && error !== null) {
    const maybeError = error as { code?: unknown; statusCode?: unknown; message?: unknown };
    if (typeof maybeError.code === "string" && typeof maybeError.statusCode === "number") {
      return {
        error: maybeError.code,
        message: typeof maybeError.message === "string" ? maybeError.message : "Request failed.",
        statusCode: maybeError.statusCode,
      };
    }
  }

  return {
    error: "internal_error",
    message: error instanceof Error ? error.message : "Unknown API failure.",
    statusCode: 500,
  };
}
