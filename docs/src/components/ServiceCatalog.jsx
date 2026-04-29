import React, {useMemo, useState} from "react";

const services = [
  {
    id: "@node",
    name: "Node Runtime Provider",
    repo: "service-lasso/lasso-node",
    group: "Baseline Core",
    status: "Available",
    summary:
      "Release-backed Node provider used by the baseline and by services that execute through execservice.",
  },
  {
    id: "@localcert",
    name: "Local Certificate Provider",
    repo: "service-lasso/lasso-localcert",
    group: "Baseline Core",
    status: "Available",
    summary:
      "Core certificate utility used by the Traefik baseline to produce local certificate outputs.",
  },
  {
    id: "@nginx",
    name: "NGINX Service",
    repo: "service-lasso/lasso-nginx",
    group: "Baseline Core",
    status: "Available",
    summary:
      "Managed NGINX Open Source service started before Traefik in the default baseline.",
  },
  {
    id: "@traefik",
    name: "Traefik Edge Router",
    repo: "service-lasso/lasso-traefik",
    group: "Baseline Core",
    status: "Available",
    summary:
      "Release-backed edge/router service with local certificate and NGINX dependencies.",
  },
  {
    id: "echo-service",
    name: "Echo Service",
    repo: "service-lasso/lasso-echoservice",
    group: "Baseline Core",
    status: "Available",
    summary:
      "Harness service for lifecycle, UI/API, health, logs, state, SQLite, and failure testing.",
  },
  {
    id: "@serviceadmin",
    name: "Service Admin",
    repo: "service-lasso/lasso-serviceadmin",
    group: "Baseline Core",
    status: "Available",
    summary:
      "Browser-based operator UI served as a managed Service Lasso service.",
  },
  {
    id: "@python",
    name: "Python Runtime Provider",
    repo: "service-lasso/lasso-python",
    group: "Runtime Providers",
    status: "Available",
    summary:
      "Release-backed Python provider for consumers that need Python-backed local services.",
  },
  {
    id: "@java",
    name: "Java Runtime Provider",
    repo: "service-lasso/lasso-java",
    group: "Runtime Providers",
    status: "Available",
    summary:
      "Release-backed Java provider for consumers that need Java-backed local services.",
  },
  {
    id: "zitadel",
    name: "ZITADEL",
    repo: "service-lasso/lasso-zitadel",
    group: "App-Owned Services",
    status: "Available",
    summary:
      "Release-backed identity service for apps that own the required database, domain, and secret configuration.",
  },
  {
    id: "dagu",
    name: "Dagu",
    repo: "service-lasso/lasso-dagu",
    group: "App-Owned Services",
    status: "Available",
    summary:
      "Release-backed workflow service for apps that own their workflow definitions and orchestration contract.",
  },
];

const githubUrl = (repo) => `https://github.com/${repo}`;
const readmeUrls = (repo) => [
  `https://raw.githubusercontent.com/${repo}/main/README.md`,
  `https://raw.githubusercontent.com/${repo}/master/README.md`,
];

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

export default function ServiceCatalog() {
  const [activeService, setActiveService] = useState(null);
  const [viewer, setViewer] = useState({
    status: "idle",
    srcDoc: "",
    error: "",
  });

  const groupedServices = useMemo(() => {
    return services.reduce((groups, service) => {
      groups[service.group] = groups[service.group] || [];
      groups[service.group].push(service);
      return groups;
    }, {});
  }, []);

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
          This catalog points to the canonical service repos. Use the README button
          to load the live upstream README in-page without copying that content
          into the Service Lasso docs repo.
        </p>
      </div>

      {Object.entries(groupedServices).map(([group, entries]) => (
        <section className="serviceCatalog__group" key={group}>
          <h2>{group}</h2>
          <div className="serviceCatalog__grid">
            {entries.map((service) => (
              <article className="serviceCatalog__card" key={service.id}>
                <div className="serviceCatalog__cardHeader">
                  <div>
                    <h3>{service.id}</h3>
                    <p>{service.name}</p>
                  </div>
                  <span>{service.status}</span>
                </div>
                <p>{service.summary}</p>
                <div className="serviceCatalog__actions">
                  <a href={githubUrl(service.repo)} target="_blank" rel="noreferrer">
                    Open repo
                  </a>
                  <button type="button" onClick={() => openReadme(service)}>
                    Read README
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

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
