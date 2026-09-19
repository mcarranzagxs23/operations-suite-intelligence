import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {requireSuperAdmin,extractTelemetry,adaptTelemetry,reconcileDaily} from '../lib/telemetry-adapter.mjs';
import {loadDetectorArtifact} from '../lib/model-analysis.mjs';
import {buildResult} from '../lib/result-builder.mjs';
import {assertIntelligenceResult} from '../../src/intelligence/result-contract.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
async function readJson(name){return JSON.parse(await readFile(resolve(root,'data-science/artifacts/v0.2',name),'utf8'));}
export async function emulatorProvider() {
  if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw new Error('EMULATOR_REQUIRED');
  const {initializeApp,getApps}=await import('firebase-admin/app');
  const {getAuth}=await import('firebase-admin/auth'),{getFirestore}=await import('firebase-admin/firestore');
  const name='intelligence-local',app=getApps().find(a=>a.name===name)||initializeApp({projectId:'demo-operations-suite-emulator'},name);
  const db=getFirestore(app),auth=getAuth(app);
  return {
    verifyToken:token=>auth.verifyIdToken(token),
    accounts:async()=>{const s=await db.collection('accounts').limit(100).get();return s.docs.map(d=>({id:d.id}));},
    controlled:async(input,principal)=>{
      const {accountId,start,end}=input;
      const startMs=Date.parse(start),endMs=Date.parse(end);
      if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs>endMs||endMs-startMs>90*86400000||!start.endsWith('T00:00:00.000Z')||!end.endsWith('T23:59:59.999Z'))throw Object.assign(new Error('INVALID_PERIOD'),{status:400});
      const referenceEnd=new Date(startMs-1).toISOString(),referenceStart=new Date(startMs-30*86400000).toISOString();
      const readPage=async({accountId,start,end,after,limit})=>{
        let query=db.collection('accounts').doc(accountId).collection('telemetry').where('completedAt','>=',start).where('completedAt','<=',end).orderBy('completedAt').limit(limit);
        if(after)query=query.startAfter(after);
        const snapshot=await query.get();
        return {rows:snapshot.docs.map(d=>d.data()),nextCursor:snapshot.size===limit?snapshot.docs.at(-1):null};
      };
      const current=await extractTelemetry({principal,accountId,start,end,readPage,maxEvents:1000});
      const reference=await extractTelemetry({principal,accountId,start:referenceStart,end:referenceEnd,readPage,maxEvents:1000});
      const deviceDocs=await db.collection('accounts').doc(accountId).collection('devices').limit(400).get();
      const devices=deviceDocs.docs.map(d=>({id:d.id,accountId,...d.data()}));
      const now=new Date().toISOString();
      const adapted=adaptTelemetry({events:[...reference.events,...current.events],devices,accountId,generatedAt:now});
      const daily=await db.collection('accounts').doc(accountId).collection('telemetryDaily').where('day','>=',start.slice(0,10)).where('day','<=',end.slice(0,10)).orderBy('day').limit(500).get();
      const complete=current.coverage.complete&&reference.coverage.complete&&deviceDocs.size<400&&daily.size<500&&adapted.report.rejected_count===0;
      const artifact=await readJson('model.json'),model=loadDetectorArtifact(artifact),scored=adapted.transformed.map(r=>model.score(r));
      const reconciliation=reconcileDaily(adapted.transformed.filter(r=>r.completed_at>=start),daily.docs.map(d=>d.data()),{complete,available:true});
      return buildResult({scored,artifact,dataQuality:adapted.report,computedAt:now,mode:'AUTHORIZED_CONTROLLED',period:{start,end},referencePeriod:{start:referenceStart,end:referenceEnd},
        coverage:{complete,current:current.coverage,reference:reference.coverage,device_limit:400,aggregate_limit:500},reconciliation});
    }
  };
}
export function createIntelligenceHandler({mode='disabled',verifyToken,controlledProvider,accountsProvider,loadAcademic=()=>readJson('intelligence-result.json'),offlineToken=randomBytes(32).toString('hex')}={}) {
  let academic;
  return async function handler(req,res,next=()=>{res.writeHead(404);res.end();}) {
    const url=new URL(req.url,'http://localhost');
    if(!url.pathname.startsWith('/api/intelligence'))return next();
    const reply=(status,value)=>{
      if(res.headersSent)return;
      const raw=JSON.stringify(value),gzip=req.headers['accept-encoding']?.includes('gzip');
      res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...(gzip?{'content-encoding':'gzip'}:{})});
      res.end(gzip?gzipSync(raw):raw);
    };
    try {
      if(!['offline','emulator'].includes(mode))return reply(503,{code:'INTELLIGENCE_LOCAL_SERVICE_REQUIRED'});
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||''))return reply(403,{code:'DENIED'});
      if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)return reply(403,{code:'DENIED'});
      if(url.pathname==='/api/intelligence/demo-session'&&req.method==='GET') {
        if(mode!=='offline')return reply(403,{code:'DENIED'});
        return reply(200,{token:offlineToken,mode:'ACADEMIC_SYNTHETIC',identity:'LOCAL_SYNTHETIC_SUPER_ADMIN'});
      }
      const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
      let principal;
      if(mode==='offline'){if(!token||token!==offlineToken)return reply(403,{code:'DENIED'});principal={super_admin:true,mode:'LOCAL_SYNTHETIC'};}
      else {try{principal=await verifyToken(token);}catch{return reply(403,{code:'DENIED'});}}
      requireSuperAdmin(principal);
      if(url.pathname==='/api/intelligence/result'&&req.method==='GET') {
        academic??=Promise.resolve(loadAcademic()).then(assertIntelligenceResult).catch(error=>{academic=null;throw error;});
        return reply(200,await academic);
      }
      if(url.pathname==='/api/intelligence/accounts'&&req.method==='GET') {
        if(mode!=='emulator')return reply(403,{code:'CONTROLLED_REQUIRES_EMULATOR'});
        return reply(200,{accounts:await accountsProvider()});
      }
      if(url.pathname==='/api/intelligence/controlled'&&req.method==='POST') {
        if(mode!=='emulator')return reply(403,{code:'CONTROLLED_REQUIRES_EMULATOR'});
        let body='',bytes=0;
        for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)throw Object.assign(new Error('REQUEST_TOO_LARGE'),{status:413});body+=chunk.toString();}
        let input;try{input=JSON.parse(body);}catch{throw Object.assign(new Error('INVALID_REQUEST'),{status:400});}
        if(Object.keys(input).some(k=>!['accountId','start','end'].includes(k)))throw Object.assign(new Error('INVALID_REQUEST'),{status:400});
        return reply(200,assertIntelligenceResult(await controlledProvider(input,principal)));
      }
      return reply(404,{code:'NOT_FOUND'});
    } catch(error) {return reply(error.status||500,{code:error.status?error.message:'INTELLIGENCE_ANALYSIS_FAILED'});}
  };
}
