const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApps } = require('../server');
const token = 'w'.repeat(40);
async function setup(t, extra={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp3-api-')); let time=Date.now();
 const opts={dataDir:dir,enabledPlatforms:['youtube'],workerTokens:{one:token,two:'x'.repeat(40),three:'y'.repeat(40)},workerAssignments:{one:['youtube'],two:['youtube'],three:['youtube']},now:()=>time,trustProxy:'loopback',...extra};
 let service=createApps(opts); const pub=service.publicApp.listen(0,'127.0.0.1'); const internal=service.internalApp.listen(0,'127.0.0.1');
 await Promise.all([new Promise(r=>pub.once('listening',r)),new Promise(r=>internal.once('listening',r))]);
 t.after(async()=>{service.close();await Promise.all([new Promise(r=>pub.close(r)),new Promise(r=>internal.close(r))]);fs.rmSync(dir,{recursive:true,force:true});});
 const request=async(route,body,auth,ip='1.2.3.4',priv=false)=>{const response=await fetch(`http://127.0.0.1:${(priv?internal:pub).address().port}${route}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':ip,...(auth?{Authorization:`Bearer ${auth}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const worker=(route,body,id='one')=>request(route,{workerId:id,...body},opts.workerTokens[id],undefined,true);
 await worker('/internal/heartbeat',{platforms:['youtube'],versions:{}});
 return {service,opts,dir,pub,internal,request,worker,advance(ms){time+=ms;service.sweep();}};
}
const url='https://youtu.be/dQw4w9WgXcQ';
test('durable job credentials, lease, upload, repeat download and SSE snapshot',async t=>{
 const s=await setup(t);const created=await s.request('/api/jobs',{url});assert.equal(created.status,202);const {id,token:client}=created.body;
 assert.equal((await s.request(`/api/jobs/${id}`)).status,404);
 assert.equal((await s.request('/api/jobs',{url})).status,429);
 const claim=(await s.worker('/internal/claim',{})).body.job;assert.equal(claim.id,id);assert.equal(claim.url,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 assert.equal((await s.worker(`/internal/jobs/${id}/progress`,{leaseToken:'bad',state:'downloading'})).status,409);
 await s.worker(`/internal/jobs/${id}/progress`,{leaseToken:claim.leaseToken,state:'downloading',percent:40,title:'Track'});
 const status=(await s.request(`/api/jobs/${id}`,undefined,client)).body;assert.equal(status.state,'downloading');assert.equal(status.percent,40);assert.equal(status.url,undefined);
 const upload=await fetch(`http://127.0.0.1:${s.internal.address().port}/internal/jobs/${id}/result`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-Worker-Id':'one','X-Lease-Token':claim.leaseToken,'Content-Type':'audio/mpeg'},body:Buffer.from([0xff,0xfb,0x90,0x64,...Array(500).fill(0)])});assert.equal(upload.status,200);
 for(let i=0;i<2;i++){const file=await fetch(`http://127.0.0.1:${s.pub.address().port}/api/jobs/${id}/file?token=${client}`);assert.equal(file.status,200);assert.equal((await file.arrayBuffer()).byteLength,504);}
 const events=await fetch(`http://127.0.0.1:${s.pub.address().port}/api/jobs/${id}/events?token=${client}`);assert.match(await events.text(),/"state":"ready"/);
 assert.ok(!fs.readFileSync(path.join(s.dir,'jobs.sqlite')).includes(Buffer.from(client)));
 s.advance(3600001);assert.equal((await s.request(`/api/jobs/${id}`,undefined,client)).status,404);
});
test('capacity, worker identity and assignments enforced',async t=>{
 const s=await setup(t);for(const id of ['two','three'])await s.worker('/internal/heartbeat',{platforms:['youtube']},id);
 for(let i=0;i<10;i++)assert.equal((await s.request('/api/jobs',{url},null,`1.2.3.${i}`)).status,202);
 assert.equal((await s.request('/api/jobs',{url},null,'1.2.4.1')).status,429);
 assert.ok((await s.worker('/internal/claim',{})).body.job);assert.equal((await s.worker('/internal/claim',{})).body.job,null);
 assert.ok((await s.worker('/internal/claim',{},'two')).body.job);assert.equal((await s.worker('/internal/claim',{},'three')).body.job,null);
 assert.equal((await s.request('/internal/heartbeat',{workerId:'two',platforms:['youtube']},token,undefined,true)).status,403);
});
test('cancellation, heartbeat loss, queue expiry and persisted admission quota',async t=>{
 const s=await setup(t);let created;
 for(let i=0;i<5;i++){created=(await s.request('/api/jobs',{url})).body;assert.ok(created.id);await s.request(`/api/jobs/${created.id}/cancel`,{},created.token);}
 assert.equal((await s.request('/api/jobs',{url})).status,429);
 const other=(await s.request('/api/jobs',{url},null,'2.2.2.2')).body;await s.worker('/internal/claim',{});s.advance(35001);
 assert.equal((await s.request(`/api/jobs/${other.id}`,undefined,other.token)).body.state,'failed');
 s.service.close();const restarted=createApps(s.opts);assert.equal(restarted.store.admit('1.2.3.4','youtube',url).error,429);restarted.close();
});
test('platforms fail closed and block circuit survives restart',async t=>{
 const s=await setup(t);for(let i=0;i<3;i++){const j=(await s.request('/api/jobs',{url},null,`3.3.3.${i}`)).body;const claim=(await s.worker('/internal/claim',{})).body.job;await s.worker(`/internal/jobs/${j.id}/fail`,{leaseToken:claim.leaseToken,code:'platform_blocked'});}
 assert.equal((await s.request('/api/platforms')).body.platforms.youtube.available,false);
 assert.equal((await s.request('/api/jobs',{url},null,'4.4.4.4')).status,503);
});

test('public listener cannot reach internal/admin routes and ignores untrusted forwarded IPs',async t=>{
 const s=await setup(t,{trustProxy:false});
 assert.equal((await s.request('/internal/heartbeat',{workerId:'one'},token)).status,404);
 assert.equal((await s.request('/admin/logs')).status,404);
 const a=(await s.request('/api/jobs',{url},null,'6.6.6.6')).body;
 assert.ok(a.id);
 assert.equal((await s.request('/api/jobs',{url},null,'7.7.7.7')).status,429);
});

test('disconnecting a progress stream leaves the job running; cancellation invalidates its lease',async t=>{
 const s=await setup(t);const j=(await s.request('/api/jobs',{url})).body;
 const claim=(await s.worker('/internal/claim',{})).body.job;
 const controller=new AbortController();
 const response=await fetch(`http://127.0.0.1:${s.pub.address().port}/api/jobs/${j.id}/events?token=${j.token}`,{signal:controller.signal});
 const reader=response.body.getReader();await reader.read();controller.abort();
 assert.equal((await s.request(`/api/jobs/${j.id}`,undefined,j.token)).body.state,'fetching');
 await s.request(`/api/jobs/${j.id}/cancel`,{},j.token);
 assert.equal((await s.worker(`/internal/jobs/${j.id}/progress`,{leaseToken:claim.leaseToken,state:'downloading'})).status,409);
 assert.equal((await s.request(`/api/jobs/${j.id}/file`,undefined,j.token)).status,409);
});

test('job deadline and queued expiry fail jobs even with a healthy worker',async t=>{
 const s=await setup(t);const first=(await s.request('/api/jobs',{url})).body;await s.worker('/internal/claim',{});
 const second=(await s.request('/api/jobs',{url},null,'8.8.8.8')).body;
 s.advance(600001);
 assert.equal((await s.request(`/api/jobs/${first.id}`,undefined,first.token)).body.code,'timeout');
 assert.equal((await s.request(`/api/jobs/${second.id}`,undefined,second.token)).body.code,'queue_expired');
});

test('restart fails an active conversion and removes partial uploads',async t=>{
 const s=await setup(t);const j=(await s.request('/api/jobs',{url})).body;await s.worker('/internal/claim',{});
 fs.writeFileSync(path.join(s.dir,'files',`${j.id}.upload`),'partial');
 s.service.close();const resumed=createApps(s.opts);
 assert.equal(resumed.store.get(j.id).code,'interrupted');
 assert.equal(fs.existsSync(path.join(s.dir,'files',`${j.id}.upload`)),false);resumed.close();
});

test('foreign job tokens and forbidden worker platform assignments are rejected',async t=>{
 const s=await setup(t,{workerAssignments:{one:['youtube'],two:['bandcamp']}});
 const a=(await s.request('/api/jobs',{url})).body;
 const b=(await s.request('/api/jobs',{url},null,'8.8.4.4')).body;
 assert.equal((await s.request(`/api/jobs/${a.id}`,undefined,b.token)).status,404);
 await s.worker('/internal/heartbeat',{platforms:['youtube']},'two');
 assert.equal((await s.worker('/internal/claim',{},'two')).body.job,null);
});

