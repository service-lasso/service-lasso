# Secret Reference Audit

Service Lasso exposes a read-only secret reference audit so operators and API consumers can find services that depend on broker-managed secret refs without printing secret material.

## API

- GET /api/secrets/audit
- GET /api/services/SERVICE_ID/secrets/audit
- GET /api/secrets/rotation-readiness
- GET /api/services/SERVICE_ID/secrets/rotation-readiness
- GET /api/secrets/provider-auth-required
- GET /api/services/SERVICE_ID/secrets/provider-auth-required

The response includes service id, manifest path, reference metadata, location, status, and aggregate counts. It never includes resolved values, raw env values, provider credentials, tokens, passwords, or private-key material.

Reference statuses:

- present: the broker ref is declared in broker.imports, broker.exports, or broker.writeback.generatedSecrets.
- missing: a broker selector in namespace.key form is used in env, globalenv, install files, or config files but is not declared in broker policy.
- malformed: a secret-shaped selector is present but is not a supported broker ref in namespace.key form.

## CLI

Commands:

- service-lasso secrets audit --json
- service-lasso secrets audit SERVICE_ID --json
- service-lasso secrets rotation-readiness --json
- service-lasso secrets rotation-readiness SERVICE_ID --json
- service-lasso secrets provider-auth-required --json
- service-lasso secrets provider-auth-required SERVICE_ID --json

Human output prints aggregate counts only. JSON output returns the same safe metadata as the API.

## Rotation Readiness Report

The rotation-readiness report groups secret refs and classifies the next blocker before a rotate campaign can safely proceed.

Per ref, the report includes:

- policy status: declared, missing, or malformed.
- provider capability for the rotate operation: supported, unsupported, unknown, or blocked.
- provider auth requirement: unknown or blocked in the core runtime because live provider auth state belongs to the Secrets Broker.
- last-used manifest metadata: source sections, manifest locations, reference count, and whether any use is required.
- machine-readable blockers such as missing_broker_policy, malformed_ref, rotation_capability_unknown, rotation_capability_not_declared, and provider_auth_requirement_unknown.

Readiness statuses:

- ready: policy is declared, rotate capability is supported, and no provider auth check is required.
- needs_policy: the ref is used but is not declared in broker policy.
- needs_capability: policy is declared but rotate capability is unsupported or unknown.
- needs_auth_check: rotate capability is declared but the Secrets Broker must confirm live provider auth state before rotation.
- blocked: the ref is malformed or cannot be evaluated safely.

## Provider Auth-Required Summary

The provider-auth-required summary is a narrow operator view for reconnect planning before rotation or migration workflows. It reports safe metadata only:

- service id, ref, namespace/key, provider name, and manifest locations.
- per-ref status: auth_required, not_required, or blocked.
- provider aggregates for refs that need broker auth/reconnect confirmation.
- counts for affected services, providers, references, auth-required refs, not-required refs, and blocked refs.

Core does not return provider credentials, raw secret values, OAuth tokens, provider response bodies, cookies, private keys, passwords, or raw env values. An `auth_required` status means the Secrets Broker must confirm provider reconnect/auth state before the ref is used by rotate or migration workflows; it is not a raw secret reveal path.

## Scope

This audit is intentionally diagnostic. It does not resolve secrets, contact a provider, create a new broker, or validate runtime authorization. The rotation-readiness report only classifies static manifest policy and declared rotate capability. Broker enforcement and live provider auth checks remain the responsibility of the Secrets Broker integration and runtime execution path.
