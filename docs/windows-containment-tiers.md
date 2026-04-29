---
unlisted: true
---

# Windows containment tiers for Service Lasso

## Purpose

Define the realistic containment model for Windows services managed by Service Lasso.

The key rule is simple:

- `tini-win` is a strong **process babysitter**
- it is **not** a universal Windows containment boundary by itself
- Service Lasso should use a **tiered runtime model** instead of claiming one universal guarantee

## Tier model

| Tier | Mode | Runtime shape | Realistic claim |
| --- | --- | --- | --- |
| 0 | Direct | Run the service process directly | Minimal containment, trusted/simple cases only |
| 1 | Simple babysitter | Run under `tini-win` | Strong ordinary child-tree cleanup for processes that stay in the Job Object |
| 2 | Managed broker | Service Lasso controls launch/broker policy | Stronger control and observability for software we own or adapt |
| 3 | Isolated runtime | Container/VM/strong OS boundary | Strongest practical containment on Windows |

## Tier 1: `tini-win`

### Best fit

Use `tini-win` when:
- the service has one main process
- ordinary child-tree cleanup is the goal
- graceful stop is available or force-kill is acceptable
- the service does not fundamentally rely on external process brokers for normal operation

### What it gives

- one-child launch + wait
- graceful stop + timeout + forced kill
- normal descendant cleanup through Job Objects
- exit-status classification
- explicit characterization of Windows edge cases

### What it does not guarantee

- universal containment of all descendant work
- containment of Scheduler / WMI / COM / SCM launched processes
- containment of breakaway work when breakaway is intentionally allowed
- Linux PID1/subreaper semantics

## Tier 2: managed broker mode

This is the right model when Service Lasso can own the launch path.

### Idea

- child launches go through Service Lasso-approved APIs or brokers
- launches are policy-checked, logged, and attributable
- unapproved external launches are visible as violations or unsupported behavior

### Why it matters

This is the best path for approaching stronger containment without pretending Windows behaves like Linux.

A babysitter can only manage what remains inside its containment model. A brokered launch contract lets Service Lasso own more of the process-creation story.

## Tier 3: isolated runtime mode

Use this when you need containment beyond what a babysitter or managed broker can honestly promise.

Examples:
- Windows containers
- Hyper-V / lightweight VM isolation
- other strong OS-enforced isolation boundaries

This is the practical answer when the requirement is close to “universal containment”.

## Practical wording for Service Lasso

### Safe claims

Service Lasso can honestly claim:
- a cross-platform simple-service management contract
- platform-native runners underneath (`tini` on Linux, `tini-win` on Windows)
- tiered Windows containment with explicit guarantees and limits

### Unsafe claims

Service Lasso should not claim:
- that `tini-win` alone guarantees universal Windows containment
- that Windows process semantics are equivalent to Linux `tini`
- that all child work can always be killed regardless of launch mechanism

## Suggested shared backend contract

A shared `SimpleServiceRunner` API can still be cross-platform if capability differences are explicit.

Suggested fields:
- `runnerKind`
- `supportsGracefulStop`
- `supportsTreeKill`
- `supportsBreakawayControl`
- `escapeRiskClass`
- `isolationTier`
- `notes`

This keeps the higher-level Service Lasso contract consistent while preserving honest platform-specific reality.
