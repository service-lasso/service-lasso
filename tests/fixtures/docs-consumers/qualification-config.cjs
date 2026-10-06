// Loaded only from the runner's private copy of the complete current docs.
const config = require('./docusaurus.config.js');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

module.exports = {
  ...config,
  future: {
    ...config.future,
    v4: { ...config.future?.v4, removeLegacyPostBuildHeadAttribute: true },
    faster: { ...config.future?.faster, ssgWorkerThreads: true },
  },
  plugins: [...config.plugins, function qualificationCompilerEvidence() {
    return {
      name: 'qualification-compiler-evidence',
      configureWebpack(_config, isServer) {
        return { plugins: [{ apply(compiler) {
          compiler.hooks.thisCompilation.tap('qualification-compiler-evidence', (compilation) => {
            compilation.hooks.processAssets.tap({ name: 'qualification-compiler-evidence',
              stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
            if (compilation.errors.length) return;
            const modules = [];
            function record(module, inheritedFiles = []) {
              const files = [...new Set([...inheritedFiles,
                ...[...compilation.chunkGraph.getModuleChunksIterable(module)]
                  .flatMap((chunk) => [...chunk.files])])];
              if (module.resource && fs.existsSync(module.resource)) {
                const source = module.originalSource();
                modules.push({ resource: module.resource,
                  resourceSha256: sha256(fs.readFileSync(module.resource)),
                  compilerSourceSha256: source ? sha256(source.buffer()) : null,
                  files });
              }
              for (const child of module.modules ?? []) record(child, files);
            }
            for (const module of compilation.modules) record(module);
            const assets = compilation.getAssets().map(({ name, source }) =>
              ({ name, sha256: sha256(source.buffer()) }));
            fs.writeFileSync(path.join(__dirname, `qualification-${isServer ? 'server' : 'client'}-modules.json`),
              JSON.stringify({ modules, assets }, null, 2));
            });
          });
        } }] };
      },
    };
  }],
};
