---
title: Package the example for another machine
---

# Package the example for another machine

Start with the [Intermediate — durable PostgreSQL example](getting-started/intermediate-make-todo-app-durable.md) after the [Beginner — Todo app](getting-started/beginner-todo-app.md). This exercise makes a **source package**: the recipient needs Node.js 22+, npm, and internet access to install the pinned runtime and service releases.

From `examples/postgres-app`, stop the example and create the package:

```sh
npm run stop
npm pack
```

Inspect the file list printed by npm. It includes application scripts and dependency metadata. It must not include `workspace/`, downloaded binaries, database files, credentials, or logs.

On the receiving machine, extract the archive into a new folder, open its `package` directory, and run:

```sh
npm ci
npm run setup
npm start
```

In another terminal, run `npm run check`. Accept the transfer only when the write/read check and app response pass there. Use `npm run stop` when finished. Keep the recipient's workspace private and separate from the archive.

For a ready-to-run binary or an offline archive, choose a [reference app](reference-apps.md) and follow [package outputs](releases/README.md). Those require platform-specific bundled artifacts and verification. A source archive working on one Windows machine does not establish offline, macOS, or Linux acceptance.
