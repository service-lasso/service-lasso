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

export const LOCAL_OPERATOR_USERNAME_FIELD = "LOCAL_OPERATOR_USERNAME";
export const LOCAL_ADMIN_TOKEN_FIELD = "LOCAL_ADMIN_TOKEN";
export const LOCAL_OPERATOR_PASSWORD_FIELD = "LOCAL_OPERATOR_PASSWORD";

/**
 * Stable first-run field names in {@link LOCAL_OPERATOR_SECRET_KV_PATH}.
 * Names only; never log or print the values.
 */
export const FIRST_RUN_VAULT_FIELD_NAMES = [
  LOCAL_OPERATOR_USERNAME_FIELD,
  LOCAL_ADMIN_TOKEN_FIELD,
  LOCAL_OPERATOR_PASSWORD_FIELD,
] as const;

export const ORIGINAL_CLIENT_ADDRESS_HEADER = "x-service-lasso-client-address";
export const TRUSTED_INGRESS_HEADER = "x-service-lasso-trusted-ingress";
export const TRUSTED_INGRESS_VALUE = "serviceadmin-loopback";
export const SERVICEADMIN_PROXY_HEADER = "x-service-lasso-proxy";
export const SERVICEADMIN_PROXY_VALUE = "serviceadmin";
/** Exact internal-proxy marker the packaged Admin sets on loopback Core requests. */
export const SERVICEADMIN_INTERNAL_PROXY_HEADER = "x-service-lasso-internal-proxy";
export const LOCAL_ADMIN_TOKEN_HEADER = "x-service-lasso-admin-token";

/** Traefik protected-route identity headers. Trusted only from exact loopback ingress. */
export const TRAEFIK_USER_HEADER = "x-service-lasso-user";
export const TRAEFIK_WORKSPACE_HEADER = "x-service-lasso-workspace";
export const TRAEFIK_ROLES_HEADER = "x-service-lasso-roles";
export const TRAEFIK_ACTOR_HEADER = "x-service-lasso-actor";

/** Canonical / Admin-normalized identity headers Core also accepts from trusted ingress. */
export const ZITADEL_USER_ID_HEADER = "x-service-lasso-zitadel-user-id";
export const USER_ID_HEADER = "x-service-lasso-user-id";
export const WORKSPACE_ID_HEADER = "x-service-lasso-workspace-id";
export const ZITADEL_ROLES_HEADER = "x-service-lasso-zitadel-roles";
export const ZITADEL_GROUPS_HEADER = "x-service-lasso-zitadel-groups";

export const LOCAL_OPERATOR_STATE_RELATIVE_PATH = ".service-lasso/local-operator-auth.json";

/** One-time loopback envelope deleted after the operator confirms they saved the token. */
export const LOCAL_OPERATOR_FIRST_RUN_RELATIVE_PATH = ".service-lasso/local-operator-first-run.json";

export const LOCAL_OPERATOR_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const REMOTE_LOGIN_MAX_FAILURES = 5;
export const REMOTE_LOGIN_WINDOW_MS = 15 * 60 * 1000;
