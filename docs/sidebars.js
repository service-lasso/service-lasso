/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    {
      type: "doc",
      id: "README",
      label: "Docs Home",
    },
    {
      type: "doc",
      id: "INTRODUCTION",
      label: "Introduction",
    },
    {
      type: "category",
      label: "Getting Started",
      collapsed: false,
      items: [
        "development/clean-clone-scenario-validation",
        "development/clean-clone-baseline-start-evaluation",
        "development/baseline-service-inventory",
        "development/consumer-project-readiness-task-list",
        "development/release-readiness-validation",
      ],
    },
    {
      type: "category",
      label: "Service Authoring",
      collapsed: false,
      items: [
        "development/new-lasso-service-guide",
        "reference/service-json-reference",
        "reference/SERVICE-CONFIG-TYPES",
        "reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA",
        "development/runtime-provider-release-services-delivery-plan",
        "development/core-provider-services-task-list",
      ],
    },
    {
      type: "category",
      label: "Runtime Design",
      collapsed: true,
      items: [
        "development/core-runtime-layout",
        "development/core-runtime-dev-plan",
        "development/core-runtime-package-architecture",
        "development/core-runtime-release-artifact",
        "development/core-runtime-publishable-package",
        "development/core-runtime-state-model-audit",
        "development/core-runtime-storage-model",
        "development/core-runtime-logging-model",
        "development/core-runtime-migration-plan",
        "development/core-runtime-donor-coverage-audit",
        "development/core-runtime-comprehensive-review",
      ],
    },
    {
      type: "category",
      label: "Operations",
      collapsed: true,
      items: [
        "development/service-update-management-plan",
        "development/service-recovery-doctor-upgrade-hooks-plan",
        "development/serviceadmin-integration-validation",
        "reference/shared-runtime/SERVICE-MANAGER-BEHAVIOR",
        "windows-containment-tiers",
      ],
    },
    {
      type: "category",
      label: "Reference Apps",
      collapsed: true,
      items: [
        "development/reference-app-poc-matrix",
        "development/reference-app-service-distribution-task-list",
        "development/reference-app-and-service-distribution-remediation-plan",
      ],
    },
    {
      type: "category",
      label: "Optional Services",
      collapsed: true,
      items: [
        "development/planned-services-review",
        "development/java-runtime-service-plan",
        "development/zitadel-service-plan",
        "development/dagu-service-plan",
      ],
    },
  ],
};

module.exports = sidebars;
