---
title: Connect optional app services
---

# Connect optional app services

These tasks cover reader workflows reviewed under [Core #1419](https://github.com/service-lasso/service-lasso/issues/1419). They describe source contracts, not newly executed runtime acceptance. Exact source identities and every reviewed path are recorded in [the decision ledger](app-service-migration-decisions.json). Package manifests, schemas, launchers and verifiers remain component-owned.

Before starting, use an app-owned service inventory and a dedicated workspace. Select the released manifest and platform archive you intend to use; resolve its endpoints from that manifest instead of assuming the example ports below. Supply credentials through the app's approved configuration. See [the inventory contract](../ecosystem/README.md#services-folder-contract) and [connect consumers](../service-authoring/04-wire-consumers.md). Stop only the services started for your task, and retain logs and data until you have inspected any failure.

## Connect CACAO Roaster to SOARCA

Prerequisites: app-owned `soarca` and `cacao-roaster` manifests, their release artifacts, and the configuration required by SOARCA.

1. Configure and start SOARCA through your app's lifecycle. Check its resolved readiness endpoint (`GET /status/ping` in the reviewed contract).
2. Start CACAO Roaster after its SOARCA dependency is ready. The Roaster manifest consumes `SOARCA_URL` and passes it to the browser bundle as `SOARCA_END_POINT`.
3. Open Roaster's resolved UI and check its `/healthcheck`. Authoring a playbook in Roaster and executing it in SOARCA are separate actions; choose a harmless app-owned test playbook before exercising execution.

Expected result: the Roaster UI has the configured SOARCA endpoint. Health alone does not prove playbook execution. If pairing fails, inspect the resolved endpoint, dependency readiness and app configuration before restarting. On completion stop your Roaster instance, then SOARCA if you started it solely for this task; preserve playbooks and execution records according to your app's policy.

## Browse and upload app-owned files

Prerequisites: the released `files` service, a dedicated data root, an approved upload type and size, and a disposable sample file. Managed workspace access additionally requires the consuming runtime's approved workspace registry.

1. Add `services/files/service.json` to your inventory and configure `FILES_DATA_PATH` or the managed data path. Set `FILES_ALLOWED_EXTENSIONS`, `FILES_BLOCKED_EXTENSIONS` and `FILES_MAXSIZE_MB` at startup.
2. Start the service and open `/files` on its resolved UI endpoint. Check `/healthcheck` and `/api/config` before uploading.
3. Inspect `/api/sources` and select the intended source/root. Managed workspaces may become the default source; do not assume the local data root is selected. Read-only roots permit browsing/download but reject mutations with 403; hidden/protected roots are omitted.
4. Upload the sample through the UI or multipart `POST /api/file-system/upload`, then list and download it. Confirm that the selected root contains only the intended task data.

Blocked extensions override allowed extensions. API configuration updates are in memory; persist startup policy in the app's manifest/environment instead of assuming `PUT` or `PATCH /api/config` survives restart. If an upload fails, inspect source permissions, extension rules and size limits rather than broadening workspace access.

For existing integrations, replace legacy path-based upload calls with `/api/file-system/upload`; use the canonical id-based copy/move/rename APIs and `/content/<path>` for previews. The component [URL contract](https://github.com/service-lasso/lasso-files/blob/24daa58f3420d3803b07db336200c789d147cc4a/docs/url-contracts.md) owns request details. Remove only your disposable sample through the selected source, then stop your instance. Retain all preexisting workspace files.

## Configure Filebeat log shipping

Prerequisites: a released `filebeat` manifest, an app-owned log source and a compatible output with approved credentials. Filebeat is disabled by default; OpenObserve remains optional and app-owned.

1. Configure `FILEBEAT_LOG_GLOB` for your intended log files. The reviewed default watches the service root's `logs/*.log`.
2. Configure the output host/path/index and credentials through the consuming app. The reviewed generated configuration uses `output.elasticsearch` with `OPENOBSERVE_URL`; confirm that your selected output supports that protocol.
3. Enable and start Filebeat. Inspect its resolved metrics endpoint (reviewed default port 5066), then verify receipt of a harmless marker in your selected output.
4. Run the manual `setup-dashboards` step only if your output supports Filebeat setup assets. Ordinary log shipping does not require it.

Expected result: both metrics readiness and the marker arriving at the output. A passing metrics check does not prove ingestion. If no marker arrives, inspect input matching and output/authentication errors without exposing credentials. Stop your instance and remove only your marker or temporary files when the output's retention policy permits. Preserve existing logs and indices.

## Synchronize Dagu managed workflows

Prerequisites: the reviewed Dagu sync utility, Python, a reviewed registry JSON file or URL, a dedicated generated output directory and the consuming Core action API. Dagu is optional; it does not own service action implementations or grant itself permissions through actor metadata.

1. Keep custom Git-authored workflows outside the managed output directory. Back up existing generated files before adopting overwrite behavior.
2. From the owning `lasso-dagu` checkout, run the utility with your registry, output directory and action API URL. This fixture example generates files; it does not start Dagu or execute the actions:

```text
python scripts/sync-service-lasso-workflows.py --registry fixtures/service-lasso/workflow-registry.sample.json --output-dir workflows/managed/service-lasso --action-api-url http://127.0.0.1:17883
```

3. Inspect the generated files and their `x-service-lasso.managedBy: service-lasso` identity. The utility overwrites managed workflows from the registry; disabled entries are omitted. Add `--prune-stale` only when you intend to remove stale managed files. Custom files without managed ownership must remain unchanged.
4. Review the target service/action and approved input policy before running any generated task. Tasks call `POST /api/services/:serviceId/actions/:actionId/runs`; correlate the returned action run id with safe workflow/step metadata.

Expected result for sync: reviewed generated YAML matching the registry and untouched custom workflows. Startup and periodic invocation are later launcher integration directions, not automatic behavior established by this utility. If sync or an action fails, retain safe identifiers and the API rejection; do not silently run stale output or retry with altered inputs.

Prefer `payloadRef` for operator-selected or larger requests; use inline values for small app-owned inputs. Mixed inputs require the action's explicit policy. See [Core action inputs](../reference/service-action-inputs.md) and the component's [input contract](https://github.com/service-lasso/lasso-dagu/blob/c6d4a55cb9263e9ba73fe09dbe975ec40dbc837d/docs/service-lasso-action-inputs.md). Keep credentials and secret values out of YAML and logs. After a disposable sync, remove only the dedicated generated directory you created; preserve custom files, registry sources and existing run history.

## Call BPMN Server from your app

Prerequisites: a running app-owned `bpmn-server` and its dependencies, an approved API key, a test model and an app-owned client or one-shot setup script.

1. Read the manifest-exported `BPMN_URL` and `API_KEY` from the app's approved runtime context. Supply the key in `x-api-key`; avoid putting it in browser URLs or logs.
2. Send the app's intended request to the server's API. The reviewed example starts a model with `POST /api/engine/start/<encoded-model-name>` and a JSON body containing `data`.
3. Check the HTTP status before reading the result. Retain safe instance identifiers and status, not raw secret-bearing response bodies.

Expected result: the app receives its workflow instance result. On rejection, check the key, model and request against the owning API contract before retrying. Dispose of test instances through the app's supported workflow and stop only servers you started for the task; preserve shared server data.

The client sample is application or one-shot job behavior. It has no independent daemon, healthcheck, data directory or lifecycle contract and does not require a separate managed `bpmn-client` service. If you choose the upstream client package, keep it in the consuming app. Component APIs and schemas remain authoritative.

## Packaging and authoring

The audited generic packaging/bootstrap/extension-point documents map to [authoring overview](../service-authoring/overview.md), [create a release repository](../service-authoring/03-create-release-repo.md) and [validate a release](../service-authoring/05-validate-release.md). Use the source-owned manifest and platform verifier for each service. Copied Echo health or harness examples do not establish Filebeat capability or lifecycle acceptance.

Companion README/navigation changes remain tracked under #1419. This Core guide does not claim component migration, publication or runtime qualification complete.
