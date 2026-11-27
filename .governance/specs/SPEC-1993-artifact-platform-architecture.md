# SPEC-1993 Architecture-specific artifact selection

Status: Active. Development; issue #1993; amendment to SPEC-002 artifact installation.
Coordinator confirmed this bounded plan before implementation.

- AC-1993-1: Select the actual process `${platform}-${arch}` artifact first.
- AC-1993-2: Preserve existing bare OS then default fallback. Never select a different architecture by searching or substituting qualified keys. A manifest without any compatible exact/OS/default entry is unsupported.
- AC-1993-3: Acquisition, baseline eligibility, lifecycle provider eligibility, telemetry readiness, lockfile generation/verification, update checking/install and catalog compatibility use one selector. Lockfiles record the selected manifest key, preserving old bare OS/default values.
- AC-1993-4: Catalog hostPlatform remains the OS string, supportedPlatforms remains the sorted declared manifest keys, and existing OS-only reports retain their shape. Qualified-only support uses host architecture internally (optional hostArch override for deterministic inspection).

Proof: deterministic selector precedence/negative matrix, real acquisition/update/lockfile/catalog/baseline paths, existing regression tests and TypeScript build. Foreign-platform selection is source behavior proof, not native executable qualification. No producer publication, deployment or release is authorized.
