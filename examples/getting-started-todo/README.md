# Todo moved to its proper service repository

The supported example is [service-lasso/lasso-todo](https://github.com/service-lasso/lasso-todo), generated through GitHub service-template. It owns runtime, manifest, package/test/verify, platform assets and CI.

Follow the [beginner tutorial](../../docs/getting-started/beginner-todo-app.md), then PostgreSQL and Go API. Core#1666 supersedes the Core-owned runtime/add helper. Its app behavior tests moved to the owning service repository unchanged in intent, with fresh archive consumer and independent managed lifecycle evidence; they are not removed to make a failing runtime pass.
