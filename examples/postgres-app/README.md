# Service Lasso + PostgreSQL

A small app with a managed database and a real write/read success check.

```sh
npm ci
npm run setup
npm start
```

Open http://127.0.0.1:18552. In another terminal, run `npm run check`.
Expected: `PASS: database write + read and app HTTP response.`
Stop with `npm run stop`; your data stays in `workspace/`.

The public `pgadmin` tutorial credentials are for loopback evaluation only.

## Concurrent copies

Use a separate unpacked folder for each copy. Set three unused, distinct ports
in that copy's terminal before setup, and keep the same environment for start
and check (including any second terminal). For example, in PowerShell:

```powershell
$env:LASSO_EXAMPLE_CORE_PORT = '28550'
$env:LASSO_EXAMPLE_DATABASE_PORT = '28551'
$env:LASSO_EXAMPLE_APP_PORT = '28552'
```

In a POSIX shell, use `export LASSO_EXAMPLE_CORE_PORT=28550` and equivalent
assignments for the other two variables. The defaults remain 18550/18551/18552;
all overrides must be integers from 1024 through 65535. Choose a different
triplet for each simultaneous copy. Open the configured app port and run
`npm run stop` from each owned folder; do not stop another copy's processes.

This example still installs the Core version pinned in its shrinkwrap. Testing
a different candidate requires an explicitly recorded dependency substitution;
do not describe the pinned package as current source qualification.

[Walkthrough](https://github.com/service-lasso/service-lasso/blob/develop/docs/first-useful-service.md) · [Configure and recover](https://github.com/service-lasso/service-lasso/blob/develop/docs/operate-your-service.md) · [Package for another machine](https://github.com/service-lasso/service-lasso/blob/develop/docs/package-your-app.md)
