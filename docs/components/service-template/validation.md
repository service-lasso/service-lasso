# Validation

Reference validation files:
- `verify/service-harness.json`
- `scripts/verify.ps1`
- `scripts/verify.sh`

Current first-pass direction:
- consumer repos should call the shared released `service-lasso-harness` binary
- the template provides the example contract and thin wrappers
- local and CI usage should share the same harness contract path
- default health model is `process`; other health models should come from explicit service config

Ref/code-backed donor `healthchecks[]` item types observed:
- `http`
- `tcp`
- `file`
- `variable`

Current starter implementation status:
- GitHub Actions now packages starter release archives on Windows/Linux/macOS
- GitHub Actions now runs basic starter tests on each platform
- GitHub Actions now downloads the released `service-lasso-harness` binary and runs the template verify flow through that harness path

---

[Component guides](../README.md) · Imported from [service-template](https://github.com/service-lasso/service-template/blob/023b76bb2836f3c0e59c870407fd71a4e2e73f88/docs/validation.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.
