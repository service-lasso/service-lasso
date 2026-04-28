# Java Runtime Service Plan

Date: 2026-04-27

Linked issues: `#93`, `#170`

Spec binding: `SPEC-002`, `AC-4H`, `AC-4X`, `AC-4Y`, `AC-6`

## Decision

Java is now a tracked bounded runtime/provider service in core as `services/@java/service.json`.

For the original core slice, `@java` was intentionally local/no-download. It declares the provider contract and exports `JAVA` / `JAVA_HOME` placeholders without redistributing a JRE.

The release-backed provider decision is now made for `#170`: `service-lasso/lasso-java` packages Eclipse Temurin/Adoptium JRE archives for Java `17.0.18+8` and `21.0.10+7`. Issue `#172` integrates that verified release into the checked-in core `@java` manifest.

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

This mirrors the current optional-provider behavior in core. The release-backed JRE repo now exists, and the core manifest now points at the verified release-backed provider artifact.

## Not Baseline

`@java` is not part of the clean-clone starter baseline today.

The current starter baseline remains:

- `@traefik`
- `@node`
- `echo-service`
- `@serviceadmin`

Reference apps and `service-template` should add `services/@java/service.json` only when they include a Java-backed service such as Keycloak, TypeDB, or another JVM workload.

## Release-Backed Repo

A dedicated `service-lasso/lasso-java` service repo now exists.

The broader provider-release delivery plan is tracked in:

- `docs/development/runtime-provider-release-services-delivery-plan.md`
- GitHub issue `#170`

Resolved first-release decisions:

- JRE vendor/source: Eclipse Temurin/Adoptium
- supported platforms: Windows, Linux, and macOS Intel x64
- archive provenance: upstream Temurin JRE release archives, repackaged with `SERVICE-LASSO-PACKAGE.json`
- checksum output: `SHA256SUMS.txt`
- release workflow output: `yyyy.m.d-<shortsha>`
- first runtime versions: Java `17.0.18+8` and Java `21.0.10+7`
- core/default selection rule: use Java `17.0.18+8` first, not Java `21.0.10+7`
- artifact filenames include the exact Java version and build metadata

Published release:

- Repo: `https://github.com/service-lasso/lasso-java`
- Release: `https://github.com/service-lasso/lasso-java/releases/tag/2026.4.27-b313cb0`
- Workflow: `https://github.com/service-lasso/lasso-java/actions/runs/24978746504`

- `service.json`
- `lasso-java-17.0.18+8-win32.zip`
- `lasso-java-17.0.18+8-linux.tar.gz`
- `lasso-java-17.0.18+8-darwin.tar.gz`
- `lasso-java-21.0.10+7-win32.zip`
- `lasso-java-21.0.10+7-linux.tar.gz`
- `lasso-java-21.0.10+7-darwin.tar.gz`
- `SHA256SUMS.txt`

## Follow-Up Path For Java Services

After `@java` is proven as a release-backed runtime service, Java-dependent services should be migrated separately.

Expected order:

1. Add one real JVM-backed sample service using `execservice: "@java"`.
2. Migrate Keycloak or TypeDB as separate service issues, using the already released Java runtime.

## Verification

Current verification:

- `npm test`
- targeted provider tests in `tests/provider-execution.test.js`
- manifest discovery of `services/@java/service.json`

Release-backed provider verification:

- `service-lasso/lasso-java` local `npm test` passed for Java `17.0.18+8` and Java `21.0.10+7` on Windows.
- Packaging-only validation resolved and packaged Linux Java `21.0.10+7` from the exact Temurin release asset.
- Release workflow `24978746504` passed across Windows/Linux/macOS Intel for Java `17.0.18+8` and `21.0.10+7`.
- Direct Service Lasso install/acquire proof against the checked-in core manifest downloaded `lasso-java-17.0.18+8-win32.zip` from release `2026.4.27-b313cb0` and left the provider `running=false`.

This is enough to claim the standalone `lasso-java` provider repo and the checked-in core `@java` manifest are release-backed. Java-dependent services remain separate follow-up work.
