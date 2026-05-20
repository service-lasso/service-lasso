# Runtime API Capabilities

Service Admin and app hosts can inspect `GET /api/runtime/capabilities` before enabling runtime-backed controls.

The endpoint is read-only and returns a compact compatibility contract:

```json
{
  "capabilities": {
    "runtime": {
      "version": "0.1.0",
      "apiContractVersion": "2026-05-runtime-capabilities-v1",
      "servicesRoot": "C:\\\\app\\\\services",
      "workspaceRoot": "C:\\\\app\\\\.service-lasso"
    },
    "features": {
      "lifecycleActions": true,
      "runtimeOrchestration": true,
      "dashboardAdapter": true,
      "serviceMetadata": true,
      "logReader": true,
      "serviceMetrics": true,
      "serviceVariables": true,
      "serviceNetwork": true,
      "updates": true,
      "recovery": true,
      "setupSteps": true,
      "dependencyGraph": true,
      "globalEnv": true,
      "lanBinding": true,
      "localRouteGeneration": true,
      "autostartRequested": false,
      "monitorEnabled": false,
      "updateSchedulerEnabled": false
    },
    "endpointGroups": [
      {
        "id": "runtime",
        "basePath": "/api/runtime",
        "methods": ["GET /api/runtime", "GET /api/runtime/capabilities", "POST /api/runtime/actions/:action"]
      }
    ],
    "baseline": {
      "totalServices": 2,
      "enabledServices": 2,
      "roles": [
        {
          "role": "provider",
          "count": 1,
          "serviceIds": ["@node"]
        },
        {
          "role": "service",
          "count": 1,
          "serviceIds": ["@serviceadmin"]
        }
      ]
    },
    "compatibility": {
      "serviceAdmin": {
        "minimumApiContractVersion": "2026-05-runtime-capabilities-v1",
        "supportedDashboardAdapter": true,
        "preferredRoutes": [
          "/api/dashboard",
          "/api/dashboard/services",
          "/api/dashboard/services/:serviceId",
          "/api/runtime/capabilities"
        ],
        "notes": [
          "Use this endpoint before enabling runtime-backed UI controls.",
          "Treat missing or false feature flags as unavailable and fail closed for mutating actions."
        ]
      }
    }
  }
}
```

Consumers must treat unknown flags as unavailable. Mutating controls should stay disabled unless the required feature flag and route group are present.

The response intentionally reports safe metadata only. It does not include service environment values, broker refs beyond service ids, tokens, private keys, cookies, passwords, or raw secret material.
