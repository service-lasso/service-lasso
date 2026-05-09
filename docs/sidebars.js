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
      type: "doc",
      id: "service-catalog",
      label: "Service Catalog",
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
          type: "doc",
          id: "reference/service-json-reference",
          label: "service.json Reference",
        },
        {
          type: "doc",
          id: "reference/one-shot-jobs",
          label: "One-shot Jobs",
        },
        {
          type: "doc",
          id: "reference/startup-broker-resolution",
          label: "Startup Broker Resolution",
        },
        {
          type: "doc",
          id: "reference/legacy-globalenv-migration",
          label: "Legacy globalenv Migration",
        },
        {
          type: "doc",
          id: "reference/secret-leak-regression-harness",
          label: "Secret Leak Regression Harness",
        },
        {
          type: "doc",
          id: "reference/traefik-local-route-generation",
          label: "Traefik Local Route Generation",
        },
        {
          type: "doc",
          id: "reference/local-sso-loop-smoke",
          label: "Local SSO Loop Smoke",
        },
        {
          type: "doc",
          id: "reference/zitadel-consumer-integration",
          label: "ZITADEL Consumer Integration",
        },
        {
          type: "doc",
          id: "development/new-lasso-service-guide",
          label: "Service Repo Handoff",
        },
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
