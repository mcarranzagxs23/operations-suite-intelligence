import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),origin=process.env.INTELLIGENCE_TEST_ORIGIN||'http://127.0.0.1:5177';
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const cache=resolve('.cache');await mkdir(cache,{recursive:true});
const profile=await mkdtemp(join(cache,'intelligence-browser-'));
const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if(!browser)throw new Error('BROWSER_NOT_AVAILABLE');
const child=spawn(browser,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore',windowsHide:true,env:{...process.env,TEMP:profile,TMP:profile}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let socket,id=0;const pending=new Map(),errors=[],checks=[];
try{
 let port;for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await pause(100);}}
 const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const page=pages.find(p=>p.type==='page'&&p.url==='about:blank');assert.ok(page,'isolated browser page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);else if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject,timer:setTimeout(()=>reject(Error(method+' timeout')),15000)});socket.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100);}throw Error('UI_TIMEOUT: '+expression+' '+JSON.stringify({errors,text:await evaluate('document.body.innerText.slice(0,2000)')}));};
 const check=(name,value)=>{assert.ok(value,name);checks.push({name,status:'PASS'});};
 const click=async text=>{assert.ok(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`),'button '+text);};
 await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const navigation=await send('Page.navigate',{url:origin});assert.ok(!navigation.errorText,navigation.errorText);await wait("!!document.querySelector('#role-select')");
 await click('Intelligence');await wait("!!document.querySelector('[data-kpi=intTotal]')");
 for(const path of ['/data-science/artifacts/v0.2/model.json','/data-science/artifacts/v0.2/intelligence-result.json','/data-science/artifacts/v0.2/dataset.csv']){
  const response=await fetch(origin+path);assert.equal(response.status,403,'private analytical file must be denied: '+path);
 }
 check('raw files and model bypass denied',true);
 check('synthetic pipeline loads natively',await evaluate("document.querySelector('[data-kpi=intTotal]').textContent==='2,885'||document.querySelector('[data-kpi=intTotal]').textContent==='2885'||document.querySelector('[data-kpi=intTotal]').textContent==='2.885'"));
 check('five health states and native tables',await evaluate("document.querySelectorAll('.int-health').length>5&&document.querySelectorAll('.int-panel table').length>=6"));
 await evaluate("document.querySelector('#int-workspaces .int-link').click()");await wait("!!document.querySelector('dialog[open]')");check('workspace detail opens',await evaluate("document.querySelector('dialog').textContent.includes('workspace_')"));
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait("!document.querySelector('dialog[open]')");
 await click('Detalles');await wait("!!document.querySelector('dialog[open]')");check('Why Flagged exposes three detector scores',await evaluate("['IF','MAD','IQR'].every(s=>document.querySelector('dialog').textContent.includes(s))"));await click('Cerrar detalles');
 const setSelect=async(label,value)=>evaluate(`(()=>{const s=document.querySelector('select[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await setSelect('Cuenta','account_demo_c');await wait("document.querySelector('[data-kpi=intTotal]').textContent==='5'");check('account filter and insufficient data',await evaluate("document.querySelector('.int-kpis').textContent.includes('Datos insuficientes')"));
 await setSelect('Resultado','failure');await wait("document.querySelector('[data-kpi=intTotal]').textContent==='0'");check('empty filter state',await evaluate("document.body.textContent.includes('Ninguna ejecución')"));
 await click('Restablecer filtros');
 await evaluate("document.querySelector('.language-button').click()");
 await wait("document.body.textContent.includes('Synthetic academic dataset')");check('English model results',await evaluate("document.body.textContent.includes('Precision')&&document.body.textContent.includes('Recall')&&document.body.textContent.includes('MAD')"));
 await mkdir(resolve('docs/data-science/evidence'),{recursive:true});
 for(const width of [1440,768,390]){await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await pause(200);check('responsive '+width,await evaluate('document.documentElement.scrollWidth<=innerWidth'));if(width===1440){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(resolve('docs/data-science/evidence/intelligence-dashboard.png'),Buffer.from(shot.data,'base64'));}}
 await evaluate("(()=>{const s=document.querySelector('#role-select');s.value='artist';s.dispatchEvent(new Event('change',{bubbles:true}));})()");await pause(200);
 check('artist navigation and content denied',await evaluate("![...document.querySelectorAll('.nav-item')].some(b=>b.textContent.includes('Intelligence'))&&!document.querySelector('[data-kpi=intTotal]')"));
 const expectedBridgeUnavailable=errors.filter(e=>e.url==='http://127.0.0.1:4317/v1/health'&&e.text==='Failed to load resource: net::ERR_CONNECTION_REFUSED');
 const unexpected=errors.filter(e=>!expectedBridgeUnavailable.includes(e));
 check('no browser exceptions or unexpected errors',unexpected.length===0);
 await writeFile(resolve('docs/data-science/evidence/browser-checks.json'),JSON.stringify({origin,checks,exceptions:unexpected,expectedBridgeUnavailable:expectedBridgeUnavailable.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,results:checks},null,2));
}finally{socket?.close();child.kill();for(const p of pending.values())clearTimeout(p.timer);}
