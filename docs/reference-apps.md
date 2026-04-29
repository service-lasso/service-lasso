# Reference Apps

Service Lasso reference apps are template repos you can clone or use as a GitHub
template when you want a working host application instead of starting from an
empty project. Each one uses the published `@service-lasso/service-lasso`
package, carries an app-owned `services/` inventory, and demonstrates how a host
app can show its own UI while still exposing Service Admin and managed services.

Use these templates when you want the fastest path to a real app shape:

- Source templates show the code you are expected to own.
- Bootstrap artifacts download service archives at first run.
- Bundled artifacts already contain downloaded service archives, so the user
  does not need a service download step before startup.
- The checked-in service inventory keeps service choices explicit and reviewable.

## Choose A Template

| Template | Choose it when | Why it is useful |
| --- | --- | --- |
| [`service-lasso-app-node`](https://github.com/service-lasso/service-lasso-app-node) | You need a plain Node host, CLI, daemon, local dev tool, or server-side wrapper. | It is the smallest general-purpose host. It is easy to inspect, easy to automate, and a good baseline before adding a larger UI shell. |
| [`service-lasso-app-web`](https://github.com/service-lasso/service-lasso-app-web) | You want a browser-first app shell around Service Lasso. | It gives users a normal web entry point while still proving runtime/service discovery and Service Admin access. Choose it for dashboards, internal tools, and hosted local-control panels. |
| [`service-lasso-app-electron`](https://github.com/service-lasso/service-lasso-app-electron) | You want a desktop app with strong Node integration and familiar desktop packaging. | Electron is a pragmatic choice when the host needs deep JavaScript ecosystem access, local process orchestration, and a mature desktop distribution path. |
| [`service-lasso-app-tauri`](https://github.com/service-lasso/service-lasso-app-tauri) | You want a lighter native desktop shell and are comfortable with the Tauri/Rust toolchain. | Tauri is a good fit when app size, native shell feel, and a tighter runtime footprint matter more than Electron's Node-native convenience. |
| [`service-lasso-app-packager-pkg`](https://github.com/service-lasso/service-lasso-app-packager-pkg) | You want a `pkg`-based Node executable output. | Use it when consumers expect a packaged executable but your host is still fundamentally a Node app. It demonstrates source, bootstrap-download, and bundled/no-download outputs. |
| [`service-lasso-app-packager-sea`](https://github.com/service-lasso/service-lasso-app-packager-sea) | You want to evaluate Node Single Executable Application distribution. | SEA is worth choosing when you want to stay close to official Node executable packaging and test whether it fits your deployment constraints. |
| [`service-lasso-app-packager-nexe`](https://github.com/service-lasso/service-lasso-app-packager-nexe) | You want to evaluate nexe-style Node executable distribution. | Choose it when nexe matches your packaging environment or you need to compare executable tradeoffs against `pkg` and SEA. |

## What They Prove

Every reference app should make the same core integration story obvious:

- The repo can be cloned and run with documented commands.
- The host app shows its own output, not just Service Admin.
- The host owns a `services/` folder with the services it wants.
- Service Admin is reachable from the host app experience.
- Service Lasso can discover and manage the app's services.
- Echo Service and Service Admin are available as baseline integration targets.

## How To Decide

Start with `service-lasso-app-node` if you are still deciding. It is the
clearest template for understanding the runtime contract and service inventory
without desktop or browser packaging noise.

Choose `service-lasso-app-web` when your users naturally arrive through a
browser. Choose `service-lasso-app-electron` or `service-lasso-app-tauri` when
the app needs a desktop shell. Choose one of the packager templates when the
main product decision is executable distribution rather than UI shape.

If you are building a new service rather than a host app, start with the
[service authoring guide](development/new-lasso-service-guide.md) instead.
