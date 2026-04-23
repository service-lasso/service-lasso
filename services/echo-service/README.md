# Echo Service Fixture Note

The canonical Echo Service implementation now lives in the sibling repo:

- `C:\projects\service-lasso\lasso-echoservice`

This folder remains in `service-lasso` only as a thin local fixture surface so the core runtime repo can keep self-contained discovery and operator-data tests.

What should live here:
- the local fixture manifest
- tiny fixture-only runtime files needed for self-contained core-runtime tests
- fixture-only notes if needed

What should not live here anymore:
- the real Go service implementation
- service-repo-owned build files
- the canonical service-repo documentation

If you want to run the real Echo Service harness, use the `lasso-echoservice` repo directly.
