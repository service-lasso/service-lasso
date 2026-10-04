# Managed Todo learning path

Run this example through Service Lasso, starting with the
[beginner tutorial](../../docs/getting-started/beginner-todo-app.md). It adds
`todo-app` to the demo's **running** inventory, `workspace/canonical-services-root`.
The checked-in `services` folder is only the baseline seed source.

Stop the demo and wait for its process to exit before changing the inventory.
Run `node examples/getting-started-todo/add.mjs`, then restart the demo.
Use Service Admin for health, resolved URL, logs, start/stop and restart persistence.

Next, `add-stage.mjs postgres` adds the pinned database and switches Todo to SQL.
Then `add-stage.mjs api` builds the Go API and switches Todo to an HTTP proxy.
Both helpers run from the checkout root, with the demo stopped. Optional arguments
are documented in the helper's usage error for isolated service/workspace roots.
Go 1.22+ is needed for the API stage. Keep every service's data when restarting.

These are loopback-only development examples. Admin operator login is separate
from user authentication; Todo has no user login. PostgreSQL uses public local
tutorial credentials. This is not a production release or GA qualification.
