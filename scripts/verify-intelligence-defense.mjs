import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {projectIntelligence} from '../src/selectors/intelligence-projection.js';
import {detectorAgreement,explainAnomaly,explainHealth,previousPeriodFilters,selectPriorityWorkspace,selectSpotlightAnomaly,summarizeView} from '../src/intelligence/presentation.js';

/**
 * Browser QA for the Intelligence defense experience.
 *
 * Drives a real headless Chrome with real mouse and keyboard input, and
 * compares what the screen shows with values computed here, in Node, from the
 * same result contract and the same functions. A number on screen that the
 * pipeline did not produce fails the run.
 *
 * Needs the offline demo running: npm.cmd run demo:intelligence -- --port 5177 --strictPort
 * Writes docs/data-science/evidence/defense-checks.json and the screenshots.
 */
const origin=process.env.INTELLIGENCE_TEST_ORIGIN||'http://127.0.0.1:5177';
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const evidence=resolve('docs/data-science/evidence');await mkdir(evidence,{recursive:true});
const cache=resolve('.cache');await mkdir(cache,{recursive:true});
const profile=await mkdtemp(join(cache,'intelligence-defense-'));
const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if(!browser)throw new Error('BROWSER_NOT_AVAILABLE');

// Expected values, from the artifact the local service serves.
const result=JSON.parse(await readFile(resolve('data-science/artifacts/v0.2/intelligence-result.json'),'utf8'));
const admin={role:'super_admin',globalRole:'super_admin'};
const baseView=projectIntelligence(result,{period:'90'},admin);
const priorityWorkspace=selectPriorityWorkspace(baseView.priorityQueue);
const spotlight=selectSpotlightAnomaly(baseView.anomalies);
const globalExplanation=explainHealth(baseView.globalHealth,result.metadata.health_policy,baseView.referenceObservations);
const spotlightExplanation=explainAnomaly(spotlight,result.metadata);
const ifAgreement=detectorAgreement(baseView.observations,'IF',result.metadata);
const before=summarizeView(baseView),thirty=summarizeView(projectIntelligence(result,{period:'30'},admin));
const workspaceKey=JSON.stringify([priorityWorkspace.account_id,priorityWorkspace.entity_id]);
const workspaceSummary=summarizeView(projectIntelligence(result,{period:'90',account:priorityWorkspace.account_id,workspace:workspaceKey},admin));
const previousThirty=previousPeriodFilters({period:'30'},result.metadata);
const decision=[...new Set(result.metadata.model_selection.map(m=>m.decision_detector))].join(' / ');
/** Parse a Spanish-formatted number from screen text ("1.653,29", "65,73", "2885"). */
const parse=text=>Number(String(text).replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.'));
const same=(text,value,tolerance=.006)=>Number.isFinite(parse(text))&&Math.abs(parse(text)-value)<=tolerance;

// Headless Chrome throttles animation frames for pages it treats as backgrounded; a presenter's
// foreground window does not, and the count-up checks below measure frames, so throttling is off.
const child=spawn(browser,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--window-size=1920,1080','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','about:blank'],{stdio:'ignore',windowsHide:true,env:{...process.env,TEMP:profile,TMP:profile}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let socket,id=0;const pending=new Map(),errors=[],checks=[],screenshots=[];
const check=(name,ok,detail)=>{checks.push({name,status:ok?'PASS':'FAIL',...(detail===undefined?{}:{detail})});if(!ok)console.error('FAIL',name,JSON.stringify(detail));};
try{
  let port;for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await pause(100);}}
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=pages.find(p=>p.type==='page'&&p.url==='about:blank');assert.ok(page,'isolated browser page');
  socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);else if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject,timer:setTimeout(()=>reject(Error(method+' timeout')),20000)});socket.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
  const wait=async(expression,label=expression)=>{for(let i=0;i<120;i++){if(await evaluate(expression))return true;await pause(100);}throw Error('UI_TIMEOUT: '+label);};
  const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(300);};
  const shot=async name=>{await pause(450);const s=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(evidence,name),Buffer.from(s.data,'base64'));screenshots.push(name);};
  const text=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent??null`);
  /** A real mouse click at the centre of the element, after bringing it into view. */
  const click=async selector=>{
    const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r0=e.getBoundingClientRect();if(r0.top<80||r0.bottom>innerHeight-110)e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+Math.min(r.width/2,40),y:r.top+r.height/2};})()`);
    assert.ok(p,'element '+selector);await pause(120);
    for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:type==='mouseMoved'?0:1});
    await pause(150);
  };
  const press=async(key,code=key,vk=0,textValue)=>{
    await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,...(textValue?{text:textValue}:{})});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});
    await pause(150);
  };
  const escape=()=>press('Escape','Escape',27);
  /** Wait until smooth scrolling has come to rest: three still readings in a row, since a scroll can pause for a moment under load. */
  const settle=async()=>{let last=-1,still=0;for(let i=0;i<80;i++){const y=await evaluate('scrollY');still=y===last?still+1:0;if(still>=3)return;last=y;await pause(120);}};
  const step=async name=>{await click(`[data-step=${name}]`);await pause(200);await settle();};
  const setSelect=(label,value)=>evaluate(`(()=>{const s=document.querySelector('select[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const dialogOpen="!!document.querySelector('dialog[open]')",dialogClosed="!document.querySelector('dialog[open]')";

  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
  await viewport(1366,768);
  const navigation=await send('Page.navigate',{url:origin});assert.ok(!navigation.errorText,navigation.errorText);
  await wait("!!document.querySelector('#role-select')");
  await evaluate("[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.trim()==='Intelligence').click()");
  await wait("!!document.querySelector('[data-kpi=intTotal]')");
  await pause(600);

  // --- Responsive matrix -------------------------------------------------
  const matrix=[[1920,1080],[1600,900],[1366,768],[1280,720],[1024,768],[768,1024],[1366,633],[1280,585]];
  for(const [w,h] of matrix) {
    await viewport(w,h);await evaluate('window.scrollTo(0,0)');await pause(200);
    const m=await evaluate(`(()=>{
      const sb=document.querySelector('.sidebar'),wide=getComputedStyle(sb).position==='fixed';
      const items=[...sb.querySelectorAll('.nav-item')];
      const rail={scrollable:sb.scrollHeight>sb.clientHeight+1,overflowY:getComputedStyle(sb).overflowY,hidden:items.filter(i=>i.getBoundingClientRect().bottom>innerHeight+.5).length,intelligenceVisible:(()=>{const r=items.find(i=>i.getAttribute('aria-label')==='Intelligence').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()};
      const tables=[...document.querySelectorAll('.int-table-panel')].filter(p=>p.id).map(p=>{const rows=[...p.querySelectorAll('tbody tr')].map(r=>r.getBoundingClientRect().height);const wrap=p.querySelector('.int-table-wrap'),table=wrap.querySelector('table');return {id:p.id,maxRow:Math.round(Math.max(0,...rows)),fits:table.scrollWidth<=wrap.clientWidth+1,scrollable:getComputedStyle(wrap).overflowX==='auto'};});
      const ids=[...document.querySelectorAll('.int-table-wrap .int-id')].map(e=>{const cs=getComputedStyle(e);return e.getBoundingClientRect().height/(parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2);});
      const topbar=document.querySelector('.topbar').getBoundingClientRect();
      const kpiFont=Math.min(...[...document.querySelectorAll('.int-kpi strong')].map(e=>parseFloat(getComputedStyle(e).fontSize)));
      const tableFont=Math.min(...[...document.querySelectorAll('.int-table-wrap td')].slice(0,200).map(e=>parseFloat(getComputedStyle(e).fontSize)));
      return {wide,rail,tables,maxIdLines:Math.max(...ids),pageOverflow:document.documentElement.scrollWidth>innerWidth,topbarHeight:Math.round(topbar.height),kpiFont,tableFont};
    })()`);
    const size=w+'x'+h;
    check(`${size}: no page-level horizontal scroll`,!m.pageOverflow);
    if(m.wide) {
      check(`${size}: sidebar reachable (every item visible or rail scrolls)`,m.rail.hidden===0||(m.rail.scrollable&&m.rail.overflowY==='auto'),m.rail);
      check(`${size}: Intelligence visible in the rail without scrolling`,m.rail.intelligenceVisible,m.rail);
    }
    check(`${size}: rows stay compact (<= 64px)`,m.tables.every(t=>t.maxRow<=64),m.tables.map(t=>t.id+':'+t.maxRow));
    check(`${size}: identifiers on one line`,m.maxIdLines<1.6,m.maxIdLines);
    check(`${size}: wide tables scroll inside their frame`,m.tables.every(t=>t.fits||t.scrollable));
    check(`${size}: header not squashed, text not microscopic`,m.topbarHeight>=56&&m.kpiFont>=24&&m.tableFont>=12,{topbar:m.topbarHeight,kpi:m.kpiFont,table:m.tableFont});
    // A detail dialog fits the screen and keeps its close button visible at the end of its content.
    await click('[data-action=spotlight-anomaly]');await wait(dialogOpen);await pause(350);
    const d=await evaluate(`(()=>{const d=document.querySelector('dialog[open]'),r=d.getBoundingClientRect();d.scrollTop=d.scrollHeight;const c=d.querySelector('.int-dialog-close').getBoundingClientRect();return {inside:r.top>=-1&&r.left>=-1&&r.bottom<=innerHeight+1&&r.right<=innerWidth+1,closeVisible:c.top>=r.top-1&&c.bottom<=innerHeight+1&&c.height>0};})()`);
    check(`${size}: dialog inside the viewport, close button visible after scrolling`,d.inside&&d.closeVisible,d);
    await escape();await wait(dialogClosed);
    if(w===1366&&h===633)await shot('10-sidebar-1366x633.png');
  }

  // --- The specific sidebar check (1366x768 screen, maximised window) -----
  await viewport(1366,633);await evaluate('window.scrollTo(0,0)');
  const rail=await evaluate(`(()=>{const sb=document.querySelector('.sidebar');sb.scrollTop=0;const last=[...sb.querySelectorAll('.nav-item')].at(-1);last.focus();const r=last.getBoundingClientRect();return {label:last.getAttribute('aria-label'),top:r.top,bottom:r.bottom,innerHeight,scrollTop:sb.scrollTop};})()`);
  check('sidebar 1366x633: keyboard focus brings the last item fully into view',rail.bottom<=rail.innerHeight&&rail.top>=0&&rail.scrollTop>0,rail);
  await evaluate("document.querySelector('.sidebar').scrollTop=0;document.activeElement.blur()");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:120,y:300});
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:120,y:300,deltaX:0,deltaY:500});await pause(400);
  const wheel=await evaluate(`(()=>{const sb=document.querySelector('.sidebar');const last=[...sb.querySelectorAll('.nav-item')].at(-1).getBoundingClientRect();return {scrollTop:sb.scrollTop,lastBottom:last.bottom,innerHeight};})()`);
  check('sidebar 1366x633: mouse wheel scrolls the rail to its last item',wheel.scrollTop>0&&wheel.lastBottom<=wheel.innerHeight,wheel);

  // --- The defense flow, at the projector resolution -----------------------
  await viewport(1366,768);await evaluate("document.querySelector('.sidebar').scrollTop=0;window.scrollTo(0,0)");await pause(300);
  check('global KPIs match the projection',same(await text('[data-kpi=intGlobal]'),before.health)&&same(await text('[data-kpi=intTotal]'),before.executions)&&same(await text('[data-kpi=intAnomalies]'),before.anomalies),{health:before.health,executions:before.executions});
  await shot('01-intelligence-global.png');

  await click('[data-action=defense-mode]');await wait("!!document.querySelector('.int-dock')");await pause(500);
  const defense=await evaluate(`(()=>{const dock=document.querySelector('.int-dock').getBoundingClientRect(),sb=document.querySelector('.sidebar').getBoundingClientRect();
    return {rail:Math.round(sb.width),dockInside:dock.bottom<=innerHeight&&dock.top>innerHeight/2&&dock.left>=sb.right,dockText:document.querySelector('.int-dock').textContent,
      banner:!!document.querySelector('.sample-banner'),bridge:[...document.querySelectorAll('.topbar .status')].some(s=>s.getBoundingClientRect().width>0),
      intro:document.querySelector('.int-defense-intro')?.textContent||'',pressed:document.querySelector('[data-action=defense-mode]').getAttribute('aria-pressed'),
      labels:[...document.querySelectorAll('.sidebar .nav-item')].every(n=>n.getAttribute('aria-label')&&n.getAttribute('title'))};})()`);
  check('defense mode: navigation collapses to a named icon rail',defense.rail<=80&&defense.labels,defense.rail);
  check('defense mode: dock fixed on screen with the synthetic-data badge',defense.dockInside&&defense.dockText.includes('DEMO ACADÉMICA — DATOS SINTÉTICOS'),defense.dockText.slice(0,60));
  check('defense mode: dataset banner and bridge status stay visible; local identity is declared',defense.banner&&defense.bridge&&defense.intro.includes('identidad sintética')&&defense.pressed==='true');
  await shot('08-projector-1366x768.png');

  // Guided navigation: each step scrolls its section under the top bar and marks itself current.
  const steps=['overview','health','anomaly','priority','models','conclusion'];
  const targets={overview:'int-step-overview',health:'int-step-health',anomaly:'int-anomalies',priority:'int-priority',models:'int-step-models',conclusion:'int-step-conclusion'};
  const reached=[];
  for(const stepName of steps) {
    await step(stepName);
    const r=await evaluate(`(()=>{const top=document.getElementById(${JSON.stringify(targets[stepName])}).getBoundingClientRect().top,bar=document.querySelector('.topbar').getBoundingClientRect().bottom;
      const atEnd=innerHeight+scrollY>=document.documentElement.scrollHeight-4;return {delta:Math.round(top-bar),atEnd,current:document.querySelector('[aria-current=step]')?.dataset.step};})()`);
    reached.push({step:stepName,...r});
  }
  check('guided steps: each step brings its section into view and becomes current',reached.every(r=>(Math.abs(r.delta-12)<=30||r.atEnd)&&r.current===r.step),reached);

  // 1-3 Global Health → Health Explorer → components
  await step('overview');
  await click('[data-kpi-action=intGlobal]');await wait(dialogOpen);await pause(400);
  const explorer=await evaluate(`(()=>{const d=document.querySelector('dialog[open]');return {score:d.querySelector('[data-explorer-score]').textContent,components:[...d.querySelectorAll('[data-component]')].map(li=>({id:li.dataset.component,value:li.querySelector('.int-component-value').textContent,meta:li.querySelector('.int-component-meta').textContent})),formula:d.querySelector('[data-formula]')?.textContent||'',focus:document.activeElement?.className};})()`);
  check('Health Explorer: score equals the Global Health KPI',same(explorer.score,before.health),explorer.score);
  check('Health Explorer: four components with the contract values and weights',explorer.components.length===4&&explorer.components.every((c,i)=>c.id===globalExplanation.components[i].id&&same(c.value,globalExplanation.components[i].value)&&c.meta.includes(new Intl.NumberFormat('es',{maximumFractionDigits:2}).format(globalExplanation.components[i].weight*100)+'%')),explorer.components);
  check('Health Explorer: the formula sums to the published score',same(explorer.formula.split('=').at(-1),before.health),explorer.formula);
  check('Health Explorer: focus moves into the dialog',explorer.focus==='int-dialog-close',explorer.focus);
  await shot('02-health-explorer.png');

  // 4 Priority workspace, reached from inside the explorer
  await click('dialog[open] .int-primary');await pause(500);
  const ws=await evaluate(`(()=>{const d=document.querySelector('dialog[open]');return {title:d.querySelector('h2').textContent,score:d.querySelector('[data-explorer-score]').textContent,rank:d.querySelector('.int-facts-wide')?.textContent||'',reference:d.querySelector('[data-compare=anomalyRate]')?.textContent||''};})()`);
  check('priority workspace: derived from the queue, with its score and rank',ws.title===priorityWorkspace.entity_id&&same(ws.score,priorityWorkspace.health_score)&&ws.rank.includes(String(priorityWorkspace.priority)),ws);
  await evaluate("document.querySelector('dialog[open]').scrollTop=0");
  await click('dialog[open] .int-spotlight-toggle');await pause(400);
  check('spotlight: the dialog enlarges and can be switched back',await evaluate("document.querySelector('dialog[open]').classList.contains('is-spotlight')&&document.querySelector('dialog[open] .int-spotlight-toggle').getAttribute('aria-pressed')==='true'"));
  await shot('03-workspace-priority.png');
  await escape();await wait(dialogClosed);
  check('keyboard: Escape closes and focus returns to the trigger',await evaluate("document.activeElement?.dataset.kpiAction==='intGlobal'"));

  // 5-6 Anomaly spotlight → Why flagged
  await step('anomaly');
  await shot('04-anomaly-spotlight.png');
  await click('[data-action=spotlight-anomaly]');await wait(dialogOpen);await pause(400);
  const why=await evaluate(`(()=>{const d=document.querySelector('dialog[open]'),v=k=>d.querySelector('[data-why='+k+']').textContent;return {id:d.querySelector('h2').textContent,observed:v('observed'),median:v('median'),p95:v('p95'),ratio:v('ratio'),cards:[...d.querySelectorAll('[data-detector]')].map(c=>({id:c.dataset.detector,flagged:c.classList.contains('is-flagged'),decision:c.classList.contains('is-decision')})),sentence:d.querySelector('.int-sentence').textContent};})()`);
  check('anomaly spotlight: chosen from the data by the documented policy',why.id===spotlight.execution_id,why.id);
  check('why flagged: observed, median, P95 and deviation match the scored row',same(why.observed,spotlightExplanation.observed)&&same(why.median,spotlightExplanation.median)&&same(why.p95,spotlightExplanation.p95)&&same(why.ratio,spotlightExplanation.ratio),why);
  check('why flagged: detector cards match the stored predictions and the calibrated decision',why.cards.length===3&&why.cards.every(c=>c.flagged===spotlight.detectors[c.id].prediction&&c.decision===(c.id===spotlightExplanation.calibratedDetector)),why.cards);
  check('why flagged: plain-language comparison with the median',why.sentence.includes(new Intl.NumberFormat('es',{maximumFractionDigits:2}).format(spotlightExplanation.ratio)),why.sentence);
  await shot('05-why-flagged.png');
  await escape();await wait(dialogClosed);
  check('keyboard: focus returns to the spotlight button',await evaluate("document.activeElement?.dataset.action==='spotlight-anomaly'"));

  // 7 Model Comparison Lab and comparison-only lens
  await step('models');
  const labBefore=await evaluate("({decision:document.querySelector('[data-decision-detector]').textContent,health:document.querySelector('[data-kpi=intGlobal]').textContent})");
  await click('#int-step-models input[value=IF]');await pause(500);
  const lab=await evaluate(`(()=>({decision:document.querySelector('[data-decision-detector]').textContent,health:document.querySelector('[data-kpi=intGlobal]').textContent,focus:document.querySelector('.int-model-card.is-focus')?.dataset.model,agreement:document.querySelector('[data-agreement]').textContent,chip:document.querySelector('.int-focus legend').textContent,detectorFilter:document.querySelector('select[aria-label="Detector"]').value}))()`);
  check('model lab: decision detector read from the model selection metadata',labBefore.decision===decision,labBefore.decision);
  check('comparison mode: IF in focus shows its own count, derived from stored predictions',lab.focus==='IF'&&lab.agreement.includes(new Intl.NumberFormat('es',{maximumFractionDigits:2}).format(ifAgreement.flagged)),lab.agreement);
  check('comparison mode: labelled comparison-only; decision detector, filters and Health Score unchanged',lab.chip.includes('SOLO COMPARACIÓN')&&lab.decision===labBefore.decision&&lab.health===labBefore.health&&lab.detectorFilter==='',lab);
  await shot('06-model-comparison.png');

  // 8-10 Period 90 → 30: impact summary and animated KPIs
  await step('overview');
  // Sample the KPI every frame while it counts, to check every shown value lies between the two ends.
  await evaluate(`(()=>{window.__kpi=[];const t0=performance.now();const tick=()=>{window.__kpi.push(document.querySelector('[data-kpi=intTotal]').textContent);if(performance.now()-t0<2000)requestAnimationFrame(tick);};requestAnimationFrame(tick);})()`);
  await setSelect('Período','30');await pause(250);
  const impact=await evaluate(`(()=>{const f=id=>{const li=document.querySelector('[data-impact-field='+id+']');return [li.querySelector('[data-from]').textContent,li.querySelector('[data-to]').textContent];};return {executions:f('executions'),anomalies:f('anomalies'),health:f('health'),median:f('median')};})()`);
  check('filter impact: before → after for 90 → 30 days, from the projections',same(impact.executions[0],before.executions)&&same(impact.executions[1],thirty.executions)&&same(impact.anomalies[0],before.anomalies)&&same(impact.anomalies[1],thirty.anomalies)&&same(impact.health[0],before.health)&&same(impact.health[1],thirty.health)&&same(impact.median[0],before.median)&&same(impact.median[1],thirty.median),impact);
  await pause(1900);
  const counted=(await evaluate('window.__kpi')).map(parse);
  const settled={total:await text('[data-kpi=intTotal]'),health:await text('[data-kpi=intGlobal]'),frames:counted.length,distinct:[...new Set(counted)].length};
  check('KPI count-up stays between its two values and settles on the exact projection',counted.every(v=>v>=thirty.executions&&v<=before.executions)&&same(settled.total,thirty.executions)&&same(settled.health,thirty.health)&&settled.distinct>2,settled);
  await shot('07-filter-impact.png');
  await click('[data-action=compare-period]');await pause(300);
  const period=await text('[data-period-comparison]');
  check('period comparison: previous window of equal length inside the inference period',period.includes(previousThirty.start)&&period.includes(previousThirty.end),period.slice(0,160));
  await click('[data-action=compare-period]');
  await evaluate("[...document.querySelectorAll('.int-filter-actions button')][0].click()");await pause(500);
  await setSelect('Workspace',workspaceKey);await pause(700);
  check('workspace filter: KPIs recompute for the priority workspace',same(await text('[data-kpi=intTotal]'),workspaceSummary.executions)&&same(await text('[data-kpi=intGlobal]'),workspaceSummary.health),{executions:workspaceSummary.executions,health:workspaceSummary.health});
  await evaluate("[...document.querySelectorAll('.int-filter-actions button')][0].click()");await pause(600);

  // 11 Priority queue: compact rows, Details opens the explorer
  await step('priority');
  const queue=await evaluate(`(()=>{const rows=[...document.querySelectorAll('#int-priority tbody tr')];return {max:Math.max(...rows.map(r=>r.getBoundingClientRect().height)),columns:document.querySelectorAll('#int-priority thead th').length};})()`);
  check('priority queue: compact rows and a summary column set',queue.max<=64&&queue.columns<=12,queue);
  await click('#int-priority tbody tr:first-child td:last-child button');await wait(dialogOpen);await pause(300);
  check('priority details: what is wrong, what changed, how serious, what to review',await evaluate("['#int-q-what','#int-q-changed','#int-q-severity','#int-q-review'].every(s=>document.querySelector('dialog[open] '+s))"));
  await escape();await wait(dialogClosed);

  // Workspace rows: pointer on the row, Enter and Space on the identifier button
  await step('health');
  await click('#int-workspaces tbody tr:first-child td:nth-child(3)');await wait(dialogOpen);
  check('workspace row: a click on the row opens its Health Explorer',await evaluate(`document.querySelector('dialog[open] h2').textContent===${JSON.stringify(baseView.workspaces[0].entity_id)}`));
  await escape();await wait(dialogClosed);
  await evaluate("document.querySelector('#int-workspaces tbody tr:first-child .int-link').focus()");
  await press('Enter','Enter',13,'\r');await wait(dialogOpen);
  check('keyboard: Enter on the row identifier opens the explorer',true);
  await escape();await wait(dialogClosed);
  check('keyboard: focus returns to the row identifier',await evaluate("document.activeElement?.classList.contains('int-link')"));
  await press(' ','Space',32,' ');await wait(dialogOpen);
  check('keyboard: Space on the row identifier opens the explorer',true);
  await escape();await wait(dialogClosed);
  check('focus visible on the interactive row',await evaluate("document.activeElement.closest('tr').matches(':focus-within')&&getComputedStyle(document.activeElement).outlineStyle!=='none'"));

  // Clickable KPI → section
  await step('overview');
  await click('[data-kpi-action=intAnomalies]');await pause(200);await settle();
  check('clickable KPI: Anomalies scrolls to the anomalies table',await evaluate("Math.abs(document.getElementById('int-anomalies').getBoundingClientRect().top-document.querySelector('.topbar').getBoundingClientRect().bottom-12)<=30"));

  // Trends: hover and keyboard read a point; Enter opens the data table
  await evaluate("document.getElementById('int-trends').scrollIntoView({block:'center'})");await pause(400);
  const bar=await evaluate(`(()=>{const r=document.querySelector('[data-chart=health] .int-chart-bar').getBoundingClientRect();return {x:r.left+r.width/2,y:r.bottom-4};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:bar.x,y:bar.y});await pause(200);
  check('trends: hovering a bar reads its week and value',(await text('[data-chart=health] .int-chart-readout')).startsWith('Semana del'));
  await evaluate("document.querySelector('[data-chart=anomaly_rate] .int-chart-plot').focus()");
  await press('End','End',35);await press('ArrowLeft','ArrowLeft',37);
  const readout=await text('[data-chart=anomaly_rate] .int-chart-readout');
  const penultimate=baseView.trends.at(-2);
  check('trends: arrow keys read points in order',readout.includes(penultimate.start.slice(0,10)),readout);
  await press('Enter','Enter',13,'\r');
  check('trends: Enter opens the data table',await evaluate("document.querySelector('[data-chart=anomaly_rate] details').open"));
  // Regression: a point read on the 90-day view must not break the charts when the period gets shorter.
  await setSelect('Período','7');await pause(500);
  check('trends: a shorter period after reading a point keeps every chart working',await evaluate("document.querySelectorAll('.int-chart').length===6&&!!document.querySelector('[data-kpi=intTotal]')"));
  await evaluate("[...document.querySelectorAll('.int-filter-actions button')][0].click()");await pause(500);

  // 12 Conclusion
  await step('conclusion');
  const conclusion=await text('#int-step-conclusion');
  check('conclusion: derived facts only (priority entity, workspace, anomaly, decision detector)',conclusion.includes(baseView.priorityQueue[0].entity_id)&&conclusion.includes(priorityWorkspace.entity_id)&&conclusion.includes(spotlight.execution_id)&&conclusion.includes(decision)&&conclusion.includes('sin inferencia causal'),conclusion.slice(0,200));
  check('defense aids: conclusion exposes an optional plain-language card',await evaluate("document.querySelector('[data-defense-aid=conclusion] button')?.getAttribute('aria-expanded')==='true'"));
  await shot('defense-conclusion-glossary-button.png');
  await click('[data-action=open-defense-glossary]');await wait(dialogOpen);await pause(250);
  const glossary=await evaluate(`(()=>{const d=document.querySelector('dialog[open]'),input=d.querySelector('input');return {role:d.getAttribute('role')||'dialog',modal:d.getAttribute('aria-modal'),label:input?.labels?.[0]?.textContent,focus:document.activeElement?.className,categories:[...d.querySelectorAll('.int-glossary-categories button')].map(b=>b.textContent),entries:d.querySelectorAll('.int-glossary-entry').length};})()`);
  check('glossary: opens as a labelled modal with searchable categories',glossary.role==='dialog'&&glossary.modal==='true'&&glossary.label==='Buscar término'&&glossary.categories.includes('MODELOS')&&glossary.entries>=40,glossary);
  await shot('defense-glossary.png');
  const setGlossarySearch=value=>evaluate(`(()=>{const input=document.querySelector('.int-glossary-search input'),set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;input.focus();set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await setGlossarySearch('F1');await pause(180);
  check('glossary search: F1 filters immediately by scientific term',await evaluate("document.querySelectorAll('.int-glossary-entry').length===1&&document.querySelector('.int-glossary-entry h3')?.textContent==='F1'"));
  await shot('defense-glossary-search-f1.png');
  await setGlossarySearch('P95');await pause(120);
  check('glossary search: P95 filters immediately',await evaluate("document.querySelectorAll('.int-glossary-entry').length===1&&document.querySelector('.int-glossary-entry h3')?.textContent==='P95'"));
  await setGlossarySearch('MAD');await pause(120);
  check('glossary search: MAD filters immediately across names and descriptions',await evaluate("document.querySelectorAll('.int-glossary-entry').length>=1&&[...document.querySelectorAll('.int-glossary-entry h3')].some(h=>h.textContent==='MAD')"));
  await setGlossarySearch('');await evaluate("[...document.querySelectorAll('.int-glossary-categories button')].find(b=>b.textContent==='MODELOS').click()");await pause(120);
  check('glossary categories: MODELOS filters without changing the search',await evaluate("document.querySelectorAll('.int-glossary-entry').length>=8&&[...document.querySelectorAll('.int-glossary-entry')].every(e=>e.querySelector('.int-glossary-entry-head span').textContent==='MODELOS')"));
  await escape();await wait(dialogClosed);
  check('glossary: Escape closes it and returns focus to its conclusion trigger',await evaluate("document.activeElement?.dataset.action==='open-defense-glossary'"));
  await step('health');await shot('defense-simple-explanation-health.png');
  await click('[data-defense-aid=health] button');
  check('defense aids: health explanation collapses',await evaluate("document.querySelector('[data-defense-aid=health] button').getAttribute('aria-expanded')==='false'"));
  await click('[data-defense-aid=health] button');
  check('defense aids: health explanation expands again',await evaluate("document.querySelector('[data-defense-aid=health] button').getAttribute('aria-expanded')==='true'"));
  await step('models');await shot('defense-simple-explanation-models.png');

  // Projector at 1280x720 with defense mode
  await viewport(1280,720);await step('overview');
  const small=await evaluate(`(()=>{const dock=document.querySelector('.int-dock').getBoundingClientRect();return {dock:dock.bottom<=innerHeight&&dock.height<=110,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  check('1280x720 defense mode: dock on screen, no horizontal scroll',small.dock&&!small.overflow,small);
  await shot('09-projector-1280x720.png');
  await viewport(1920,1080);await pause(300);await shot('11-defense-1920x1080.png');

  // Reduced motion: the KPI jumps straight to its value
  await viewport(1366,768);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await setSelect('Período','7');await pause(80);
  // 80 ms: long enough for React to render, far shorter than the 420 ms count-up it must skip.
  const instant=await text('[data-kpi=intTotal]');
  const seven=summarizeView(projectIntelligence(result,{period:'7'},admin));
  check('reduced motion: KPIs update without counting animation',same(instant,seven.executions),{instant,page:await evaluate("document.body.innerText.slice(0,240)"),url:await evaluate('location.href'),errors:errors.slice(-4)});
  await send('Emulation.setEmulatedMedia',{features:[]});
  await evaluate("[...document.querySelectorAll('.int-filter-actions button')][0].click()");await pause(400);

  // Language and exit
  await evaluate("document.querySelector('.language-button').click()");await wait("document.body.textContent.includes('Defense mode')");
  check('English: defense experience translated, synthetic badge kept',await evaluate("['ACADEMIC DEMO — SYNTHETIC DATA','Show featured anomaly','View priority workspace','Evidence-based conclusion','COMPARISON ONLY'].every(s=>document.body.textContent.includes(s))&&!!document.querySelector('.int-dock[aria-label=\"Guided defense walkthrough\"]')"));
  await evaluate("document.querySelector('.language-button').click()");await wait("document.body.textContent.includes('Modo defensa')");
  await click('.int-dock-exit');await pause(300);
  check('exit: defense mode off restores the full navigation',await evaluate("!document.querySelector('.int-dock')&&!document.querySelector('.app-shell.defense-mode')&&document.querySelector('.sidebar').getBoundingClientRect().width>200"));

  const expectedBridgeUnavailable=errors.filter(e=>e.url==='http://127.0.0.1:4317/v1/health'&&e.text==='Failed to load resource: net::ERR_CONNECTION_REFUSED');
  const unexpected=errors.filter(e=>!expectedBridgeUnavailable.includes(e));
  check('no browser exceptions or unexpected errors',unexpected.length===0,unexpected.slice(0,3));
  const failed=checks.filter(c=>c.status==='FAIL');
  await writeFile(join(evidence,'defense-checks.json'),JSON.stringify({origin,expected:{spotlight:spotlight.execution_id,priorityWorkspace:priorityWorkspace.account_id+' / '+priorityWorkspace.entity_id,decisionDetector:decision,globalHealth:before.health,thirtyDays:{executions:thirty.executions,anomalies:thirty.anomalies,health:thirty.health}},checks,screenshots,exceptions:unexpected,expectedBridgeUnavailable:expectedBridgeUnavailable.length},null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,passed:checks.length-failed.length,failed:failed.map(c=>c.name),screenshots},null,2));
  if(failed.length)process.exitCode=1;
}finally{socket?.close();child.kill();for(const p of pending.values())clearTimeout(p.timer);}
