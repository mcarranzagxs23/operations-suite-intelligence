import {Component,useEffect,useId,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {intelligenceServiceMode,loadIntelligence} from '../services/intelligence-service.js';
import {assertIntelligenceSession,projectIntelligence} from '../selectors/intelligence-projection.js';
import {keyOf} from '../intelligence/analysis.js';
import {buildConclusion,filterImpact,periodComparison,previousPeriodFilters,selectPriorityWorkspace,selectSpotlightAnomaly,summarizeView} from '../intelligence/presentation.js';
import {HealthBadge,Id,SeverityBadge,Signals,Timestamp,day,number,percent,prefersReducedMotion,seconds,signed,useAnimatedNumber,useChangePulse} from './IntelligenceParts.jsx';
import {HealthExplorer,ModelLab,ModelLabSpotlight,WhyFlagged} from './IntelligenceInsights.jsx';
import {DefenseAid,DefenseGlossary} from './DefenseGlossary.jsx';
import './intelligence.css';

export {HealthBadge} from './IntelligenceParts.jsx';

/** The guided walkthrough of defense mode: each step scrolls to a section, nothing else. */
const STEPS=Object.freeze([
  {id:'overview',target:'int-step-overview'},
  {id:'health',target:'int-step-health'},
  {id:'anomaly',target:'int-anomalies'},
  {id:'priority',target:'int-priority'},
  {id:'models',target:'int-step-models'},
  {id:'conclusion',target:'int-step-conclusion'},
]);

/** Scroll a section under the sticky top bar, mark it briefly, and move focus to its heading. */
function scrollToSection(id) {
  const section=document.getElementById(id);
  if(!section)return;
  const offset=(document.querySelector('.topbar')?.getBoundingClientRect().height??0)+12;
  window.scrollTo({top:section.getBoundingClientRect().top+window.scrollY-offset,behavior:prefersReducedMotion()?'auto':'smooth'});
  section.classList.remove('is-arrived');
  void section.offsetWidth;
  section.classList.add('is-arrived');
  setTimeout(()=>section.classList.remove('is-arrived'),1400);
  const heading=section.querySelector('h2,h3');
  if(heading){if(!heading.hasAttribute('tabindex'))heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
}

function Table({id,title,rows,columns,t,level=2,onActivate,rowClass,actions,note}) {
  const [page,setPage]=useState(0),[sort,setSort]=useState(null);
  useEffect(()=>setPage(0),[rows,sort]);
  const ordered=useMemo(()=>!sort?rows:[...rows].sort((a,b)=>{
    const av=columns[sort.index].value(a),bv=columns[sort.index].value(b);
    return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av??'').localeCompare(String(bv??'')))*sort.direction;
  }),[rows,sort,columns]);
  const pages=Math.max(1,Math.ceil(rows.length/15)),current=Math.min(page,pages-1);
  const kind=c=>c.kind?'int-'+c.kind:undefined,Heading='h'+level,headingId=id?id+'-title':undefined;
  // A row is a large click target for the pointer; its identifier button is the keyboard route. Clicks on controls inside the row are theirs.
  const activate=(event,row)=>{if(onActivate&&!event.target.closest('button,a,input,select,summary,label'))onActivate(row);};
  return <section id={id} className="int-panel int-table-panel" aria-labelledby={headingId}>
    <div className="int-section-head"><Heading id={headingId}>{title}</Heading>{actions&&<div className="int-section-actions">{actions}</div>}</div>
    {note&&<p className="int-note">{note}</p>}
    {/* The frame is focusable so a keyboard can scroll a table wider than the screen. */}
    <div className="int-table-wrap" tabIndex={0} role="region" aria-label={title}><table><caption>{t('intRows',{count:rows.length})}</caption>
      <thead><tr>{columns.map((c,i)=><th key={c.label} scope="col" className={kind(c)} aria-sort={sort?.index===i?(sort.direction===1?'ascending':'descending'):'none'}><button type="button" onClick={()=>setSort({index:i,direction:sort?.index===i?-sort.direction:1})}>{t(c.label)}</button></th>)}</tr></thead>
      <tbody>{ordered.slice(current*15,current*15+15).map((r,i)=><tr key={r.key||r.execution_id||i} className={[onActivate&&'is-interactive',rowClass?.(r)].filter(Boolean).join(' ')||undefined} onClick={e=>activate(e,r)}>
        {columns.map(c=><td key={c.label} className={kind(c)}>{c.render?c.render(r):c.value(r)??'—'}</td>)}
      </tr>)}</tbody>
    </table></div>
    {!rows.length&&<p role="status">{t('intEmpty')}</p>}
    <div className="int-pagination"><button type="button" disabled={!current} onClick={()=>setPage(current-1)}>{t('intPrevious')}</button><span>{t('intPage',{page:current+1,pages})}</span><button type="button" disabled={current+1>=pages} onClick={()=>setPage(current+1)}>{t('intNext')}</button></div>
  </section>;
}

/**
 * A weekly series. Hovering, or arrow keys on the focused plot, reads one
 * point aloud in the line under it; clicking or Enter opens the data table.
 * Bars grow from their previous height when a filter changes.
 */
function TrendChart({points,field,title,t,language,thresholds}) {
  const [hovered,setActive]=useState(null),[open,setOpen]=useState(false),readoutId=useId();
  const rate=field.endsWith('_rate');
  const format=v=>rate?percent(v,language):field==='duration_median'?seconds(v,language):number(v,language);
  const indexes=points.map((p,i)=>p[field]==null?null:i).filter(i=>i!=null);
  const max=field==='health'?100:Math.max(rate?1e-6:1,...indexes.map(i=>points[i][field]));
  const width=440,base=112,span=100,step=width/Math.max(1,points.length);
  // A shorter period has fewer weeks: an index read before the change may no longer exist.
  const active=indexes.includes(hovered)?hovered:null;
  useEffect(()=>setActive(null),[points]);
  const move=key=>{
    if(!indexes.length)return;
    const at=indexes.indexOf(active);
    const next=key==='Home'?indexes[0]:key==='End'?indexes.at(-1):key==='ArrowRight'?indexes[Math.min(indexes.length-1,at+1)]:indexes[Math.max(0,at===-1?indexes.length-1:at-1)];
    setActive(next);
  };
  const onKeyDown=event=>{
    if(['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){event.preventDefault();move(event.key);}
    else if(event.key==='Enter'||event.key===' '){event.preventDefault();setOpen(o=>!o);}
  };
  const readout=active==null?t('intChartHint'):t('intChartPoint',{date:day(points[active].start),value:format(points[active][field])})+(field==='health'&&points[active].health_status?' · '+t('intState_'+points[active].health_status):'');
  return <section className="int-panel int-chart" data-chart={field}>
    <h3>{title}</h3>
    {!indexes.length?<p>{t('intNoChart')}</p>:<>
      <div className="int-chart-plot" tabIndex={0} role="group" aria-label={title} aria-describedby={readoutId} onKeyDown={onKeyDown} onPointerLeave={()=>setActive(null)} onClick={()=>setOpen(o=>!o)}>
        <svg viewBox={`0 0 ${width} 124`} aria-hidden="true" focusable="false">
          {thresholds&&['healthy','monitor','high_risk'].map(s=><g key={s} className={'int-chart-threshold int-'+s}><line x1="0" x2={width} y1={base-thresholds[s]/100*span} y2={base-thresholds[s]/100*span}/><text x={width-2} y={base-thresholds[s]/100*span-3} textAnchor="end">{thresholds[s]}</text></g>)}
          <line className="int-chart-axis" x1="0" x2={width} y1={base} y2={base}/>
          {points.map((p,i)=>p[field]==null?null:<rect key={p.start} x={i*step+2} y={base-span} width={Math.max(1,step-4)} height={span}
            className={'int-chart-bar'+(field==='health'&&p.health_status?' is-'+p.health_status:'')+(i===active?' is-active':'')}
            style={{transform:`scaleY(${Math.max(0,p[field]/max)})`}} onPointerEnter={()=>setActive(i)}/>)}
        </svg>
      </div>
      <p id={readoutId} className="int-chart-readout" aria-live="polite">{readout}</p>
      <details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{t('intChartData')}</summary><table><thead><tr><th>{t('intChartLabel')}</th><th>{t('intChartValue')}</th></tr></thead><tbody>{points.map(p=><tr key={p.start}><td>{p.start.slice(0,10)}</td><td>{format(p[field])}</td></tr>)}</tbody></table></details>
    </>}
  </section>;
}

/** A headline figure that counts to its new value and pulses when a filter moves it. */
function Kpi({id,label,value,format,integer,badge,onActivate,actionLabel}) {
  const shown=useAnimatedNumber(value,{integer}),pulse=useChangePulse(value);
  const body=<><span className="int-kpi-label">{label}</span><strong data-kpi={id}>{format(shown)}</strong>{badge}
    {onActivate&&<><span className="int-kpi-go" aria-hidden="true">→</span><span className="int-sr">{actionLabel}</span></>}</>;
  const className='int-kpi'+(pulse?' is-updated':'')+(onActivate?' is-action':'');
  return onActivate?<button type="button" className={className} onClick={onActivate} data-kpi-action={id}>{body}</button>:<article className={className}>{body}</article>;
}

/** Before → after of the last filter change; opens large, and the presenter can compact it into a strip. */
function FilterImpact({impact,open,onToggle,onDismiss,t,language}) {
  const format=(id,v)=>id==='successRate'?percent(v,language):id==='median'?seconds(v,language):number(v,language);
  const spoken=impact.items.map(i=>t('intImpact_'+i.id)+' '+format(i.id,i.from)+' '+t('intTo')+' '+format(i.id,i.to)).join('; ');
  return <section className={'int-impact'+(open?' is-open':'')} aria-labelledby="int-impact-title" data-impact>
    <div className="int-impact-head">
      <h2 id="int-impact-title"><span aria-hidden="true">◆</span> {t('intImpactTitle')}</h2>
      <span className="int-impact-scope">{t('intRecalculated',{count:number(impact.after.executions,language)})}</span>
      <button type="button" aria-expanded={open} onClick={onToggle}>{t(open?'intImpactCollapse':'intImpactExpand')}</button>
      <button type="button" className="int-icon-button" aria-label={t('intImpactDismiss')} onClick={onDismiss}>✕</button>
    </div>
    <ul className="int-impact-items">{impact.items.map(i=><li key={i.id} className={i.changed?'is-changed':undefined} data-impact-field={i.id}>
      <span>{t('intImpact_'+i.id)}</span>
      <strong><span data-from>{format(i.id,i.from)}</span> <span aria-hidden="true">→</span><span className="int-sr"> {t('intTo')} </span> <span data-to>{format(i.id,i.to)}</span></strong>
    </li>)}</ul>
    {open&&<p className="int-note">{t('intImpactNote')}</p>}
    <p className="int-sr" role="status">{t('intImpactTitle')}. {spoken}.</p>
  </section>;
}

function PeriodComparison({rows,current,previousFilters,result,t,language}) {
  const format=(id,v)=>id==='health'||id==='executions'?number(v,language):id==='median'?seconds(v,language):percent(v,language);
  const delta=(id,v)=>signed(v,a=>id==='health'||id==='executions'?number(a,language):id==='median'?number(a,language)+' s':number(a*100,language)+' pp');
  if(!previousFilters)return <section className="int-panel int-period" aria-labelledby="int-period-title" data-period-comparison="unavailable"><h2 id="int-period-title">{t('intCompareTitle')}</h2><p className="int-note">{t('intCompareUnavailable')}</p></section>;
  return <section className="int-panel int-period" aria-labelledby="int-period-title" data-period-comparison>
    <h2 id="int-period-title">{t('intCompareTitle')}</h2>
    <p>{t('intCompareRanges',{current:day(current.period_start)+' → '+day(current.period_end),previous:previousFilters.start+' → '+previousFilters.end})}</p>
    <div className="int-scroll-x"><table className="int-compare">
      <thead><tr><th scope="col">{t('intMetric')}</th><th scope="col" className="int-num">{t('intCurrent')}</th><th scope="col" className="int-num">{t('intPreviousPeriod')}</th><th scope="col" className="int-num">{t('intDelta')}</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.id} data-period-field={r.id}><th scope="row">{t('intCompare_'+r.id)}</th><td className="int-num">{format(r.id,r.current)}</td><td className="int-num">{format(r.id,r.previous)}</td><td className="int-num">{delta(r.id,r.delta)}</td></tr>)}</tbody>
    </table></div>
    <p className="int-note">{t('intCompareSameReference',{start:day(result.metadata.reference_start),end:day(result.metadata.reference_end)})}</p>
  </section>;
}

/**
 * The presenter's dock, rendered into <body>: the page's entrance animation
 * leaves an identity transform on the view, and any transform on an ancestor
 * would pin a fixed element to that ancestor instead of to the screen.
 */
function DefenseDock({active,mode,t,onExit}) {
  return createPortal(<nav className="int-dock" aria-label={t('intDefenseSteps')}>
    <span className="int-dock-badge" data-dock-origin><span aria-hidden="true">◆</span> {t(mode==='ACADEMIC_SYNTHETIC'?'intAcademic':'intControlled')}</span>
    <ol className="int-dock-steps">{STEPS.map((s,i)=><li key={s.id}><button type="button" aria-current={active===s.id?'step':undefined} data-step={s.id} onClick={()=>scrollToSection(s.target)}><span className="int-dock-num" aria-hidden="true">{i+1}</span> {t('intStep_'+s.id)}</button></li>)}</ol>
    <button type="button" className="int-dock-exit" onClick={onExit}>{t('intDefenseExit')}</button>
  </nav>,document.body);
}

export function IntelligenceDashboard({result,session,t,language,defenseMode,onDefenseModeChange}) {
  const [filters,setFilters]=useState({period:'90'});
  const [explorer,setExplorer]=useState(null),[why,setWhy]=useState(null),[labSpotlight,setLabSpotlight]=useState(false);
  const [glossary,setGlossary]=useState(false);
  const [localDefense,setLocalDefense]=useState(false);
  const defense=defenseMode??localDefense,setDefense=onDefenseModeChange??setLocalDefense;
  const [compare,setCompare]=useState(false),[activeStep,setActiveStep]=useState(STEPS[0].id);
  const [focus,setFocus]=useState(()=>result.metadata.model_selection?.[0]?.decision_detector??'MAD');
  const [impactBase,setImpactBase]=useState(null),[impactOpen,setImpactOpen]=useState(false);
  const mode=result.metadata.mode;

  const view=useMemo(()=>projectIntelligence(result,filters,session),[result,filters,session]);
  const previousFilters=useMemo(()=>previousPeriodFilters(filters,result.metadata),[filters,result.metadata]);
  const previousView=useMemo(()=>compare&&previousFilters?projectIntelligence(result,previousFilters,session):null,[compare,previousFilters,result,session]);
  const spotlight=useMemo(()=>selectSpotlightAnomaly(view.anomalies),[view.anomalies]);
  const priorityWorkspace=useMemo(()=>selectPriorityWorkspace(view.priorityQueue),[view.priorityQueue]);
  const conclusion=useMemo(()=>buildConclusion(view,result.metadata),[view,result.metadata]);

  // Before → after for every filter change, from the projection itself. The
  // "before" is captured in the same event that changes the filters, so the
  // new view renders once, already with its impact: no effect re-renders the
  // whole dashboard afterwards, while the KPIs are counting. It stays open
  // until the presenter compacts or hides it: shrinking on a timer would move
  // everything below it, possibly in the middle of a scroll to a section.
  const summary=useMemo(()=>summarizeView(view),[view]);
  const impact=useMemo(()=>impactBase&&{before:impactBase,after:summary,items:filterImpact(impactBase,summary)},[impactBase,summary]);

  // The step whose section has reached the upper part of the screen.
  useEffect(()=>{
    if(!defense)return undefined;
    let frame=0;
    const track=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      const line=(document.querySelector('.topbar')?.getBoundingClientRect().bottom??0)+window.innerHeight*.28;
      let current=STEPS[0].id;
      for(const s of STEPS){const el=document.getElementById(s.target);if(el&&el.getBoundingClientRect().top<=line)current=s.id;}
      if(window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-4)current=STEPS.at(-1).id;
      setActiveStep(current);
    });};
    track();
    window.addEventListener('scroll',track,{passive:true});
    window.addEventListener('resize',track);
    return ()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',track);window.removeEventListener('resize',track);};
  },[defense]);

  const n=v=>number(v,language),pct=v=>percent(v,language);
  const m=view.globalHealth.metrics;
  const risk=rows=>rows.filter(r=>['high_risk','critical'].includes(r.health_status)).length;
  const closeDetails=()=>{setExplorer(null);setWhy(null);};
  const changeFilters=next=>{closeDetails();setImpactBase(summary);setImpactOpen(true);setFilters(next);};
  const update=(name,value)=>changeFilters(f=>({...f,[name]:value,...(name==='account'?{workspace:'',device:''}:name==='workspace'?{device:''}:{})}));
  const filterToEntity=entity=>{
    const next={period:filters.period||'90'};
    if(entity.account_id)next.account=entity.account_id;
    if(entity.entity_type==='workspace')next.workspace=entity.key;
    if(entity.entity_type==='device'){next.workspace=keyOf(entity.account_id,entity.workspace_id);next.device=entity.key;}
    if(entity.entity_type==='tool')next.tool=entity.entity_id;
    changeFilters(next);
    requestAnimationFrame(()=>scrollToSection('int-step-overview'));
  };
  const entities=name=>result[name].filter(r=>!filters.account||r.account_id===filters.account).filter(r=>name!=='devices'||!filters.workspace||keyOf(r.account_id,r.workspace_id)===filters.workspace);
  const select=(name,label,options)=><label key={name}>{t(label)}<select aria-label={t(label)} value={filters[name]||''} onChange={e=>update(name,e.target.value)}>{options.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>;
  const all=options=>[['',t('intAll')],...options];

  const col=(label,value,render,kind)=>({label,value,render,kind});
  const metric=(label,key)=>col(label,r=>r.metrics[key],r=>pct(r.metrics[key]),'num');
  const id=(label,field)=>col(label,r=>r[field],r=><Id value={r[field]}/>);
  const identity=label=>col(label,r=>r.entity_id,r=><button type="button" className="int-link" title={r.entity_id} aria-label={t('intExploreEntity',{id:r.entity_id})} onClick={()=>setExplorer(r)}><span className="int-id">{r.entity_id}</span></button>);
  const health=[col('intHealth',r=>r.health_score,r=>n(r.health_score),'num'),col('intHealthStatus',r=>r.health_status,r=><HealthBadge entity={r} t={t}/>)];
  const rates=[col('intTotal',r=>r.sample_size,r=>n(r.sample_size),'num'),metric('intSuccess','successRate'),metric('intAnomalyRate','anomalyRate'),metric('intFailureRate','failureRate'),metric('intCancellationRate','cancellationRate'),col('intMedian',r=>r.metrics.duration.median,r=>seconds(r.metrics.duration.median,language),'num')];
  const trend=col('intTrend',r=>r.health_components.trend,r=>n(r.health_components.trend),'num'),rank=col('intRank',r=>r.priority,null,'num');

  const priorityButton=<button type="button" className="int-primary" disabled={!priorityWorkspace} title={t(priorityWorkspace?'intPriorityWorkspaceNote':'intNoPriorityWorkspace')} onClick={()=>priorityWorkspace&&setExplorer(priorityWorkspace)} data-action="priority-workspace"><span aria-hidden="true">◎</span> {t('intPriorityWorkspace')}</button>;
  const spotlightButton=<button type="button" className="int-primary" disabled={!spotlight} title={t(spotlight?'intSpotlightPolicy':'intNoAnomalies')} onClick={()=>spotlight&&setWhy(spotlight)} data-action="spotlight-anomaly"><span aria-hidden="true">✦</span> {t('intSpotlightAnomaly')}</button>;
  const kpis=[
    {id:'intGlobal',value:view.globalHealth.health_score,format:n,badge:<HealthBadge entity={view.globalHealth} t={t}/>,onActivate:()=>setExplorer(view.globalHealth),actionLabel:t('intOpenHealthExplorer')},
    {id:'intTotal',value:m.total,format:n,integer:true},
    {id:'intSuccess',value:m.successRate,format:pct},
    {id:'intAnomalies',value:m.anomalies,format:n,integer:true,target:'int-anomalies'},
    {id:'intHigh',value:m.highSeverity,format:n,integer:true,target:'int-anomalies'},
    {id:'intMedian',value:m.duration.median??null,format:v=>seconds(v,language)},
    {id:'intAccountsRisk',value:risk(view.accounts),format:n,integer:true,target:'int-accounts'},
    {id:'intWorkspacesRisk',value:risk(view.workspaces),format:n,integer:true,target:'int-workspaces'},
    {id:'intDevicesRisk',value:risk(view.devices),format:n,integer:true,target:'int-devices'},
    {id:'intToolsRisk',value:risk(view.tools),format:n,integer:true,target:'int-tools'},
  ];
  const decisionText=conclusion.decisionMetrics.map(d=>d.id).join(' / ');

  return <div className={'intelligence-center'+(defense?' is-defense':'')}>
    <header className="int-header">
      <div><div className="eyebrow">{t('intTitle')}</div><h1>{t('intTitle')}</h1><p>{t('intSubtitle')}</p></div>
      <button type="button" className="int-defense-toggle" aria-pressed={defense} onClick={()=>setDefense(!defense)} data-action="defense-mode"><span aria-hidden="true">{defense?'■':'▶'}</span> {t('intDefenseMode')}</button>
    </header>
    <section className="sample-banner"><div><strong>{t(mode==='ACADEMIC_SYNTHETIC'?'intAcademic':'intControlled')}</strong><p>{t(mode==='ACADEMIC_SYNTHETIC'?'intAcademicMode':'intTransfer')}</p><p>{t('intSourceNote')}</p></div></section>
    {defense&&<section className="int-defense-intro" aria-label={t('intDefenseActive')}>
      <p><strong>{t('intDefenseActive')}</strong> — {t('intDefenseHint')}</p>
      <ul><li>{t('intService_'+intelligenceServiceMode)}</li><li>{t('intBridgeNotRequired')}</li></ul>
    </section>}

    <section id="int-step-overview" className="int-overview" aria-labelledby="int-step-overview-title">
      <h2 id="int-step-overview-title" className="int-sr">{t('intStep_overview')}</h2>
      {defense&&<DefenseAid section="overview" language={language}/>}
      <section className="int-panel int-filters-panel" aria-labelledby="int-filters-title"><h3 id="int-filters-title">{t('intFilters')}</h3><div className="int-filters">
        {select('period','intPeriod',[['today',t('intToday')],...['7','30','90'].map(d=>[d,t('intDays',{days:d})])])}
        {select('account','intAccount',all(result.accounts.map(r=>[r.account_id,r.account_id])))}
        {select('workspace','intWorkspace',all(entities('workspaces').map(r=>[r.key,r.account_id+' / '+r.entity_id])))}
        {select('device','intDevice',all(entities('devices').map(r=>[r.key,r.account_id+' / '+r.entity_id])))}
        {select('tool','intTool',all(result.filtersMetadata.tools.map(v=>[v,v])))}
        {select('platform','intPlatform',all(result.filtersMetadata.platforms.map(v=>[v,v])))}
        {select('status','intStatus',all(['success','failure','cancelled'].map(v=>[v,t('intOutcome_'+v)])))}
        {select('severity','intSeverity',all(['none','low','medium','high','critical'].map(v=>[v,t('intSeverity_'+v)])))}
        {select('detector','intDetector',[['',t('intDecision')],...['IF','MAD','IQR'].map(v=>[v,v])])}
      </div>
        <div className="int-filter-actions">
          <button type="button" onClick={()=>changeFilters({period:'90'})}>{t('intReset')}</button>
          <button type="button" aria-pressed={compare} onClick={()=>setCompare(v=>!v)} data-action="compare-period"><span aria-hidden="true">⇄</span> {t('intComparePrevious')}</button>
        </div>
        <p>{t('intDateAnchor',{date:result.metadata.period_end.slice(0,10)})}</p><p>{t('intFilterCohort')}</p>
        {filters.detector&&<p className="int-note int-note--warn"><span className="int-chip int-chip--warn">{t('intComparisonOnly')}</span> {t('intComparisonMode')} {t('intComparisonProjection',{detector:filters.detector})}</p>}
      </section>
      {impact&&<FilterImpact impact={impact} open={impactOpen} onToggle={()=>setImpactOpen(v=>!v)} onDismiss={()=>setImpactBase(null)} t={t} language={language}/>}
      {compare&&<PeriodComparison rows={previousView?periodComparison(view,previousView):[]} current={view.metadata} previousFilters={previousFilters} result={result} t={t} language={language}/>}
      {view.empty&&<p role="status">{t('intEmpty')}</p>}{!result.metadata.complete&&<p role="status">{t('intPartial')}</p>}
      <section className="int-kpis" aria-label={t('intOverview')}>{kpis.map(k=><Kpi key={k.id} {...k} label={t(k.id)}
        onActivate={k.onActivate??(k.target?()=>scrollToSection(k.target):undefined)} actionLabel={k.actionLabel??(k.target?t('intGoToSection',{section:t(k.target==='int-anomalies'?'intAnomalies':k.target==='int-accounts'?'intAccounts':k.target==='int-workspaces'?'intWorkspaces':k.target==='int-devices'?'intDevices':'intTools')}):undefined)}/>)}</section>
      {view.globalHealth.health_status==='insufficient_data'&&<p role="status">{t('intInsufficient')}</p>}
    </section>

    <section id="int-step-health" className="int-group" aria-labelledby="int-step-health-title">
      <div className="int-section-head"><div><div className="eyebrow">{t('intStep_health')}</div><h2 id="int-step-health-title">{t('intHealthByEntity')}</h2></div><div className="int-section-actions">{priorityButton}</div></div>
      {defense&&<DefenseAid section="health" language={language}/>}
      <p className="int-note">{t('intRowHint')}</p>
      <Table id="int-accounts" level={3} title={t('intAccounts')} rows={view.accounts} onActivate={setExplorer} columns={[identity('intAccount'),...health,...rates,trend,rank]} t={t}/>
      <Table id="int-workspaces" level={3} title={t('intWorkspaces')} rows={view.workspaces} onActivate={setExplorer} columns={[id('intAccount','account_id'),identity('intWorkspace'),...health,...rates,trend,rank]} t={t}/>
      <Table id="int-devices" level={3} title={t('intDevices')} rows={view.devices} onActivate={setExplorer} columns={[id('intAccount','account_id'),identity('intDevice'),id('intWorkspace','workspace_id'),col('intPlatform',r=>r.platform),...health,...rates,trend,col('intLatest',r=>r.latest_activity,r=><Timestamp value={r.latest_activity}/>),col('intSignals',r=>r.reasons.map(x=>x.code).join(),r=><Signals entity={r} t={t}/>),rank]} t={t}/>
      <Table id="int-tools" level={3} title={t('intTools')} rows={view.tools} onActivate={setExplorer} columns={[id('intAccount','account_id'),identity('intTool'),col('intToolAction',r=>r.action),col('intVersion',r=>r.tool_version),...health,...rates,col('intP95',r=>r.metrics.duration.p95,r=>seconds(r.metrics.duration.p95,language),'num'),trend,rank]} t={t}/>
    </section>

    <section className="int-defense-section" aria-labelledby="int-anomalies-title"><div className="int-sr" id="int-anomalies-title">{t('intStep_anomaly')}</div>{defense&&<DefenseAid section="anomaly" language={language}/>}<Table id="int-anomalies" title={t('intAnomalies')} rows={view.anomalies} onActivate={setWhy} actions={spotlightButton} note={t('intSpotlightPolicy')} t={t} columns={[
      col('intTimestamp',r=>r.completed_at,r=><Timestamp value={r.completed_at}/>),
      id('intAccount','account_id'),id('intWorkspace','workspace_id'),id('intDevice','device_id'),
      col('intTool',r=>r.tool_id+' · '+r.action,r=><span title={r.tool_id+' · '+r.action+' · '+r.tool_version}>{r.tool_id} · {r.action}</span>),
      col('intStatus',r=>r.status,r=>t('intOutcome_'+r.status)),
      col('intDuration',r=>r.duration_seconds,r=>seconds(r.duration_seconds,language),'num'),col('intReference',r=>r.reference_median,r=>seconds(r.reference_median,language),'num'),col('intP95',r=>r.reference_p95,r=>seconds(r.reference_p95,language),'num'),
      col('intDetector',r=>r.decision_detector),col('intSeverity',r=>r.severity,r=><SeverityBadge severity={r.severity} t={t}/>),
      col('intWhy',r=>r.execution_id,r=><button type="button" onClick={()=>setWhy(r)} aria-label={t('intDetailsFor',{id:r.execution_id})}>{t('intDetails')}</button>)]}/></section>

    <section className="int-defense-section" aria-labelledby="int-priority-title"><div className="int-sr" id="int-priority-title">{t('intStep_priority')}</div>{defense&&<DefenseAid section="priority" language={language}/>}<Table id="int-priority" title={t('intPriority')} rows={view.priorityQueue} onActivate={setExplorer} actions={priorityButton} t={t} columns={[rank,identity('intEntity'),col('intType',r=>r.entity_type,r=>t('intType_'+r.entity_type)),id('intAccount','account_id'),...health,metric('intAnomalyRate','anomalyRate'),metric('intFailureRate','failureRate'),trend,
      col('intWhy',r=>r.recommended_action,r=><button type="button" onClick={()=>setExplorer(r)} aria-label={t('intDetailsFor',{id:r.entity_id})}>{t('intDetails')}</button>)]}/></section>

    <section id="int-trends" aria-labelledby="int-trends-title"><h2 id="int-trends-title">{t('intTrends')}</h2><div className="int-charts">{[['health','intHealthTime'],['anomaly_rate','intAnomalyTime'],['failure_rate','intFailureTime'],['cancellation_rate','intCancellationRate'],['duration_median','intDurationTime'],['total','intExecutionsTime']].map(([field,key])=>
      <TrendChart key={field} points={view.trends} field={field} title={t(key)} t={t} language={language} thresholds={field==='health'?result.metadata.health_policy?.thresholds:null}/>)}</div></section>

    <section id="int-step-models" className="int-panel int-lab-panel" aria-labelledby="int-lab-title">
      {defense&&<DefenseAid section="models" language={language}/>}
      <ModelLab view={view} metadata={result.metadata} t={t} language={language} focus={focus} onFocus={setFocus} onSpotlight={()=>setLabSpotlight(true)}>
        <Table title={t('intModelTitle')} level={3} rows={view.modelMetrics} t={t} rowClass={r=>r.detector===focus?'is-focus':undefined} columns={[col('intGroup',r=>r.group),col('intDetector',r=>r.detector),...['precision','recall','f1','TP','FP','TN','FN'].map(k=>col('int'+({precision:'Precision',recall:'Recall',f1:'F1'}[k]||k),r=>r[k],r=>n(r[k]),'num')),col('intMetricLabelled',r=>r.labelled_count,null,'num'),col('intMetricUnknown',r=>r.unknown_count,null,'num')]}/>
      </ModelLab>
    </section>

    <section className="int-panel" aria-labelledby="int-quality-title"><h2 id="int-quality-title">{t('intQuality')}</h2><dl>{['input_count','accepted_count','rejected_count','deduplicated_count','conflict_count'].map(k=><div key={k}><dt>{t('intQuality_'+k)}</dt><dd>{n(result.dataQuality[k])}</dd></div>)}</dl><p>{t('intDatasetVersion')}: {result.metadata.dataset_version} · {t('intModelVersion')}: {result.metadata.model_version} · {t('intComputed')}: {result.metadata.computed_at}</p><p>{t('intPolicy')}</p></section>

    <section id="int-step-conclusion" className="int-panel int-conclusion" aria-labelledby="int-step-conclusion-title">
      <div className="eyebrow">{t('intStep_conclusion')}</div>
      <h2 id="int-step-conclusion-title">{t('intConclusion')}</h2>
      {defense&&<DefenseAid section="conclusion" language={language}/>}
      {!conclusion.first?<p>{t('intConclusionEmpty')}</p>:<ol className="int-conclusion-list">
        <li data-conclusion="first">{t('intConclusionFirst',{type:t('intType_'+conclusion.first.entity_type),id:conclusion.first.entity_id,account:conclusion.first.account_id,score:n(conclusion.first.health_score),status:t('intState_'+conclusion.first.health_status),size:conclusion.queueSize})} <button type="button" className="int-inline-action" onClick={()=>setExplorer(conclusion.first)}>{t('intOpenHealthExplorer')}</button></li>
        {conclusion.evidence.ANOMALY_RATE&&<li>{t('intConclusionEvidenceAnomaly',{observed:pct(conclusion.evidence.ANOMALY_RATE.observed),reference:pct(conclusion.evidence.ANOMALY_RATE.reference)})}{conclusion.evidence.FAILURE_RATE&&' '+t('intConclusionEvidenceFailure',{observed:pct(conclusion.evidence.FAILURE_RATE.observed),reference:pct(conclusion.evidence.FAILURE_RATE.reference)})}</li>}
        {conclusion.workspace&&<li>{t('intConclusionWorkspace',{account:conclusion.workspace.account_id,id:conclusion.workspace.entity_id,score:n(conclusion.workspace.health_score),status:t('intState_'+conclusion.workspace.health_status)})}</li>}
        {conclusion.anomaly&&<li>{t('intConclusionAnomaly',{id:conclusion.anomaly.execution_id,ratio:n(conclusion.anomaly.duration_ratio),severity:t('intSeverity_'+conclusion.anomaly.severity)})} <button type="button" className="int-inline-action" onClick={()=>setWhy(conclusion.anomaly)}>{t('intWhy')}</button></li>}
        {decisionText&&<li>{t(conclusion.calibrated?'intConclusionDetector':'intConclusionDetectorUnvalidated',{detector:decisionText,f1:conclusion.decisionMetrics.map(d=>n(d.f1)).join(' / '),others:conclusion.otherMetrics.map(d=>d.id+' '+n(d.f1)).join(' · ')})}</li>}
        <li>{t('intConclusionDecision')}</li>
      </ol>}
      <p className="int-note">{t('intConclusionLimits')}</p>
      <div className="int-glossary-cta"><p>{language==='es'?'¿Tienes una pregunta técnica?':'Do you have a technical question?'}</p><button type="button" className="int-primary" onClick={()=>setGlossary(true)} data-action="open-defense-glossary">{language==='es'?'Abrir glosario de defensa':'Open defense glossary'}</button></div>
    </section>

    {defense&&<DefenseDock active={activeStep} mode={mode} t={t} onExit={()=>setDefense(false)}/>}
    {explorer&&<HealthExplorer key="explorer" entity={explorer} view={view} policy={result.metadata.health_policy} mode={mode} t={t} language={language} onClose={()=>setExplorer(null)} onOpenEntity={setExplorer} onFilterEntity={filterToEntity}/>}
    {why&&<WhyFlagged row={why} metadata={result.metadata} mode={mode} t={t} language={language} onClose={()=>setWhy(null)}/>}
    {labSpotlight&&<ModelLabSpotlight view={view} metadata={result.metadata} mode={mode} t={t} language={language} focus={focus} onFocus={setFocus} onClose={()=>setLabSpotlight(false)}/>}
    {glossary&&<DefenseGlossary language={language} onClose={()=>setGlossary(false)}/>}
  </div>;
}

/**
 * A rendering fault inside Intelligence stays inside Intelligence: the rest of
 * the console keeps working, and the view says what failed instead of going blank.
 */
class IntelligenceBoundary extends Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  render() {
    if(!this.state.error)return this.props.children;
    const {t}=this.props;
    return <section role="alert" className="int-panel"><p>{t('intRenderError')}</p><code>{String(this.state.error?.message||this.state.error)}</code><p><button type="button" onClick={()=>this.setState({error:null})}>{t('intRefresh')}</button></p></section>;
  }
}

export default function IntelligenceCenter({session,t,language,defenseMode,onDefenseModeChange}) {
  const [state,setState]=useState({loading:true}),[revision,setRevision]=useState(0);
  let allowed=true;try{assertIntelligenceSession(session);}catch{allowed=false;}
  useEffect(()=>{let active=true;if(!allowed)return;setState({loading:true});loadIntelligence(session).then(result=>{if(active)setState({result});}).catch(error=>{if(active)setState({error:error.message});});return ()=>{active=false;};},[session,allowed,revision]);
  if(!allowed)return <p role="alert">{t('intDenied')}</p>;
  if(state.loading)return <p role="status">{t('intLoading')}</p>;
  if(state.error)return <section role="alert"><p>{t('intError')}</p><code>{state.error}</code><p><button onClick={()=>setRevision(v=>v+1)}>{t('intRefresh')}</button></p></section>;
  return <IntelligenceBoundary t={t}><IntelligenceDashboard result={state.result} session={session} t={t} language={language} defenseMode={defenseMode} onDefenseModeChange={onDefenseModeChange}/></IntelligenceBoundary>;
}
