import React, {useEffect, useMemo, useState} from "react";
import useBaseUrl from "@docusaurus/useBaseUrl";

const catalogDataPath = "/data/service-catalog.json";
const requiredServiceFields = ["id", "name", "repo", "group", "status", "summary"];

const githubUrl = (repo) => `https://github.com/${repo}`;
const readmeUrls = (repo) => [
  `https://raw.githubusercontent.com/${repo}/main/README.md`,
  `https://raw.githubusercontent.com/${repo}/master/README.md`,
];

function GitHubIcon() {
  return (
    <svg
      aria-hidden="true"
      className="serviceCatalog__githubIcon"
      viewBox="0 0 16 16"
      width="20"
      height="20"
      fill="currentColor"
    >
      <path d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.63 5.47 7.7.4.07.55-.18.55-.39 0-.19-.01-.83-.01-1.51-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.15-.28-.15-.68-.52-.01-.53.63-.01 1.08.59 1.23.84.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.2-3.64-.9-3.64-4.01 0-.89.31-1.62.82-2.19-.08-.2-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.43 7.43 0 0 1 8 3.93c.68 0 1.36.09 2 .27 1.53-1.06 2.2-.84 2.2-.84.44 1.12.16 1.96.08 2.16.51.57.82 1.3.82 2.19 0 3.12-1.87 3.81-3.65 4.01.29.25.54.74.54 1.5 0 1.08-.01 1.95-.01 2.22 0 .21.15.47.55.39A8.11 8.11 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z" />
    </svg>
  );
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inCode = false;
  let inList = false;
  let codeLines = [];

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(line);
    if (listItem) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  return html.join("\n");
}

function readmeDocument(service, markdown, sourceUrl) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <base target="_blank" />
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      padding: 24px;
      color: #172026;
      background: #ffffff;
      font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    h1, h2, h3, h4 { color: #0f2f3f; line-height: 1.2; margin: 1.2em 0 0.45em; }
    h1:first-child { margin-top: 0; }
    a { color: #0b6b7b; }
    code {
      padding: 0.12rem 0.28rem;
      border-radius: 5px;
      background: #edf5f5;
      color: #16323a;
    }
    pre {
      overflow: auto;
      padding: 16px;
      border-radius: 12px;
      background: #102027;
      color: #f3fbfb;
    }
    pre code { padding: 0; background: transparent; color: inherit; }
    .source {
      margin: 0 0 18px;
      padding: 12px 14px;
      border: 1px solid #d4e4e2;
      border-radius: 12px;
      background: #f5fbfa;
    }
  </style>
</head>
<body>
  <div class="source">
    Live README loaded from <a href="${escapeHtml(sourceUrl)}">${escapeHtml(service.repo)}</a>.
  </div>
  ${markdownToHtml(markdown)}
</body>
</html>`;
}

function normalizeCatalogServices(catalog) {
  if (!catalog || !Array.isArray(catalog.services)) {
    throw new Error("Service catalog JSON must contain a services array.");
  }

  return catalog.services.map((service, index) => {
    for (const field of requiredServiceFields) {
      if (typeof service[field] !== "string" || !service[field].trim()) {
        throw new Error(`Service catalog entry ${index + 1} is missing ${field}.`);
      }
    }

    return Object.fromEntries(
      requiredServiceFields.map((field) => [field, service[field].trim()]),
    );
  });
}

export default function ServiceCatalog() {
  const catalogUrl = useBaseUrl(catalogDataPath);
  const [catalog, setCatalog] = useState({
    status: "loading",
    services: [],
    error: "",
  });
  const [activeService, setActiveService] = useState(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewer, setViewer] = useState({
    status: "idle",
    srcDoc: "",
    error: "",
  });

  const services = catalog.services;

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalog() {
      setCatalog({status: "loading", services: [], error: ""});

      try {
        const response = await fetch(catalogUrl, {signal: controller.signal});
        if (!response.ok) {
          throw new Error(`Unable to load ${catalogUrl}: ${response.status}`);
        }

        const data = await response.json();
        setCatalog({
          status: "ready",
          services: normalizeCatalogServices(data),
          error: "",
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setCatalog({
          status: "error",
          services: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    loadCatalog();

    return () => controller.abort();
  }, [catalogUrl]);

  const groupOptions = useMemo(() => {
    return Array.from(new Set(services.map((service) => service.group))).sort();
  }, [services]);

  const statusOptions = useMemo(() => {
    return Array.from(new Set(services.map((service) => service.status))).sort();
  }, [services]);

  const filteredServices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return services.filter((service) => {
      const matchesQuery =
        !normalizedQuery ||
        [service.id, service.name, service.repo, service.group, service.status, service.summary]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesGroup = groupFilter === "all" || service.group === groupFilter;
      const matchesStatus = statusFilter === "all" || service.status === statusFilter;
      return matchesQuery && matchesGroup && matchesStatus;
    });
  }, [groupFilter, query, services, statusFilter]);

  async function openReadme(service) {
    setActiveService(service);
    setViewer({status: "loading", srcDoc: "", error: ""});

    for (const url of readmeUrls(service.repo)) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          continue;
        }
        const markdown = await response.text();
        setViewer({
          status: "ready",
          srcDoc: readmeDocument(service, markdown, url),
          error: "",
        });
        return;
      } catch (error) {
        setViewer({
          status: "error",
          srcDoc: "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    setViewer({
      status: "error",
      srcDoc: "",
      error: `No README.md could be loaded from ${service.repo}.`,
    });
  }

  return (
    <div className="serviceCatalog">
      <div className="serviceCatalog__intro">
        <p>
          This catalog points to the canonical service, provider, and reference
          app repos. Filter the table by service, repo, group, or status, then
          use the README action to load the live upstream README in-page without
          copying that content into the Service Lasso docs repo.
        </p>
        <p>
          Catalog rows are loaded from <code>{catalogDataPath}</code>, so updates
          only require changing the JSON data file.
        </p>
      </div>

      <section className="serviceCatalog__tableShell">
        <div className="serviceCatalog__toolbar" aria-label="Service catalog filters">
          <label className="serviceCatalog__search">
            <span>Search services</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by service, repo, or summary..."
            />
          </label>

          <label>
            <span>Group</span>
            <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
              <option value="all">All groups</option>
              {groupOptions.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="serviceCatalog__reset"
            onClick={() => {
              setQuery("");
              setGroupFilter("all");
              setStatusFilter("all");
            }}
          >
            Reset
          </button>
        </div>

        <div className="serviceCatalog__tableMeta">
          {catalog.status === "ready"
            ? `Showing ${filteredServices.length} of ${services.length} services`
            : null}
          {catalog.status === "loading" ? "Loading catalog data..." : null}
          {catalog.status === "error" ? "Catalog data failed to load" : null}
        </div>

        <div className="serviceCatalog__tableScroller">
          {catalog.status === "loading" ? (
            <div className="serviceCatalog__empty">Loading service catalog...</div>
          ) : null}

          {catalog.status === "error" ? (
            <div className="serviceCatalog__error">{catalog.error}</div>
          ) : null}

          {catalog.status === "ready" ? (
            <table className="serviceCatalog__table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Group</th>
                  <th scope="col">Status</th>
                  <th scope="col">Repository</th>
                  <th scope="col">Summary</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredServices.map((service) => (
                  <tr key={service.id}>
                    <th scope="row">
                      <span className="serviceCatalog__serviceId">{service.id}</span>
                      <span className="serviceCatalog__serviceName">{service.name}</span>
                    </th>
                    <td>{service.group}</td>
                    <td>
                      <span className="serviceCatalog__status">{service.status}</span>
                    </td>
                    <td>
                      <a href={githubUrl(service.repo)} target="_blank" rel="noreferrer">
                        {service.repo}
                      </a>
                    </td>
                    <td>{service.summary}</td>
                    <td>
                      <div className="serviceCatalog__actions">
                        <a
                          className="serviceCatalog__actionButton"
                          href={githubUrl(service.repo)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${service.repo} on GitHub`}
                          title="Open GitHub repo"
                        >
                          <GitHubIcon />
                        </a>
                        <button
                          type="button"
                          className="serviceCatalog__actionButton"
                          onClick={() => openReadme(service)}
                        >
                          Readme
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {catalog.status === "ready" && filteredServices.length === 0 ? (
            <div className="serviceCatalog__noResults">
              No services match the current filters.
            </div>
          ) : null}
        </div>
      </section>

      <section className="serviceCatalog__viewer" aria-live="polite">
        <div className="serviceCatalog__viewerHeader">
          <div>
            <h2>README Viewer</h2>
            <p>
              {activeService
                ? `${activeService.id} from ${activeService.repo}`
                : "Choose a service README to preview it here."}
            </p>
          </div>
          {activeService ? (
            <a href={githubUrl(activeService.repo)} target="_blank" rel="noreferrer">
              Open on GitHub
            </a>
          ) : null}
        </div>

        {viewer.status === "idle" ? (
          <div className="serviceCatalog__empty">No README selected yet.</div>
        ) : null}
        {viewer.status === "loading" ? (
          <div className="serviceCatalog__empty">Loading live README...</div>
        ) : null}
        {viewer.status === "error" ? (
          <div className="serviceCatalog__error">{viewer.error}</div>
        ) : null}
        {viewer.status === "ready" ? (
          <iframe
            className="serviceCatalog__iframe"
            title={`${activeService.id} README`}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={viewer.srcDoc}
          />
        ) : null}
      </section>
    </div>
  );
}
