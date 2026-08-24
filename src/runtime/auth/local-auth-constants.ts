/**
 * Well-known local-operator auth paths and field names.
 *
 * KV paths are Broker-encrypted store selectors. Values must never appear in
 * `service.json`, audit payloads, or test output.
 */
export const LOCAL_OPERATOR_USERNAME = "local-operator";

/** Broker KV path for the force-SSO switch. Field: {@link FORCE_SSO_FIELD}. */
export const LOCAL_AUTH_POLICY_KV_PATH = "runtime/auth";

/** Vault field that forces remote login through SSO only. */
export const FORCE_SSO_FIELD = "FORCE_SSO";

/** Broker KV path for revealable local-operator secrets. */
export const LOCAL_OPERATOR_SECRET_KV_PATH = "runtime/local-operator";

export const LOCAL_ADMIN_TOKEN_FIELD = "LOCAL_ADMIN_TOKEN";
export const LOCAL_OPERATOR_PASSWORD_FIELD = "LOCAL_OPERATOR_PASSWORD";

export const ORIGINAL_CLIENT_ADDRESS_HEADER = "x-service-lasso-client-address";
export const TRUSTED_INGRESS_HEADER = "x-service-lasso-trusted-ingress";
export const TRUSTED_INGRESS_VALUE = "serviceadmin-loopback";
export const SERVICEADMIN_PROXY_HEADER = "x-service-lasso-proxy";
export const SERVICEADMIN_PROXY_VALUE = "serviceadmin";
export const LOCAL_ADMIN_TOKEN_HEADER = "x-service-lasso-admin-token";

export const LOCAL_OPERATOR_STATE_RELATIVE_PATH = ".service-lasso/local-operator-auth.json";

/** One-time loopback envelope deleted after the operator confirms they saved the token. */
export const LOCAL_OPERATOR_FIRST_RUN_RELATIVE_PATH = ".service-lasso/local-operator-first-run.json";

export const LOCAL_OPERATOR_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const REMOTE_LOGIN_MAX_FAILURES = 5;
export const REMOTE_LOGIN_WINDOW_MS = 15 * 60 * 1000;
