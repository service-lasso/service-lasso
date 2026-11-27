import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { startApiServer } from '../dist/server/index.js';
import { makeTempServicesRoot, writeManifest, ensureTestSecretsBrokerReady } from './test-helpers.js';
import { writeLocalOperatorAuthState, acknowledgeLocalOperatorFirstRun } from '../dist/runtime/auth/local-auth-store.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { chmod, lstat, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { startLocalTuiSessionServer, requestLocalTuiSession, verifyLocalTuiSession } from '../dist/runtime/auth/local-tui-session.js';

const binding = () => ({ workspaceRoot:'/fixture/workspace', servicesRoot:'/fixture/services', generationId:randomUUID(), origin:'http://127.0.0.1:12345' });
const request = (remoteAddress='127.0.0.1', headers={}) => ({ socket:{remoteAddress}, headers });
const socketPath = b => `/tmp/service-lasso-tui-${process.getuid()}-${createHash('sha256').update(JSON.stringify(b)).digest('hex').slice(0,32)}/session.sock`;

test('AC-2001 OS-private socket gates mint and binds lifetime/workspace/generation/local transport', {skip:process.platform!=='linux'}, async () => {
  const b = binding(); let ready=false;
  const server = await startLocalTuiSessionServer(b,async()=>ready);
  try {
    await assert.rejects(requestLocalTuiSession(b));
    ready=true;
    const token = await requestLocalTuiSession(b);
    assert.equal(verifyLocalTuiSession(b,token,request()),true);
    assert.equal(verifyLocalTuiSession({...b,generationId:randomUUID()},token,request()),false);
    assert.equal(verifyLocalTuiSession({...b,workspaceRoot:'/other'},token,request()),false);
    assert.equal(verifyLocalTuiSession(b,token,request('192.0.2.5')),false);
    for (const headers of [{'x-forwarded-for':'127.0.0.1'},{forwarded:'for=127.0.0.1'},{'x-service-lasso-trusted-ingress':'serviceadmin-loopback'}]) {
      assert.equal(verifyLocalTuiSession(b,token,request('127.0.0.1',headers)),false);
    }
    const socket=socketPath(b);const directory=socket.slice(0,socket.lastIndexOf('/'));
    assert.equal((await lstat(socket)).mode&0o777,0o600);
    assert.equal((await lstat(directory)).mode&0o777,0o700);
    await chmod(socket,0o666);
    await assert.rejects(requestLocalTuiSession(b));
    await chmod(socket,0o600);
    await chmod(directory,0o755);
    await assert.rejects(requestLocalTuiSession(b));
    await chmod(directory,0o700);
    const originalGetuid=process.getuid;
    process.getuid=()=>originalGetuid()+1;
    try { await assert.rejects(requestLocalTuiSession(b)); } finally { process.getuid=originalGetuid; }
    await assert.rejects(startLocalTuiSessionServer(b,async()=>true));
    const now=Date.now;Date.now=()=>now()+13*60*60*1000;
    try {assert.equal(verifyLocalTuiSession(b,token,request()),false);} finally {Date.now=now;}
    const revoked = await requestLocalTuiSession(b);
    await server.close();
    assert.equal(verifyLocalTuiSession(b,revoked,request()),false);
    await assert.rejects(requestLocalTuiSession(b));
  } finally {await server.close();}
});

test('AC-2001 socket rejects oversized/mismatched input without credential response', {skip:process.platform!=='linux'}, async()=>{
  const b=binding();const server=await startLocalTuiSessionServer(b,async()=>true);
  try {
    for(const payload of ['x'.repeat(3000),JSON.stringify({...b,origin:'http://127.0.0.1:9999'})+'\n']) {
      const output=await new Promise((resolve,reject)=>{
        const client=createConnection(socketPath(b));let data='';client.on('connect',()=>client.write(payload));
        client.on('data',chunk=>data+=chunk);client.on('close',()=>resolve(data));client.on('error',reject);
      });
      assert.ok(!output.includes('token'));
    }
  } finally {await server.close();}
});

// Controlled Broker fixture exercises production readiness/ack reads; it is not
// native encrypted Broker qualification or published-TUI evidence.
test('AC-2001 installed TUI receives local session only after setup+ack, explicit credentials stay authoritative', {skip:process.platform!=='linux'},async(t)=>{
  const {tempRoot,servicesRoot,workspaceRoot}=await makeTempServicesRoot('core2001-');
  const fixture=path.join(tempRoot,'fixture');await mkdir(fixture);
  await writeFile(path.join(fixture,'client'),`#!/usr/bin/env node
    const token=process.env.SERVICE_LASSO_API_TOKEN;
    const origin=process.env.SERVICE_LASSO_API_URL;
    const auth=token && origin && !process.argv.includes('--explicit') ? await (await fetch(origin+'/api/runtime/security',{headers:{authorization:'Bearer '+token}})).json() : null;
    console.log(JSON.stringify({credential:Boolean(token),actor:auth?.auth?.actor?.kind??null,args:process.argv.slice(2)}));
  `);
  await chmod(path.join(fixture,'client'),0o700);
  const archivePath=path.join(tempRoot,'client.tar.gz');assert.equal(spawnSync('tar',['-czf',archivePath,'-C',fixture,'client']).status,0);
  const archive=await readFile(archivePath);const sha=createHash('sha256').update(archive).digest('hex');
  const {createServer}=await import('node:http');const download=createServer((_req,res)=>res.end(archive));
  await new Promise(resolve=>download.listen(0,'127.0.0.1',resolve));
  const environment={SERVICE_LASSO_SERVICES_ROOT:servicesRoot,SERVICE_LASSO_WORKSPACE_ROOT:workspaceRoot,
    SERVICE_LASSO_INSTANCE_REGISTRY_PATH:path.join(tempRoot,'instances.json'),SERVICE_LASSO_HOST_PORT_REGISTRY_PATH:path.join(tempRoot,'ports.json')};
  for(const [name,value] of Object.entries(environment)){const prior=process.env[name];process.env[name]=value;t.after(()=>{if(prior===undefined)delete process.env[name];else process.env[name]=prior;});}
  let runtime;
  try{
    await writeManifest(servicesRoot,'@tui',{id:'@tui',name:'TUI fixture',description:'Local TUI fixture',role:'provider',artifact:{kind:'archive',source:{type:'github-release',repo:'service-lasso/service-lasso-tui',tag:'fixture-2001'},platforms:{[process.platform+'-'+process.arch]:{archiveType:'tar.gz',assetName:'client.tar.gz',assetUrl:'http://127.0.0.1:'+download.address().port+'/client.tar.gz',sha256:sha,command:'./client'}}}});
    runtime=await startApiServer({port:0,servicesRoot,workspaceRoot,baselineBootstrap:{serviceIds:['@tui']}});
    const launch=async(args=[],extra={})=>await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.resolve('dist/cli.js'),'tui',...args],{env:{PATH:process.env.PATH,...environment,...extra},stdio:['ignore','pipe','pipe']});
      let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);
      child.once('close',code=>{try{assert.equal(code,0,err);resolve(JSON.parse(out));}catch(error){reject(error);}});
    });
    assert.equal((await launch()).credential,false);
    await ensureTestSecretsBrokerReady(workspaceRoot);
    await writeLocalOperatorAuthState(workspaceRoot,{token:'fixture-long-lived-not-transferred',password:'fixture-password',credentialsAcknowledged:false});
    assert.equal((await launch()).credential,false);
    await acknowledgeLocalOperatorFirstRun(workspaceRoot);
    const accepted=await launch(['literal argument']);
    assert.equal(accepted.credential,true);assert.equal(accepted.actor,'local-token');assert.deepEqual(accepted.args,['literal argument']);
    assert.equal(process.env.SERVICE_LASSO_API_TOKEN,undefined);
    assert.equal((await launch(['--token-env','CUSTOM_TOKEN','--explicit'])).credential,false);
    assert.equal((await launch(['--api','https://remote.example'])).credential,false);
    assert.equal((await launch(['--profile','work'])).credential,false);
    assert.equal((await launch(['--explicit'],{SERVICE_LASSO_API_TOKEN:'explicit-kept'})).credential,true);
    const authFile=await readFile(path.join(workspaceRoot,'.service-lasso/local-operator-auth.json'),'utf8');
    assert.ok(!authFile.includes('fixture-long-lived-not-transferred'));
  }finally{await runtime?.stop();await new Promise(resolve=>download.close(resolve));await rm(tempRoot,{recursive:true,force:true});}
});
