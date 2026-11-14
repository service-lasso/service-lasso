// Private clean-environment child. Token is never an argument or public output.
import {mkdir,readFile,writeFile,unlink,access} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import net from 'node:net';
const config=JSON.parse(process.env.SERVICE_LASSO_FIXTURE_CONFIG);delete process.env.SERVICE_LASSO_FIXTURE_CONFIG;
const out=config.out;let observedPort;let server;let initialization;let timer;let closing;let startupFinished;let finishStartup;const requests=[];let writes=Promise.resolve();
startupFinished=new Promise(r=>finishStartup=r);
async function close(reason){if(closing)return closing;closing=(async()=>{clearTimeout(timer);await startupFinished;await initialization?.catch(()=>{});if(server?.listening){const ended=once(server,'close');server.close();server.closeIdleConnections?.();server.closeAllConnections?.();await ended;}await writes;await unlink(path.join(out,'connection.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});delete process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN;let absent=false;try{await access(path.join(out,'connection.json'));}catch(e){if(e.code==='ENOENT')absent=true;else throw e;}let portClosed=true;if(observedPort)portClosed=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:observedPort});socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',e=>resolve(e.code==='ECONNREFUSED'));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});});await writeFile(path.join(out,'worker-cleanup.json'),JSON.stringify({status:absent&&portClosed?'complete':'failed',serverClosed:!server?.listening,portClosed,credentialRemoved:absent,reason}),{mode:0o600});process.stdin.pause();})();return closing;}
function requestStop(reason){void close(reason).catch(()=>{process.exitCode=1;});}
process.stdin.setEncoding('utf8');process.stdin.on('data',b=>{if(b.includes('stop'))requestStop('requested');});process.stdin.once('end',()=>requestStop('stdin-end'));process.once('SIGTERM',()=>requestStop('signal'));process.once('SIGINT',()=>requestStop('signal'));process.stdin.resume();timer=setTimeout(()=>requestStop('deadline'),config.timeout);
try{
 for(const name of ['home','config','cache','tmp','workspace','services','registry'])await mkdir(path.join(out,name),{mode:0o700,recursive:true});
 Object.assign(process.env,{SERVICE_LASSO_WORKSPACE_ROOT:path.join(out,'workspace'),SERVICE_LASSO_SERVICES_ROOT:path.join(out,'services'),SERVICE_LASSO_INSTANCE_REGISTRY_PATH:path.join(out,'registry','instances.json'),SERVICE_LASSO_HOST_PORT_REGISTRY_PATH:path.join(out,'registry','ports.json'),SERVICE_LASSO_LOCAL_ADMIN_TOKEN:randomBytes(32).toString('base64url')});
 const artifact=path.join(config.root,'dist/server/index.js');if(createHash('sha256').update(await readFile(artifact)).digest('hex')!==config.artifactSHA256)throw Error('Artifact changed');
 const core=await import(pathToFileURL(artifact).href);if(closing)throw Error('Stopped before startup');
 server=core.createApiServer({host:'127.0.0.1',workspaceRoot:process.env.SERVICE_LASSO_WORKSPACE_ROOT,servicesRoot:process.env.SERVICE_LASSO_SERVICES_ROOT,autostart:false,monitor:false,updateScheduler:false});
 server.on('request',(request,response)=>{const row={sequence:requests.length+1,method:request.method,pathname:new URL(request.url??'/', 'http://127.0.0.1').pathname,statusCode:null,authHeaderKind:request.headers['x-service-lasso-admin-token']?'local-admin-header':request.headers.authorization?'authorization':'none'};requests.push(row);response.once('finish',()=>{row.statusCode=response.statusCode;const snapshot=JSON.stringify(requests,null,2);writes=writes.then(()=>writeFile(path.join(out,'request-observations.json'),snapshot,{mode:0o600}));});});
 const initializationAPI=typeof core.waitForApiServerInitialization==='function';if(config.sourceBuilt&&!initializationAPI)throw Error('Source build missing owned initialization API');
 initialization=initializationAPI?core.waitForApiServerInitialization(server):Promise.resolve();await initialization;if(closing)throw Error('Stopped during startup');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address!=='object')throw Error('No bound address');observedPort=address.port;const url=`http://127.0.0.1:${address.port}`;
 const observations=[];for(const token of [false,true]){const r=await fetch(url+'/api/runtime/security',{headers:token?{'x-service-lasso-admin-token':process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN}:{},signal:AbortSignal.timeout(5000)});const x=await r.json();observations.push({status:r.status,kind:x.auth?.actor?.kind,authenticated:x.auth?.actor?.authenticated,configured:x.auth?.policy?.localTokenConfigured});}
 if(observations[0].status!==200||observations[0].kind!=='local-root'||observations[1].status!==200||observations[1].kind!=='local-token'||observations[1].authenticated!==true||observations[1].configured!==true)throw Error('Actual local token not admitted');
 await writeFile(path.join(out,'auth-observation.json'),JSON.stringify(observations),{mode:0o600});if(closing)throw Error('Stopped during auth');
 await writeFile(path.join(out,'connection.json'),JSON.stringify({url,token:process.env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN}),{mode:0o600});
 process.stdout.write(JSON.stringify({ready:true,url,initializationAPI})+'\n');
}catch{process.exitCode=1;process.stderr.write('Private Core fixture startup failed.\n');requestStop('startup-failure');}finally{finishStartup();}
