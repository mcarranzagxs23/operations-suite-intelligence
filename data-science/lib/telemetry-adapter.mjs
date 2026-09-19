import {ID_PATTERN,entityKey,strictInstant} from './analytical-contract.mjs';
import {transformRecords} from './dataset-etl.mjs';
export function requireSuperAdmin(principal) {
  if (!principal || principal.super_admin!==true) throw Object.assign(new Error('DENIED'),{status:403});
}
function instant(value) {
  if(typeof value==='string')return value;
  if(value && typeof value.toDate==='function')return value.toDate().toISOString();
  if(value && Number.isInteger(value.seconds))return new Date(value.seconds*1000+Math.floor((value.nanoseconds||0)/1e6)).toISOString();
  return null;
}
/** Closed projection: technical payloads, display names and personal fields never enter analytics. */
export function adaptTelemetry({events,devices=[],accountId,labels={},generatedAt,datasetVersion='controlled-1'}) {
  if(!ID_PATTERN.test(accountId))throw new Error('INVALID_ACCOUNT');
  const deviceMap=new Map(devices.filter(d=>d.accountId===accountId).map(d=>[entityKey(d.accountId,d.id),d]));
  const mapped=events.map(event=>{
    const device=deviceMap.get(entityKey(accountId,event.deviceId));
    if(event.accountId!==accountId)throw new Error('ACCOUNT_SCOPE_MISMATCH');
    if(device && device.workspaceId!==event.workspaceId)throw new Error('DEVICE_WORKSPACE_MISMATCH');
    return {execution_id:event.executionId,account_id:accountId,workspace_id:event.workspaceId,device_id:event.deviceId,actor_uid:event.actorUid,
      tool_id:event.toolId,tool_version:event.toolVersion,action:event.action,status:event.status,error_code:event.errorCode??null,duration_ms:event.durationMs,
      started_at:instant(event.startedAt),completed_at:instant(event.completedAt),received_at:instant(event.receivedAt),source:event.source,
      host_version:event.hostVersion??null,suite_version:event.suiteVersion??null,device_platform:device?.platform??null,
      data_origin:'REAL_CONTROLLED',expected_anomaly:Object.hasOwn(labels,event.executionId)?labels[event.executionId]:null,synthetic_pattern:null};
  });
  return transformRecords(mapped,{datasetVersion,generatedAt});
}
export async function extractTelemetry({principal,accountId,start,end,readPage,pageSize=200,maxEvents=5000}) {
  requireSuperAdmin(principal);
  if(!ID_PATTERN.test(accountId)||!strictInstant(start)||!strictInstant(end)||start>end||Date.parse(end)-Date.parse(start)>90*86400000)throw new Error('INVALID_EXTRACTION_SCOPE');
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>200||!Number.isInteger(maxEvents)||maxEvents<1||maxEvents>5000)throw new Error('INVALID_EXTRACTION_LIMIT');
  const events=[];let cursor=null,pages=0,complete=false;
  do {
    const size=Math.min(pageSize,maxEvents-events.length);
    const page=await readPage({accountId,start,end,after:cursor,limit:size});pages++;
    if(!Array.isArray(page.rows)||page.rows.length>size)throw new Error('INVALID_PAGE');
    for(const event of page.rows)if(event.accountId!==accountId||!strictInstant(event.completedAt)||event.completedAt<start||event.completedAt>end)throw new Error('PAGE_SCOPE_MISMATCH');
    events.push(...page.rows);
    if(!page.nextCursor){complete=true;break;}
    if(page.nextCursor===cursor||!page.rows.length)throw new Error('PAGINATION_NOT_ADVANCING');
    cursor=page.nextCursor;
  }while(events.length<maxEvents);
  return {events,coverage:{complete,pages,count:events.length,maxEvents,start,end,reason:complete?null:'READ_LIMIT_REACHED'}};
}
export function reconcileDaily(rows,aggregates,{complete=true,available=true}={}) {
  if(!available)return {status:'UNAVAILABLE',differences:[]};
  if(!complete)return {status:'INCOMPLETE_COVERAGE',differences:[]};
  const derived=new Map(),stored=new Map();
  for(const row of rows) {
    const key=entityKey(row.account_id,row.workspace_id,row.completed_at.slice(0,10));
    const v=derived.get(key)||{totalRuns:0,successfulRuns:0,failedRuns:0,cancelledRuns:0,totalDurationMs:0};
    v.totalRuns++;v.successfulRuns+=row.status==='success';v.failedRuns+=row.status==='failure';v.cancelledRuns+=row.status==='cancelled';v.totalDurationMs+=row.duration_ms;derived.set(key,v);
  }
  for(const row of aggregates)stored.set(entityKey(row.accountId,row.workspaceId,row.day),row);
  const differences=[];
  for(const key of new Set([...derived.keys(),...stored.keys()]))for(const field of ['totalRuns','successfulRuns','failedRuns','cancelledRuns','totalDurationMs']) {
    const expected=derived.get(key)?.[field]??0,actual=stored.get(key)?.[field]??0;
    if(expected!==actual)differences.push({key,field,derived:expected,stored:actual});
  }
  return {status:differences.length?'MISMATCH':'MATCH',differences};
}
