# Java Runtime Service Plan

Date: 2026-04-25

Linked issue: `#93`

Spec binding: `SPEC-002`, `AC-4H`, `AC-4X`, `AC-4Y`, `AC-6`

## Decision

Java is now a tracked bounded runtime/provider service in core as `services/@java/service.json`.

For this slice, `@java` is intentionally local/no-download. It declares the provider contract and exports `JAVA` / `JAVA_HOME` placeholders without redistributing a JRE. This avoids pretending that the donor embedded JRE archive can be republished safely before the project has made an explicit source, license, vendor, platform, and security-update decision.

## Donor Evidence

Donor `_java` lives at:

- `ref/typerefinery-service-manager-donor/services/_java/service.json`

The donor shape is:

- service id `java`
- embedded Java JRE 17 provider
- platform archives under `win32`, `darwin`, and expected `linux`
- executable paths such as `java/bin/java` or `java\\bin\\java.exe`
- global env exports `JAVA=${SERVICE_EXECUTABLE}` and `JAVA_HOME=${SERVICE_PATH}\\java\\bin`

Donor Keycloak and other JVM-backed services consume the Java runtime through provider-style behavior. They should not be migrated until the Java provider contract is stable.

## Implemented Core Slice

The current bounded implementation includes:

- `services/@java/service.json` as the canonical core provider manifest
- provider resolution for `execservice: "@java"`
- provider execution metadata with provider kind `java` and provider service id `@java`
- lifecycle proof that a Java-provider-backed service runs through the provider path, receives provider env, records provider runtime state, and stops cleanly

This mirrors the current `@node` and `@python` local provider approach rather than introducing a release-backed JRE distribution prematurely.

## Not Baseline

`@java` is not part of the clean-clone starter baseline today.

The current starter baseline remains:

- `@traefik`
- `@node`
- `echo-service`
- `service-admin`

Reference apps and `service-template` should add `services/@java/service.json` only when they include a Java-backed service such as Keycloak, TypeDB, or another JVM workload.

## Future Release-Backed Repo

A dedicated `service-lasso/lasso-java` service repo is deferred until the project chooses a JRE distribution strategy.

The broader provider-release delivery plan is tracked in:

- `docs/development/runtime-provider-release-services-delivery-plan.md`
- GitHub issue `#170`

Before that repo is created, decide:

- JRE vendor and license, for example Eclipse Temurin or another redistributable build
- supported platforms and CPU architectures
- archive provenance and checksum verification
- update policy for JRE security releases
- whether the archive contains a full JRE, a wrapper that uses system Java, or both
- release workflow outputs using `yyyy.m.d-<shortsha>`

When that decision is made, the repo should publish:

- `service.json`
- `lasso-java-win32.zip`
- `lasso-java-linux.tar.gz`
- `lasso-java-darwin.tar.gz`
- checksums for each archive if supported by the release tooling

## Follow-Up Path For Java Services

After `@java` is proven as a release-backed runtime service, Java-dependent services should be migrated separately.

Expected order:

1. Promote `@java` from local/no-download to release-backed if the JRE distribution decision is approved.
2. Add install/acquire validation for the release-backed `@java` archive.
3. Add one real JVM-backed sample service using `execservice: "@java"`.
4. Migrate Keycloak or TypeDB as separate service issues, using the already released Java runtime.

## Verification

Current verification:

- `npm test`
- targeted provider tests in `tests/provider-execution.test.js`
- manifest discovery of `services/@java/service.json`

This is enough to remove Java from donor/reference-only status, but not enough to claim release-backed JRE distribution.
