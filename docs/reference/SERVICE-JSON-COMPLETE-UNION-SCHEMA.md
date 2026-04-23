# SERVICE-JSON-COMPLETE-UNION-SCHEMA

Full union analysis reference for `service.json` across `C:\projects\service-lasso`.

## Schema review (from service-lasso docs + ref analysis)

After reviewing `service-lasso/README.md`, `docs/reference/shared-runtime/SERVICE-MANAGER-BEHAVIOR.md`, and `docs/reference/shared-runtime/QUESTION-LIST-AND-CODE-VALIDATION.md`, this is the intended action model:

- Actions are a **finite lifecycle surface**, not arbitrary verbs.
- `install` and `config` are both valid and should remain distinct.

Why both exist:

- `install` = converge payload/runtime to an install-ready state (archive extraction, setup commands, first-time bootstrap work).
- `config` = converge configuration state without reinstalling payload (regenerate config, refresh runtime settings, reconcile local state).

Expected behavior:

- If an action is omitted, Service Lasso should use default manager behavior based on `execconfig`.
- `actions.<name>.commandline` should be treated as an **override hook**, not a required duplicate command map for every action.

## Improvement proposal (cleaner than current union)

The current union has too much duplicated `commandline` structure inside each action. A better canonical design is:

1) Keep the finite action names (`install`, `config`, `start`, `stop`, `restart`, `reset`, `uninstall`).
2) Add explicit action intent metadata (`mode`, `idempotent`, `destructive`).
3) Keep action overrides optional (`commandline` only when needed).
4) Keep most runtime execution in `execconfig` once, not repeated in each action.

Suggested normalized action shape:

```json
"actions": {
  "install": {
    "description": "<text>",
    "mode": "converge-install",
    "idempotent": true,
    "commandline": { "win32": "<optional-override>", "darwin": "<optional-override>", "linux": "<optional-override>", "default": "<optional-override>" }
  },
  "config": {
    "description": "<text>",
    "mode": "converge-config",
    "idempotent": true,
    "commandline": { "win32": "<optional-override>", "darwin": "<optional-override>", "linux": "<optional-override>", "default": "<optional-override>" }
  },
  "start": { "description": "<text>", "mode": "runtime-start", "idempotent": true },
  "stop": { "description": "<text>", "mode": "runtime-stop", "idempotent": true },
  "restart": { "description": "<text>", "mode": "runtime-restart", "idempotent": false },
  "reset": { "description": "<text>", "mode": "state-reset", "idempotent": false },
  "uninstall": { "description": "<text>", "mode": "payload-remove", "destructive": true }
}
```

This keeps `install` and `config` explicit (as discussed), but removes unnecessary duplication and makes action semantics clearer.

## Clean canonical skeleton (keys only, no concrete values)

```json
{
  "id": "<service-id>",
  "name": "<display-name>",
  "description": "<description>",
  "enabled": "<boolean>",
  "version": "<version>",
  "status": "<status-code>",
  "logoutput": "<boolean>",
  "icon": [
    {
      "provider": "<icon-provider>",
      "name": "<icon-name>"
    }
  ],
  "logo": [
    {
      "path": "<logo-path>"
    }
  ],
  "servicetype": "<number>",
  "servicelocation": "<number>",
  "logs": {
    "default": {
      "path": "<log-path>"
    }
  },
  "actions": {
    "install": {
      "description": "<text>",
      "commandline": {
        "win32": "<command>",
        "darwin": "<command>",
        "linux": "<command>",
        "default": "<command>"
      }
    },
    "config": {
      "description": "<text>",
      "commandline": {
        "win32": "<command>",
        "darwin": "<command>",
        "linux": "<command>",
        "default": "<command>"
      }
    },
    "start": {
      "description": "<text>",
      "commandline": {
        "win32": "<command>",
        "darwin": "<command>",
        "linux": "<command>",
        "default": "<command>"
      }
    },
    "stop": {
      "description": "<text>",
      "commandline": {
        "win32": "<command>",
        "darwin": "<command>",
        "linux": "<command>",
        "default": "<command>"
      }
    },
    "restart": {
      "description": "<text>",
      "commandline": {
        "win32": "<command>",
        "darwin": "<command>",
        "linux": "<command>",
        "default": "<command>"
      }
    },
    "reset": {
      "description": "<text>",
      "commandline": {
        "win32": "<command>",
        "darwin": "<command>",
        "linux": "<command>",
        "default": "<command>"
      }
    },
    "uninstall": {
      "description": "<text>",
      "commandline": {
        "win32": "<command>",
        "darwin": "<command>",
        "linux": "<command>",
        "default": "<command>"
      }
    }
  },
  "execconfig": {
    "serviceorder": "<number>",
    "serviceport": "<number>",
    "serviceportsecondary": "<number>",
    "serviceportconsole": "<number>",
    "serviceportdebug": "<number>",
    "execcwd": "<path>",
    "datapath": "<path>",
    "debuglog": "<boolean>",
    "execservice": {
      "id": "<provider-service-id>",
      "cli": "<provider-cli-key>"
    },
    "executable": {
      "win32": "<provider-exec-key-or-local-exec>",
      "darwin": "<provider-exec-key-or-local-exec>",
      "linux": "<provider-exec-key-or-local-exec>",
      "default": "<provider-exec-key-or-local-exec>"
    },
    "executablecli": {
      "win32": "<provider-exec-cli>",
      "darwin": "<provider-exec-cli>",
      "linux": "<provider-exec-cli>",
      "default": "<provider-exec-cli>"
    },
    "commandline": {
      "win32": "<command-payload>",
      "darwin": "<command-payload>",
      "linux": "<command-payload>",
      "default": "<command-payload>"
    },
    "commandlinecli": {
      "win32": "<command-payload-cli>",
      "darwin": "<command-payload-cli>",
      "linux": "<command-payload-cli>",
      "default": "<command-payload-cli>"
    },
    "commandconfig": {
      "source": "<source-path>",
      "target": "<target-path>"
    },
    "args": [
      "<arg>"
    ],
    "env": {
      "<ENV_KEY>": "<value>"
    },
    "globalenv": {
      "<GLOBAL_ENV_KEY>": "<value>"
    },
    "depend_on": [
      "<dependency-service-id>"
    ],
    "setuparchive": {
      "win32": {
        "name": "<archive-name>",
        "output": "<extract-output-dir>"
      },
      "darwin": {
        "name": "<archive-name>",
        "output": "<extract-output-dir>"
      },
      "linux": {
        "name": "<archive-name>",
        "output": "<extract-output-dir>"
      },
      "default": {
        "name": "<archive-name>",
        "output": "<extract-output-dir>"
      }
    },
    "setup": {
      "win32": [
        "<install-cmd>"
      ],
      "darwin": [
        "<install-cmd>"
      ],
      "linux": [
        "<install-cmd>"
      ],
      "default": [
        "<install-cmd>"
      ]
    },
    "portmapping": {
      "<PORT_NAME>": "<port-value>"
    },
    "urls": {
      "<URL_KEY>": "<url-template-or-value>"
    },
    "outputvarregex": {
      "<OUTPUT_KEY>": "<regex>"
    },
    "healthcheck": {
      "type": "<process|http|tcp|file|variable>",
      "url": "<health-url>",
      "expected_status": "<http-status>",
      "retries": "<retry-count>",
      "variable": "<variable-name>",
      "cookies": {
        "<COOKIE_KEY>": "<cookie-value>"
      }
    },
    "execshell": "<shell>",
    "ignoreexiterror": "<boolean>"
  }
}
```

## Union skeleton (keys only)

```json
{
  "id": "<value>",
  "name": "<value>",
  "description": "<value>",
  "enabled": "<value>",
  "version": "<value>",
  "status": "<value>",
  "logoutput": "<value>",
  "icon": [
    {
      "provider": "<value>",
      "name": "<value>"
    }
  ],
  "logo": [
    {
      "path": "<value>"
    }
  ],
  "servicetype": "<value>",
  "servicelocation": "<value>",
  "logs": {
    "default": {
      "path": "<value>"
    }
  },
  "actions": {
    "install": {
      "description": "<value>",
      "commandline": {
        "win32": "<value>",
        "darwin": "<value>",
        "linux": "<value>",
        "default": "<value>"
      }
    },
    "config": {
      "description": "<value>",
      "commandline": {
        "win32": "<value>",
        "darwin": "<value>",
        "linux": "<value>",
        "default": "<value>"
      }
    },
    "start": {
      "description": "<value>",
      "commandline": {
        "win32": "<value>",
        "darwin": "<value>",
        "linux": "<value>",
        "default": "<value>"
      }
    },
    "stop": {
      "description": "<value>",
      "commandline": {
        "win32": "<value>",
        "darwin": "<value>",
        "linux": "<value>",
        "default": "<value>"
      }
    },
    "restart": {
      "description": "<value>",
      "commandline": {
        "win32": "<value>",
        "darwin": "<value>",
        "linux": "<value>",
        "default": "<value>"
      }
    },
    "reset": {
      "description": "<value>",
      "commandline": {
        "win32": "<value>",
        "darwin": "<value>",
        "linux": "<value>",
        "default": "<value>"
      }
    },
    "uninstall": {
      "description": "<value>",
      "commandline": {
        "win32": "<value>",
        "darwin": "<value>",
        "linux": "<value>",
        "default": "<value>"
      }
    }
  },
  "execconfig": {
    "serviceorder": "<value>",
    "serviceport": "<value>",
    "serviceportsecondary": "<value>",
    "serviceportconsole": "<value>",
    "serviceportdebug": "<value>",
    "execcwd": "<value>",
    "datapath": "<value>",
    "debuglog": "<value>",
    "execservice": {
      "id": "<value>",
      "cli": "<value>"
    },
    "executable": {
      "win32": "<value>",
      "darwin": "<value>",
      "linux": "<value>",
      "default": "<value>"
    },
    "executablecli": {
      "win32": "<value>",
      "darwin": "<value>",
      "linux": "<value>",
      "default": "<value>"
    },
    "commandline": {
      "win32": "<value>",
      "darwin": "<value>",
      "linux": "<value>",
      "default": "<value>"
    },
    "commandlinecli": {
      "win32": "<value>",
      "darwin": "<value>",
      "linux": "<value>",
      "default": "<value>"
    },
    "commandconfig": {
      "source": "<value>",
      "target": "<value>"
    },
    "args": [
      "<value>"
    ],
    "env": {
      "<ENV_KEY>": "<value>"
    },
    "globalenv": {
      "<GLOBAL_ENV_KEY>": "<value>"
    },
    "depend_on": [
      "<value>"
    ],
    "setuparchive": {
      "win32": {
        "name": "<value>",
        "output": "<value>"
      },
      "darwin": {
        "name": "<value>",
        "output": "<value>"
      },
      "linux": {
        "name": "<value>",
        "output": "<value>"
      },
      "default": {
        "name": "<value>",
        "output": "<value>"
      }
    },
    "setup": {
      "win32": [
        "<value>"
      ],
      "darwin": [
        "<value>"
      ],
      "linux": [
        "<value>"
      ],
      "default": [
        "<value>"
      ]
    },
    "portmapping": {
      "<PORT_NAME>": "<value>"
    },
    "urls": {
      "<URL_KEY>": "<value>"
    },
    "outputvarregex": {
      "<OUTPUT_KEY>": "<value>"
    },
    "healthcheck": {
      "type": "<value>",
      "url": "<value>",
      "expected_status": "<value>",
      "retries": "<value>",
      "variable": "<value>",
      "cookies": {
        "<COOKIE_KEY>": "<value>"
      }
    },
    "execshell": "<value>",
    "ignoreexiterror": "<value>"
  }
}
```

## Runtime-provider clarification

When `execconfig.execservice` is present, the service is intended to run through another runtime/provider service.

In that case:
- `execservice` identifies the provider/runtime service
- `executable` identifies which executable from that provider should be used
- `args` / `commandline` describe what should be passed to that executable

Example intent:

```json
"execconfig": {
  "execservice": "@node",
  "executable": "NODE",
  "args": ["runtime/server.js"]
}
```

This should be read as: use the `@node` runtime provider, invoke its exported `NODE` executable, then pass `runtime/server.js` as the payload.

Direct-run services can omit `execservice` and use `executable` as the local binary/script reference instead.

## Notes

- This file is a schema+placeholder representation.
- Concrete value catalogs are in `SERVICE-JSON-COMPLETE-UNION-VALUES.json` and `SERVICE-JSON-COMPLETE-UNION-VALUES.md`.
