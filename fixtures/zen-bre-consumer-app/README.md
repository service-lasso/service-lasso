# ZEN BRE consumer fixture

This fixture shows the canonical consuming-app location for the optional
`lasso-zen-bre` service. `services/zen-bre/service.json` is copied from the
verified GitHub release and pins that immutable release tag and its checksummed
platform assets.

The released manifest stays disabled by default. A real consuming app should
review its decision-model governance, set `enabled` deliberately, and place JDM
models beneath the service-owned `decisions/` workspace. Do not replace the
release tag with a floating channel.
