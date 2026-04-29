const path = require("node:path");
const { themes: prismThemes } = require("prism-react-renderer");

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Service Lasso Docs",
  tagline: "Runtime, services, manifests, and release-backed local orchestration.",
  url: "https://service-lasso.github.io",
  baseUrl: "/service-lasso/",
  organizationName: "service-lasso",
  projectName: "service-lasso",
  trailingSlash: false,
  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  presets: [
    [
      "classic",
      {
        docs: {
          path: ".",
          routeBasePath: "/",
          sidebarPath: path.join(__dirname, "sidebars.js"),
          exclude: ["build/**", ".docusaurus/**", "node_modules/**", "src/**"],
          editUrl: "https://github.com/service-lasso/service-lasso/tree/main/docs/",
        },
        blog: false,
        theme: {
          customCss: path.join(__dirname, "src/css/custom.css"),
        },
      },
    ],
  ],
  plugins: [
    function resolveWeakCompatibilityPlugin() {
      return {
        name: "resolve-weak-compatibility",
        configureWebpack() {
          return {
            module: {
              rules: [
                // Docusaurus currently emits require.resolveWeak in generated files.
                // This repo's root ESM package setup needs the generated SSR bundle to
                // treat those references as plain module ids during static builds.
                {
                  test: /(?:[\\/]docs[\\/]\.docusaurus[\\/]registry\.js|[\\/]@docusaurus[\\/]core[\\/]lib[\\/]client[\\/]exports[\\/]ComponentCreator\.js)$/,
                  enforce: "pre",
                  use: [path.join(__dirname, "loaders/replace-resolve-weak.cjs")],
                },
                {
                  test: /(?:[\\/]docs[\\/]\.docusaurus[\\/].*\.js|[\\/]@docusaurus[\\/]core[\\/]lib[\\/]client[\\/]exports[\\/]ComponentCreator\.js)$/,
                  type: "javascript/auto",
                },
              ],
            },
          };
        },
      };
    },
  ],
  themeConfig: {
    navbar: {
      title: "Service Lasso",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          to: "/service-catalog",
          label: "Service Catalog",
          position: "left",
        },
        {
          href: "https://github.com/service-lasso/service-lasso",
          label: "GitHub",
          position: "right",
        },
        {
          href: "https://www.npmjs.com/package/@service-lasso/service-lasso",
          label: "npm",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Start",
          items: [
            {
              label: "Docs Home",
              to: "/",
            },
            {
              label: "Service Authoring",
              to: "/service-authoring/overview",
            },
          ],
        },
        {
          title: "Reference",
          items: [
            {
              label: "service.json",
              to: "/reference/service-json-reference",
            },
          ],
        },
        {
          title: "Project",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/service-lasso/service-lasso",
            },
            {
              label: "npm",
              href: "https://www.npmjs.com/package/@service-lasso/service-lasso",
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Service Lasso.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  },
};

module.exports = config;
