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
      label: "Service Catalog",
      collapsed: false,
      items: [
        "service-catalog",
      ],
    },
    {
      type: "doc",
      id: "quick-start",
      label: "Quick Start",
    },
    {
      type: "category",
      label: "Service Authoring",
      collapsed: false,
      items: [
        {
          type: "doc",
          id: "service-authoring/overview",
          label: "Overview",
        },
        {
          type: "doc",
          id: "service-authoring/01-plan-service",
          label: "1. Plan the Service",
        },
        {
          type: "doc",
          id: "service-authoring/02-write-service-json",
          label: "2. Write service.json",
        },
        {
          type: "doc",
          id: "service-authoring/03-create-release-repo",
          label: "3. Create the Release Repo",
        },
        {
          type: "doc",
          id: "service-authoring/04-wire-consumers",
          label: "4. Wire Consumers",
        },
        {
          type: "doc",
          id: "service-authoring/05-validate-release",
          label: "5. Validate and Release",
        },
        {
          type: "category",
          label: "References",
          collapsed: true,
          items: [
            "development/new-lasso-service-guide",
            "reference/service-json-reference",
            "reference/SERVICE-CONFIG-TYPES",
            "reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA",
            "development/runtime-provider-release-services-delivery-plan",
          ],
        },
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
        "windows-containment-tiers",
      ],
    },
    {
      type: "doc",
      id: "reference-apps",
      label: "Reference Apps",
    },
  ],
};

module.exports = sidebars;
