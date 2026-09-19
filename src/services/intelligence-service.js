import {assertIntelligenceResult} from '../intelligence/result-contract.js';
import {assertIntelligenceSession} from '../selectors/intelligence-projection.js';
let demoToken=null;
const mode=import.meta.env?.VITE_INTELLIGENCE_MODE||'disabled';
async function authorization(session) {
  assertIntelligenceSession(session);
  if(session.mode==='firebase') {
    const {getFirebaseServices}=await import('./firebase.js');
    const services=await getFirebaseServices();
    if(!services?.auth.currentUser)throw new Error('DENIED');
    const result=await services.auth.currentUser.getIdTokenResult();
    if(result.claims.super_admin!==true)throw new Error('DENIED');
    return services.auth.currentUser.getIdToken();
  }
  if(mode!=='offline')throw new Error('INTELLIGENCE_LOCAL_SERVICE_REQUIRED');
  if(!demoToken) {
    const response=await fetch('/api/intelligence/demo-session',{cache:'no-store'});
    if(!response.ok)throw new Error('DENIED');
    demoToken=(await response.json()).token;
  }
  return demoToken;
}
async function request(session,path,options={}) {
  const token=await authorization(session);
  const response=await fetch('/api/intelligence/'+path,{...options,cache:'no-store',headers:{'content-type':'application/json',Authorization:'Bearer '+token,...options.headers}});
  const body=await response.json();
  if(!response.ok)throw new Error(body.code||'INTELLIGENCE_ANALYSIS_FAILED');
  return body;
}
export async function loadIntelligence(session,{controlled}={}) {
  const result=controlled?await request(session,'controlled',{method:'POST',body:JSON.stringify(controlled)}):await request(session,'result');
  return assertIntelligenceResult(result);
}
export async function loadIntelligenceAccounts(session){return (await request(session,'accounts')).accounts;}
export const supportsControlledTelemetry=mode==='emulator';
/** 'offline' (synthetic demo identity), 'emulator' (Auth Emulator tokens) or 'disabled'; shown so the demo never implies more than it is. */
export const intelligenceServiceMode=mode;
