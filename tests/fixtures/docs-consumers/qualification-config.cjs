// Loaded only from the runner's private copy of the complete current docs.
const config = require('./docusaurus.config.js');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
assert.equal(require('mini-css-extract-plugin/package.json').version, '2.10.2');
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
            assert.equal(compiler.webpack.version, '5.109.2');
            const CssDependency = MiniCssExtractPlugin.getCssDependency(compiler.webpack);
            const CssModule = MiniCssExtractPlugin.getCssModule(compiler.webpack);
            const stylesheetManifests = new Map();
            const stylesheetEmissions = new Map();
            compilation.hooks.renderManifest.tap({ name: 'qualification-compiler-evidence', stage: 1 },
              (entries, { chunk }) => {
                // This is the actual versioned plugin producer identity, not a guessed filename.
                const stylesheets = entries.filter((entry) =>
                  entry.identifier === `${MiniCssExtractPlugin.pluginName}.${chunk.id}`);
                stylesheetManifests.set(chunk, stylesheets);
                return entries;
              });
            compilation.hooks.chunkAsset.tap('qualification-compiler-evidence', (chunk, filename) => {
              for (const entry of stylesheetManifests.get(chunk) ?? []) {
                const originalFilename = 'filename' in entry ? entry.filename :
                  compilation.getPathWithInfo(entry.filenameTemplate, entry.pathOptions).path;
                if (originalFilename !== filename) continue;
                const asset = compilation.getAsset(filename);
                assert.ok(asset);
                stylesheetEmissions.set(entry, { originalFilename, originalSha256: sha256(asset.source.buffer()),
                  originalAssetInfo: { ...asset.info } });
              }
            });
            compilation.hooks.processAssets.tap({ name: 'qualification-compiler-evidence',
              stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
            if (compilation.errors.length) return;
            const modules = [], cssExtractions = [];
            const extractionRecords = new Map();
            function record(module, inheritedFiles = []) {
              const files = [...new Set([...inheritedFiles,
                ...[...compilation.chunkGraph.getModuleChunksIterable(module)]
                  .flatMap((chunk) => [...chunk.files])])];
              if (module.resource && fs.existsSync(module.resource)) {
                const source = module.originalSource();
                modules.push({ resource: module.resource, identifier: module.identifier(), type: module.type,
                  resourceSha256: sha256(fs.readFileSync(module.resource)),
                  compilerSourceSha256: source ? sha256(source.buffer()) : null,
                  files });
              }
              for (const dependency of module.dependencies ?? []) {
                if (!(dependency instanceof CssDependency)) continue;
                const extracted = compilation.moduleGraph.getModule(dependency);
                assert.ok(extracted instanceof CssModule, 'actual extraction dependency must resolve to its real CssModule');
                let extractedRecord = extractionRecords.get(extracted);
                if (!extractedRecord) {
                  const resource = extracted.nameForCondition();
                  assert.ok(path.isAbsolute(resource) && fs.existsSync(resource), 'extracted CSS must retain its actual original resource');
                  const chunks = [...compilation.chunkGraph.getModuleChunksIterable(extracted)];
                  const stylesheetEdges = [];
                  for (const chunk of chunks) {
                    assert.ok([...compilation.chunkGraph.getChunkModulesIterableBySourceType(chunk, extracted.type)].includes(extracted));
                    for (const entry of stylesheetManifests.get(chunk) ?? []) {
                      assert.equal(entry.pathOptions.contentHashType, extracted.type);
                      assert.equal(entry.pathOptions.chunk, chunk);
                      const emission = stylesheetEmissions.get(entry);
                      assert.ok(emission, 'actual extraction entry must have an original chunkAsset emission');
                      const matches = [...chunk.files].map((filename) => compilation.getAsset(filename)).filter((asset) => {
                        if (!asset) return false;
                        if ('filename' in entry) return entry.filename === asset.name;
                        const contentHash = asset.info.contenthash;
                        if (typeof contentHash !== 'string') return false;
                        // Stock real-content-hash optimization renames files in this actual chunk.
                        // Use its final asset metadata with the compiler's original producer template.
                        return compilation.getPathWithInfo(entry.filenameTemplate, { ...entry.pathOptions, contentHash,
                          contentHashWithLength: (length) => contentHash.slice(0, length) }).path === asset.name;
                      });
                      assert.equal(matches.length, 1, 'actual extraction emission must bind one final same-chunk stylesheet');
                      const asset = matches[0], filename = asset.name;
                      stylesheetEdges.push({ chunkId: chunk.id, moduleIdentifier: extracted.identifier(),
                        manifestIdentifier: entry.identifier, contentHashType: entry.pathOptions.contentHashType,
                        ...emission, filename, assetInfo: asset.info, sha256: sha256(asset.source.buffer()) });
                    }
                  }
                  extractedRecord = { resource, identifier: extracted.identifier(), type: extracted.type,
                    resourceSha256: sha256(fs.readFileSync(resource)),
                    compilerSourceSha256: sha256(extracted.content),
                    files: [...new Set(stylesheetEdges.map((edge) => edge.filename))], stylesheetEdges, origins: [] };
                  extractionRecords.set(extracted, extractedRecord);
                  modules.push(extractedRecord);
                }
                const origin = { sourceResource: module.resource ?? null, sourceIdentifier: module.identifier(),
                  dependencyType: dependency.constructor.name, dependencyResourceIdentifier: dependency.getResourceIdentifier(),
                  extractionModuleIdentifier: extracted.identifier(), extractionResource: extractedRecord.resource };
                extractedRecord.origins.push(origin);
                cssExtractions.push(origin);
              }
              for (const child of module.modules ?? []) record(child, files);
            }
            for (const module of compilation.modules) record(module);
            const assets = compilation.getAssets().map(({ name, source }) =>
              ({ name, sha256: sha256(source.buffer()) }));
            fs.writeFileSync(path.join(__dirname, `qualification-${isServer ? 'server' : 'client'}-modules.json`),
              JSON.stringify({ modules, assets, cssExtractions, extractor: { name: 'mini-css-extract-plugin',
                version: require('mini-css-extract-plugin/package.json').version,
                resolved: require.resolve('mini-css-extract-plugin'), webpackVersion: compiler.webpack.version } }, null, 2));
            });
          });
        } }] };
      },
    };
  }],
};
