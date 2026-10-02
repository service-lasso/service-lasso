# PR #1551 Windows packaged-browser failure custody

- Candidate: `5115a14acf157e26e8d4e9d538735f90dda353a9`
- Run/job: `36785227669` / `110124923276` (`packaged-admin-lifecycle (win32)`)
- Raw job log: `core1551-5115-windows-browser-failure.raw.log`
  - SHA-256: `8914e98777b1587500118bc563238fd17bfc3b49d1fe3bc138941de1fe2becac`
- Provider artifact index: `core1551-5115-windows-browser-artifacts.json`
  - SHA-256: `677aba928ce39fd527810b507ab7ec955c62ea50c486cf98a86670641a3fc5d7`
- Downloaded Windows metadata artifact: `windows-artifact/packaged-admin-lifecycle-win32.json`
  - SHA-256: `9b23e9176beee76e41818d42e1a2381a17cfe0bdfdaa9e9518f543ab09999dc3`
  - Provider ZIP digest: `sha256:57795c0a55fd471988a3677c94f8fc381011c4c513237d0b18db361e5b8918aa`

The observed failure is the packaged Service Admin browser harness assertion
`expected undefined to equal 200` at
`service-lasso/lasso-serviceadmin/cypress/e2e/secrets-broker/real-lifecycle.cy.js:137`.
The retained Core-side diagnostic records four `200` transport statuses and
`rollback_rehydrated` before the Cypress failure. No failure output identifies
an update HTTP route, update provider request, or Core `#1538` source path.

Classification: preserve this as a separate packaged Admin/Broker browser
qualification blocker. Do not attribute it to #1538 or alter browser contracts
without a concrete update-HTTP source link. No rerun was performed.
