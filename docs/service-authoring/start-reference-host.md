---
title: Start a reference host
---

# Start a reference host

Use this shared workflow for the Node, web, Electron, Tauri, SEA, pkg and nexe
[reference apps](../reference-apps.md). The host owns its application UI, service
inventory and private workspace. Core supplies the runtime; Service Admin supplies
the operator UI.

## Before starting

Choose a recorded source revision or release and its declared Node/toolchain
requirements. Install dependencies using that repository's lockfile instructions.
Source development can require a separately built Service Admin checkout; a
downloaded release must instead be checked against its own artifact contract.
Do not assume a sibling development checkout is included in a release archive.

Keep `servicesRoot` and `workspaceRoot` explicit and separate. The services root
contains the app's pinned manifests; the workspace holds its private runtime state,
logs and acquired artifacts. Use an owned folder and available ports for each
instance. Preserve existing workspaces when trying another template.

## Run the host and check the operator journey

1. Review the app's `services/` inventory. Include the released Echo and Service
   Admin manifests needed for this journey; leave optional examples disabled unless
   the app deliberately opts into them. [Connect consumers](04-wire-consumers.md)
   explains the manifest boundary.
2. Check the host configuration for both roots and the runtime API address. Confirm
   that the mounted/proxied Admin build is configured for that API. Use the app's
   repository instructions for its entrypoint and dependency setup.
3. Start the source host. The reviewed plain Node starter uses `npm start`.
   Follow the selected variant's entrypoint for a desktop or executable output.
4. Open the host URL it prints and then its Admin entry. Confirm that the host's own
   UI loads, Admin reaches the selected runtime, and Echo is listed from this app's
   inventory. A host page alone is not the complete check.
5. Use Admin to start Echo, inspect its status and logs, then stop it. Confirm the
   stopped state before accepting the journey. Record the source/release, platform,
   selected roots and result; keep private paths and logs out of public evidence.

The expected result is one app-owned host with a reachable operator UI and an
observed start/log/stop cycle for its own Echo instance. These steps are a task
checklist, not a claim that every template or platform has passed it.

## Choose the package boundary

| Output | What the recipient needs to verify |
| --- | --- |
| Source | Declared toolchain, dependency installation and the host entrypoint |
| Runtime / bootstrap-download | Launcher and payload present; service archives can be acquired from the pinned manifests |
| Bundled | Launcher, payload and matching acquired service archives present; first-run service acquisition is unnecessary for that inventory |

SEA, pkg and nexe examples carry a colocated application payload. Keep that layout
when transferring their wrapper; an executable filename does not establish a
single-file installer. Check the component's package and release verifier before
accepting the output on another machine. [Package the example](../package-your-app.md)
separately explains the Core source-package exercise.

The reviewed Electron/Tauri sources mix a host POC with desktop-shell goals and do
not provide native compilation proof. Verify the actual native shell, platform
toolchain and output separately from this hosted Admin/Echo journey.

## Cleanup and recovery

Stop the journey's Echo instance through its operator controls, then use the host's
documented shutdown. Confirm its owned processes stop. Retain the workspace if logs
or state are needed for recovery; do not remove another instance's folder.

If Admin is missing, check the selected build/mount rather than accepting a blank
page. If it cannot connect, compare the configured API address and ports. If Echo
is absent, check `servicesRoot` and its manifest identity. For startup/acquisition
failures, inspect the selected instance's runtime logs and
[dependency diagnostics](../reference/baseline-dependency-diagnostics.md); correct
the observed cause before repeating a lifecycle mutation.

Exact reviewed source identities and per-path ownership are recorded in
[the authoring migration decisions](../components/authoring-migration-decisions.json).
Repository build commands, native-wrapper configuration and release contracts
remain authoritative in their owning repositories.
