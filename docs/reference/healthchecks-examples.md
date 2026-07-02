# Healthchecks Examples

This page gives concrete `healthchecks[]` examples for Service Lasso service manifests.

## HTTP-only service

```json
"healthchecks": [
  {
    "id": "http-health",
    "type": "http",
    "url": "http://127.0.0.1:${HTTP_PORT}/health",
    "expected_status": 200,
    "retries": 80,
    "interval": 250
  }
]
```

## TCP then HTTP service

```json
"healthchecks": [
  {
    "id": "tcp-port-open",
    "type": "tcp",
    "host": "127.0.0.1",
    "port": "${HTTP_PORT}",
    "retries": 30,
    "interval": 250
  },
  {
    "id": "http-ready",
    "type": "http",
    "url": "http://127.0.0.1:${HTTP_PORT}/health",
    "expected_status": 200,
    "retries": 80,
    "interval": 250
  }
]
```

## UDP service

```json
"healthchecks": [
  {
    "id": "udp-ready",
    "type": "udp",
    "host": "127.0.0.1",
    "port": "${UDP_PORT}",
    "send": "ping",
    "expect": "pong",
    "retries": 80,
    "interval": 250,
    "timeout": 1000
  }
]
```

## Runtime variable from stdout

```json
"outputvarregex": {
  "FILEBEAT_ENABLED_INPUTS": ".*Loading and starting Inputs completed. Enabled inputs: (\\d+).*"
},
"healthchecks": [
  {
    "id": "filebeat-inputs-ready",
    "type": "variable",
    "variable": "FILEBEAT_ENABLED_INPUTS",
    "retries": 180,
    "interval": 1000
  }
]
```

## Required plus optional diagnostics

```json
"healthchecks": [
  {
    "id": "http-ready",
    "type": "http",
    "url": "http://127.0.0.1:${HTTP_PORT}/health",
    "required": true
  },
  {
    "id": "diagnostic-ready-file",
    "type": "file",
    "file": "runtime/diagnostic-ready.txt",
    "required": false
  }
]
```

The service is ready when `http-ready` passes. The optional file check is reported but does not block startup.
