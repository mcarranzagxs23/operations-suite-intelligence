import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createIntelligenceHandler} from '../data-science/server/intelligence-api.mjs';
import {validateIntelligenceResult} from '../src/intelligence/result-contract.js';
import {projectIntelligence} from '../src/selectors/intelligence-projection.js';
import {canAccess,ROLE_IDS} from '../src/access-control.js';
import {createTranslator,UI_COPY} from '../src/i18n.js';
import {getDemoSession} from '../src/selectors/demo-projection.js';
import {loadIntelligence} from '../src/services/intelligence-service.js';
const result=JSON.parse(await readFile(new URL('../data-science/artifacts/v0.2/intelligence-result.json',import.meta.url),'utf8'));
const admin={role:'super_admin',globalRole:'super_admin'};
test('every non-super-admin role is denied by navigation, projection and service',async()=>{
 for(const role of [...Object.values(ROLE_IDS),'unassigned']) {
  assert.equal(canAccess(role,'intelligence'),role==='super_admin');
  if(role==='super_admin'){assert.doesNotThrow(()=>projectIntelligence(result,{},getDemoSession(role)));continue;}
  const session=getDemoSession(role);assert.throws(()=>projectIntelligence(result,{},session),/DENIED/);
  await assert.rejects(()=>loadIntelligence(session),/DENIED/);
 }
});
test('Intelligence translations have ES/EN parity and no damaged characters',()=>{
 const keys=Object.keys(UI_COPY.es).filter(k=>k.startsWith('int'));
 for(const language of ['es','en'])for(const key of keys){const text=createTranslator(language)(key,{});assert.ok(text&&text!==key,key);assert.ok(!/[\p{L}]\?[\p{L}]/u.test(text),key+': '+text);}
});
test('all requested filters select actual observations; trends retain cancellation evidence',()=>{
 const row=result.observations.find(r=>r.is_anomaly);
 const fields={account:row.account_id,workspace:JSON.stringify([row.account_id,row.workspace_id]),device:JSON.stringify([row.account_id,row.workspace_id,row.device_id]),tool:row.tool_id,platform:row.device_platform,status:row.status,severity:row.severity};
 for(const [key,value] of Object.entries(fields)){
  const view=projectIntelligence(result,{[key]:value},admin);assert.ok(view.observations.length>0);
  assert.ok(view.observations.every(r=>key==='workspace'?JSON.stringify([r.account_id,r.workspace_id])===value:key==='device'?JSON.stringify([r.account_id,r.workspace_id,r.device_id])===value:r[{account:'account_id',tool:'tool_id',platform:'device_platform'}[key]||key]===value));
 }
 for(const detector of ['IF','MAD','IQR'])assert.ok(projectIntelligence(result,{detector},admin).observations.every(r=>r.is_anomaly===r.detectors[detector].prediction));
 for(const period of ['7','30','90'])assert.ok(projectIntelligence(result,{period},admin).observations.length>0);
 assert.ok(result.trends.every(p=>'cancellation_rate' in p));
});
async function withServer(handler,fn) {
 const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await fn('http://127.0.0.1:'+server.address().port);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('Intelligence HTTP backend authorizes claims, not caller-supplied roles',()=>withServer(createIntelligenceHandler({mode:'emulator',verifyToken:async token=>({super_admin:token==='admin'}),loadAcademic:async()=>result}),async base=>{
 for(const token of ['','manager','artist'])assert.equal((await fetch(base+'/api/intelligence/result',{headers:{Authorization:'Bearer '+token}})).status,403);
 assert.equal((await fetch(base+'/api/intelligence/demo-session')).status,403);
 const response=await fetch(base+'/api/intelligence/result',{headers:{Authorization:'Bearer admin'}});
 assert.equal(response.status,200);assert.equal(validateIntelligenceResult(await response.json()).valid,true);
}));
test('offline fallback only serves explicit synthetic demo and denies controlled access',()=>withServer(createIntelligenceHandler({mode:'offline',offlineToken:'test-token',loadAcademic:async()=>result}),async base=>{
 assert.equal((await fetch(base+'/api/intelligence/result')).status,403);
 const {token}=await (await fetch(base+'/api/intelligence/demo-session')).json();
 assert.equal((await fetch(base+'/api/intelligence/result',{headers:{Authorization:'Bearer '+token}})).status,200);
 assert.equal((await fetch(base+'/api/intelligence/controlled',{method:'POST',headers:{Authorization:'Bearer '+token},body:'{}'})).status,403);
}));
test('missing and corrupt results return observable errors and can be retried',()=>{
 let attempt=0;
 return withServer(createIntelligenceHandler({mode:'offline',offlineToken:'test',loadAcademic:async()=>{attempt++;if(attempt===1)throw Error('ENOENT');if(attempt===2)return {};return result;}}),async base=>{
  const request=()=>fetch(base+'/api/intelligence/result',{headers:{Authorization:'Bearer test'}});
  for(let i=0;i<2;i++){const response=await request();assert.equal(response.status,500);assert.equal((await response.json()).code,'INTELLIGENCE_ANALYSIS_FAILED');}
  assert.equal((await request()).status,200);
 });
});
test('result contract rejects scope, unexpected fields and misleading severity',()=>{
 assert.equal(validateIntelligenceResult(result).valid,true);
 for(const mutation of [
 r=>{r.observations[0].account_id='account_outside';},
 r=>{r.observations[0].private_field='not allowed';},
 r=>{r.observations[0].is_anomaly=false;r.observations[0].severity='critical';},
  r=>{r.metadata.reference_end=r.metadata.period_end;}
  ,r=>{r.accounts=[null];},r=>{r.accounts={};},r=>{r.metadata.data_origin='REAL_CONTROLLED';},r=>{r.metadata.detector_version='';},r=>{r.observations[0].completed_at='2000-01-01T00:00:00.000Z';}
 ]){const copy=structuredClone(result);mutation(copy);assert.equal(validateIntelligenceResult(copy).valid,false);}
});
test('IQR explanation converts log milliseconds back into seconds',()=>{
 for(const row of result.observations){assert.ok(row.explanation.iqr_lower_seconds<row.reference_median);assert.ok(row.explanation.iqr_upper_seconds>row.reference_median);assert.ok(row.explanation.iqr_upper_seconds<43200);}
});
test('projection filters recompute counts and deny non-super-admin sessions',()=>{
 assert.throws(()=>projectIntelligence(result,{}, {role:'manager',globalRole:null}),/DENIED/);
 const filtered=projectIntelligence(result,{account:'account_demo_b',period:'30'},admin);
 assert.ok(filtered.observations.every(r=>r.account_id==='account_demo_b'));assert.equal(filtered.globalHealth.sample_size,filtered.observations.length);
 assert.ok(filtered.observations.length<result.observations.length);
 const empty=projectIntelligence(result,{account:'account_missing'},admin);assert.equal(empty.empty,true);assert.equal(empty.globalHealth.health_score,null);
 const today=projectIntelligence(result,{period:'today'},admin);assert.equal(today.globalHealth.health_status,'insufficient_data');
});
test('entity and anomaly details retain scoped identities and detector evidence',()=>{
 const view=projectIntelligence(result,{},admin);
 for(const entities of [view.workspaces,view.devices,view.tools])assert.ok(entities.every(e=>e.key&&e.account_id&&e.reasons.length));
 assert.ok(view.anomalies.every(a=>a.explanation.observed_seconds===a.duration_seconds));
 assert.ok(view.priorityQueue.every((r,i)=>r.priority===i+1));
});
