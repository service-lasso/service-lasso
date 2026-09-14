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

[Walkthrough](https://github.com/service-lasso/service-lasso/blob/develop/docs/first-useful-service.md) · [Configure and recover](https://github.com/service-lasso/service-lasso/blob/develop/docs/operate-your-service.md) · [Package for another machine](https://github.com/service-lasso/service-lasso/blob/develop/docs/package-your-app.md)
