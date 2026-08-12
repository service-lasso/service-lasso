# Runtime Capabilities API

`GET /api/runtime/capabilities` is the read-only compatibility contract for app hosts and Service Admin. Consumers should call it before enabling runtime-dependent controls.

The response includes:

- runtime version
- API contract version
- supported endpoint groups
- feature flags for available runtime surfaces
- option-derived flags for autostart, monitor, and update scheduler state
- discovered service roles and default-baseline membership
- Service Admin compatibility hints
- the read-only operator MCP endpoint group

The endpoint exposes metadata only. It must not include raw environment values, provider credentials, secret payloads, tokens, cookies, private keys, or recovery material.

Example shape:

```json
{
  "capabilities": {
    "runtime": {
      "version": "0.1.0"
    },
    "api": {
      "contractVersion": "service-lasso.runtime-capabilities.v1",
      "endpointGroups": [
        {
          "id": "runtime",
          "label": "Runtime",
          "methods": ["GET", "POST"],
          "pathPrefix": "/api/runtime",
          "mutating": true
        }
      ]
    },
    "features": {
      "serviceDiscovery": true,
      "lifecycleActions": true,
      "runtimeOrchestration": true,
      "dashboardAdapter": true,
      "serviceMetadata": true,
      "updates": true,
      "recovery": true,
      "setupSteps": true,
      "dependencyGraph": true,
      "operatorVariables": true,
      "operatorNetwork": true,
      "operatorMetrics": true,
      "operatorLogs": true,
      "operatorMcp": true,
      "providerConnections": false,
      "workflowFacade": false,
      "localRouteGeneration": true,
      "lanBinding": true,
      "autostart": false,
      "monitor": false,
      "updateScheduler": false
    },
    "baseline": {
      "defaultServiceIds": ["@archive", "@java", "@localcert", "@nginx", "@traefik", "@node", "@python", "@secretsbroker", "echo-service", "@serviceadmin"],
      "discoveredServiceCount": 2,
      "serviceRoles": [
        {
          "id": "@serviceadmin",
          "role": "service",
          "enabled": true,
          "defaultBaseline": true
        }
      ]
    },
    "compatibility": {
      "serviceAdmin": {
        "minimumApiContractVersion": "service-lasso.runtime-capabilities.v1",
        "runtimeApiBaseUrlRequired": true,
        "supportsDashboardAdapter": true,
        "supportsSafeSecretMetadataOnly": true,
        "preferredEndpointGroups": ["runtime", "dashboard", "services", "dependencies", "updates", "recovery"],
        "notes": ["Use this endpoint before enabling runtime-dependent controls."]
      }
    }
  }
}
```
