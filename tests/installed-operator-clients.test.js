import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { startApiServer } from '../dist/server/index.js';
import { makeTempServicesRoot, writeManifest } from './test-helpers.js';

test('AC-1994 installed provider archives attach to the owning instance and retain caller IO', {
  skip: process.platform === 'win32' && 'POSIX executable and PTY fixture',
}, async (t) => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot('lasso-installed-client-');
  const fixturePath = path.join(tempRoot, 'fixture');
  await mkdir(fixturePath);
  const home = path.join(tempRoot, 'home');
  await mkdir(path.join(home, '.service-lasso-cli'), { recursive: true });
  const executable = path.join(fixturePath, 'fixture-client');
  await writeFile(executable, '#!/usr/bin/env node\n' + `
    import { readFileSync } from 'node:fs';
    console.log(JSON.stringify({
      args:process.argv.slice(2), cwd:process.cwd(),
      cli:process.env.SERVICE_LASSO_CORE_URL??null, tui:process.env.SERVICE_LASSO_API_URL??null,
      tty:Boolean(process.stdin.isTTY && process.stdout.isTTY),
      input:process.argv.includes('read-stdin') ? readFileSync(0,'utf8').trim() : null,
    }));
    process.exit(23);
  `);
  await chmod(executable, 0o700);
  const file = path.join(tempRoot, 'client.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', file, '-C', fixturePath, 'fixture-client']).status, 0);
  const archive = await readFile(file);
  const sha = createHash('sha256').update(archive).digest('hex');
  const download = createServer((_request, response) => response.end(archive));
  await new Promise(resolve => download.listen(0, '127.0.0.1', resolve));
  const installs = [['@tui', 'service-lasso-tui'], ['@cli', 'service-lasso-cli']];
  const coreEnvironment = {
    SERVICE_LASSO_SERVICES_ROOT: servicesRoot,
    SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
    SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(tempRoot, 'instances.json'),
    SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(tempRoot, 'ports.json'),
  };
  for (const [name, value] of Object.entries(coreEnvironment)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const assetUrl = `http://127.0.0.1:${download.address().port}/client.tar.gz`;
  let runtime;
  try {
    for (const [id, repository] of installs) {
      await writeManifest(servicesRoot, id, {
        id, name: id, description: 'installed client proof', role: 'provider', version: '1.0.0',
        artifact: {
          kind: 'archive', source: { type:'github-release', repo: 'service-lasso/'+repository, tag:'candidate-proof' },
          platforms: {
            [`${process.platform}-${process.arch}`]: {
              assetName: 'client.tar.gz', assetUrl, archiveType: 'tar.gz', sha256: sha, command: './fixture-client',
            },
          },
        },
      });
    }
    runtime = await startApiServer({
      port:0, servicesRoot, workspaceRoot, baselineBootstrap:{serviceIds:installs.map(([id])=>id)},
    });
    assert.deepEqual(runtime.baselineBootstrap.services.map(row=>row.state.running), [false,false]);
    const env = { PATH:process.env.PATH, HOME:home, ...coreEnvironment };
    const cli = path.resolve('dist/cli.js');
    const launch = (args, extraEnv, input) =>
      spawnSync(process.execPath,[cli,...args],{cwd:fixturePath, env:{...env,...extraEnv}, input, encoding:'utf8', timeout:10000});
    const success = (result) => {
      assert.equal(result.status,23,result.stderr);
      return JSON.parse(result.stdout);
    };
    const origin = new URL(runtime.url).origin;
    const actual = success(launch(['cli','operator','services','read-stdin','a b','$(literal)'],{},'stdin proof'));
    assert.equal(actual.cli,origin);
    assert.deepEqual(actual.args, ['operator','services','read-stdin','a b','$(literal)']);
    assert.equal(actual.cwd,fixturePath);
    assert.equal(actual.input,'stdin proof');
    const tui = success(launch(['tui']));
    assert.equal(tui.tui,origin);
    assert.deepEqual(tui.args,[]);
    assert.equal(success(launch(['tui','--api=https://remote.example'])).tui,null);
    assert.equal(success(launch(['tui','--profile','work'])).tui,null);
    assert.equal(success(launch(['cli','--connection','work','instance','status'])).cli,null);
    assert.equal(success(launch(['cli','service','init','app','--dry-run'])).cli,null);
    const other = {SERVICE_LASSO_WORKSPACE_ROOT:path.join(tempRoot,'other')};
    assert.deepEqual(success(launch(['tui'],other)).args,['--connect']);
    assert.match(launch(['cli','instance','status'],other).stderr,/No running Core found/);

    const configFile = path.join(home,'.service-lasso-cli','config.json');
    for (const saved of [
      {coreUrl:'https://saved.example'},
      {defaultConnection:'work',connections:{work:{coreUrl:'https://remote.example'}}},
    ]) {
      await writeFile(configFile,JSON.stringify(saved));
      assert.equal(success(launch(['cli','operator','services'])).cli,null);
      assert.equal(success(launch(['cli','operator','services'],other)).cli,null);
    }
    await writeFile(configFile,'{}');
    assert.equal(success(launch(['cli','operator','services'])).cli,origin);


    if (process.platform === 'linux') {
      const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
      const command = `${quote(process.execPath)} ${quote(cli)} tui`;
      const pty = spawnSync('script',['-q','-e','-f','-c',command,'/dev/null'],{
        cwd:fixturePath, env, encoding:'utf8', timeout:10000,
      });
      assert.equal(pty.status,23,pty.stderr);
      assert.equal(JSON.parse(pty.stdout).tty,true);
    }

    const installPath = path.join(servicesRoot,'@tui','.state/install.json');
    const original = await readFile(installPath);
    const receipt = JSON.parse(original);
    receipt.artifact.checksum.actual = '0'.repeat(64);
    await writeFile(installPath,JSON.stringify(receipt));
    const mismatch=launch(['tui']);
    assert.equal(mismatch.status,1);
    assert.match(mismatch.stderr,/not prepared from its pinned release/);
    await writeFile(installPath,original);
    const installed = path.resolve(servicesRoot,'@tui',receipt.artifact.extractedPath,receipt.artifact.command);
    await rm(installed);
    await symlink(executable,installed);
    const escaped=launch(['tui']);
    assert.equal(escaped.status,1);
    assert.match(escaped.stderr,/not prepared from its pinned release/);
  } finally {
    await runtime?.stop();
    await new Promise(resolve => download.close(resolve));
    await rm(tempRoot,{recursive:true,force:true});
  }
});
