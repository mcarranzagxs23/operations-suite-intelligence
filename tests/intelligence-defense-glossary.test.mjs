import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const digest=async path=>createHash('sha256').update(await readFile(new URL(path,import.meta.url))).digest('hex').toUpperCase();
const glossary=await read('../src/views/DefenseGlossary.jsx');
const dashboard=await read('../src/views/IntelligenceCenter.jsx');
const styles=await read('../src/views/intelligence.css');

test('defense glossary covers every required scientific term in Spanish and English',()=>{
  const terms=['KPI','Dataset','Dataset sintético','Pipeline','ETL','EDA','Anomalía','Fallo','Referencia','Período actual','Mediana','P95','Health Score','Outcome Health','Anomaly Health','Processing Health','Trend Health','Severity / Severidad','Score','Threshold / Umbral','Isolation Forest','Machine Learning no supervisado','MAD','IQR','Precision','Recall','F1','TP','FP','TN','FN','Train','Calibration / Calibración','Test','Baseline','Feature','Priority Queue','Normalización','Result Contract','Why Flagged','UTC'];
  for(const term of terms)assert.ok(glossary.includes(`'${term}'`),term);
  assert.match(glossary,/esSimple/);
  assert.match(glossary,/enSimple/);
  assert.match(glossary,/Comportamiento inusual frente a una referencia\. No significa necesariamente fallo\./);
  assert.match(glossary,/proportion that truly was anomalous/i);
});

test('glossary is an accessible auxiliary dialog with immediate text and category filters',()=>{
  assert.match(glossary,/node\.showModal\(\)/);
  assert.match(glossary,/aria-modal="true"/);
  assert.match(glossary,/onCancel=\{event=>\{event\.preventDefault\(\);onClose\(\);\}\}/);
  assert.match(glossary,/event\.key!=='Tab'/);
  assert.match(glossary,/origin\.focus\(\{preventScroll:true\}\)/);
  assert.match(glossary,/value=\{query\} onChange/);
  assert.match(glossary,/aria-pressed=\{category===key\}/);
  assert.match(glossary,/item\.term,item\.category,\.\.\.item\.aliases,copy\.simple,copy\.purpose/);
  assert.match(styles,/\.int-glossary \{ width: min\(980px, calc\(100vw - 32px\)\); max-width: 980px; max-height: min\(820px, calc\(100vh - 28px\)\); \}/);
  assert.match(styles,/\.int-dialog-head \{ position: sticky; top: 0;/);
});

test('guided defense aids can collapse and preserve their session-only state',()=>{
  for(const section of ['overview','health','anomaly','priority','models','conclusion'])assert.match(dashboard,new RegExp(`<DefenseAid section="${section}" language=\\{language\\}/>`));
  assert.match(glossary,/sessionStorage\.getItem\(key\)/);
  assert.match(glossary,/sessionStorage\.setItem\(key/);
  assert.match(glossary,/aria-expanded=\{open\}/);
  assert.match(glossary,/No determina la causa\./);
  assert.match(glossary,/No necesariamente significa que la ejecución falló\./);
  assert.match(glossary,/No significa que MAD sea universalmente mejor/);
});

test('conclusion always exposes the optional defense glossary without adding a seventh step',()=>{
  assert.match(dashboard,/data-action="open-defense-glossary"/);
  assert.match(dashboard,/Abrir glosario de defensa/);
  assert.match(dashboard,/<DefenseGlossary language=\{language\} onClose=\{\(\)=>setGlossary\(false\)\}/);
  const steps=[...dashboard.matchAll(/\{id:'(\w+)',target:'[\w-]+'\}/g)].map(match=>match[1]);
  assert.deepEqual(steps,['overview','health','anomaly','priority','models','conclusion']);
});

test('the defense UX leaves every versioned scientific artifact byte-identical',async()=>{
  const expected={
    'dataset.csv':'E7C34C62B4D7E2E67D0C106088AB85781A9AA61750BC087A2B88A2A2449C5423',
    'eda.json':'8BEF1CBC0F9C5D77D53E087DC0413A746588042B9A44476EF32D2B122CB025E5',
    'intelligence-result.json':'20556768F828DDD4E0AF510675E0CFEB951C51444AD46A7FD9544248846D3012',
    'manifest.json':'D137712B04795B532C4B7B2F33748A4078943733FACA7B87DDAF1E45D2369751',
    'metrics.json':'6B1020F306D65712DE21064DDC3C4D3CD4C3C72F8A1D72AA4EBDB3F9797AD691',
    'model.json':'2A68572001DD5AC5DFBFE3C0F7CE6897D9298E3D0FBEB4086C4C84566E508991',
    'processed.csv':'6C4E73487C511310FFEF50B9987494DC09A9A4CE3CF7974DAE425B803A71E865',
    'quality.json':'A7B109932B848CDDDDA86ED86CD04922B1110E480FA232B9DFA578B573A1C41A',
    'reference-validation.json':'AD5FF7AE409D3F7DEE2AA78C44F02AED690EB55B0B5C4651073F51D605F2B386',
    'scored.json':'E7F51EBCEC87B53C05C1431D5020C16277C72C3AE4F76C4AA35776EF14427BCE',
  };
  for(const [name,hash] of Object.entries(expected))assert.equal(await digest(`../data-science/artifacts/v0.2/${name}`),hash,name);
});
