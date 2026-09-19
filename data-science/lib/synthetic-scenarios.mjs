import {RAW_COLUMNS} from './analytical-contract.mjs';
export const DATASET_VERSION='0.2.0';
export const SCENARIO_SEED=20260915;
export const DATASET_START='2026-03-01T00:00:00.000Z';
export const DEVELOPMENT_DAYS=90;
export const INFERENCE_DAYS=90;
/** Scenario parameters describe observable operations, never desired health scores. */
export const SCENARIOS=Object.freeze([
  {id:'stable',account:'account_demo_a',workspace:'workspace_shared',platform:'windows',durationFactor:1,failure:0.01,cancelled:0.005},
  {id:'review',account:'account_demo_a',workspace:'workspace_review',platform:'macos',durationFactor:1.06,failure:0.15,cancelled:0.05},
  {id:'degraded',account:'account_demo_b',workspace:'workspace_shared',platform:'windows',durationFactor:1.16,failure:0.32,cancelled:0.09},
  {id:'incident',account:'account_demo_b',workspace:'workspace_incident',platform:'macos',durationFactor:3.4,failure:0.8,cancelled:0.1},
  {id:'sparse',account:'account_demo_c',workspace:'workspace_sparse',platform:'windows',durationFactor:1,failure:0.01,cancelled:0}
]);
export function rng(seed) {
  let state=seed>>>0;
  return ()=>{state+=0x6d2b79f5;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
export function generateScenarios({seed=SCENARIO_SEED}={}) {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('INVALID_SEED');
  const random=rng(seed),rows=[],start=Date.parse(DATASET_START);
  for(let day=0;day<DEVELOPMENT_DAYS+INFERENCE_DAYS;day++)for(const scenario of SCENARIOS) {
    const inference=day>=DEVELOPMENT_DAYS;
    const count=scenario.id==='sparse' ? (inference?(day%18===0?1:0):4) : 8;
    for(let i=0;i<count;i++) {
      const clean=i%2===0,tool=clean?'clean-vector-pro':'sepmaker-pro',action=clean?'CLEAN ART':'Apply';
      const spike=random()<0.04,drop=spike&&random()<0.15;
      const gaussian=Math.sqrt(-2*Math.log(Math.max(random(),1e-12)))*Math.cos(2*Math.PI*random());
      const factor=inference?scenario.durationFactor:1;
      const duration=Math.max(1,Math.round((clean?4200:11200)*Math.exp(gaussian*0.20)*factor*(spike?(drop?0.25:3.5):1)));
      const draw=random(),failure=inference?scenario.failure:0.015,cancelled=inference?scenario.cancelled:0.005;
      const status=draw<failure?'failure':draw<failure+cancelled?'cancelled':'success';
      const completed=start+day*86400000+(8+i)*3600000+Math.floor(random()*60000);
      rows.push({execution_id:'exec_v02_'+String(rows.length+1).padStart(7,'0'),account_id:scenario.account,workspace_id:scenario.workspace,device_id:'device_'+scenario.id+'_'+(i%2),actor_uid:'actor_'+scenario.id,
        tool_id:tool,tool_version:clean?'3.6.1':'1.6.0',action,status,error_code:status==='success'?'':status==='cancelled'?'ACTION_CANCELLED':'PROCESSING_FAILED',
        duration_ms:String(duration),started_at:new Date(completed-duration).toISOString(),completed_at:new Date(completed).toISOString(),received_at:new Date(completed+500).toISOString(),
        source:'local_bridge',host_version:'Illustrator 29.0',suite_version:'Operation Suite 3.1',device_platform:scenario.platform,data_origin:'SYNTHETIC',
        expected_anomaly:String(spike||(inference&&factor>2)),synthetic_pattern:inference&&factor>2?'degradation':spike?(drop?'duration_drop':'duration_spike'):'normal'});
    }
  }
  return rows;
}
export {RAW_COLUMNS};
