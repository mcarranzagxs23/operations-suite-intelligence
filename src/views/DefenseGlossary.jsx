import {useEffect,useId,useMemo,useRef,useState} from 'react';

const FOCUSABLE='button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])';

const entry=(category,term,esSimple,esPurpose,enSimple,enPurpose,aliases=[])=>({category,term,aliases,es:{simple:esSimple,purpose:esPurpose},en:{simple:enSimple,purpose:enPurpose}});

// Copy only: these explanations do not participate in scoring, calibration, or projection.
const GLOSSARY=Object.freeze([
  entry('data','KPI','Indicador clave que resume una medida importante.','Permite presentar ejecuciones, éxito, anomalías, salud y duración de un vistazo.','A key indicator that summarizes an important measure.','It presents executions, success, anomalies, health, and duration at a glance.'),
  entry('data','Dataset','Conjunto organizado de observaciones usadas para analizar.','Es la base sobre la que se calculan los resultados mostrados.','An organized collection of observations used for analysis.','It is the basis for the results shown.'),
  entry('data','Dataset sintético','Datos generados para representar escenarios sin usar actividad real.','Permite demostrar el pipeline sin exponer datos empresariales.','Generated data that represents scenarios without using real activity.','It demonstrates the pipeline without exposing business data.',['synthetic dataset']),
  entry('data','Pipeline','Secuencia reproducible de pasos que transforma datos en resultados.','Conecta preparación, análisis, modelos, scoring y la interfaz.','A reproducible sequence of steps that turns data into results.','It connects preparation, analysis, models, scoring, and the interface.'),
  entry('data','ETL','Extracción, transformación y carga de datos.','Prepara observaciones consistentes antes del análisis.','Extract, transform, load.','It prepares consistent observations before analysis.'),
  entry('analysis','EDA','Análisis exploratorio de datos antes de modelar.','Ayuda a conocer distribuciones, calidad y comportamientos del dataset.','Exploratory data analysis before modelling.','It helps understand distributions, quality, and dataset behavior.'),
  entry('analysis','Feature','Variable que un modelo utiliza como entrada.','Aquí el modelo usa la duración transformada; no usa etiquetas para decidir.','A variable used as an input by a model.','Here the model uses transformed duration; it does not use labels to decide.'),
  entry('analysis','Normalización','Transformación que lleva señales a una escala comparable.','Permite combinar señales de prioridad sin que una unidad domine por su tamaño.','A transformation that puts signals on a comparable scale.','It lets priority signals be combined without one unit dominating by size.'),
  entry('anomalies','Anomalía','Comportamiento inusual frente a una referencia. No significa necesariamente fallo.','Se investiga como evidencia, no como una causa confirmada.','Unusual behavior relative to a reference. It does not necessarily mean failure.','It is investigated as evidence, not as a confirmed cause.',['anomaly']),
  entry('anomalies','Fallo','La ejecución terminó incorrectamente.','Es una señal operativa distinta de una anomalía de duración.','The execution ended incorrectly.','It is an operational signal distinct from a duration anomaly.',['failure']),
  entry('anomalies','Referencia','Comportamiento histórico comparable usado como punto de contraste.','Permite decidir si una duración observada es inusual.','Comparable historical behavior used as a comparison point.','It lets the view decide whether an observed duration is unusual.',['reference']),
  entry('anomalies','Período actual','Ventana de tiempo que muestran los filtros activos.','Delimita qué ejecuciones alimentan los KPI y las tablas.','The time window shown by the active filters.','It defines which executions feed the KPIs and tables.',['current period']),
  entry('anomalies','Mediana','Valor central de un conjunto ordenado; resiste valores extremos.','Sirve como referencia típica de duración.','The middle value of an ordered set; it resists extreme values.','It serves as a typical duration reference.',['median']),
  entry('anomalies','P95','Valor por debajo del cual cae aproximadamente el 95 % de las observaciones.','Compara una ejecución con la zona alta esperada de su referencia.','The value below which about 95% of observations fall.','It compares an execution with the high end expected from its reference.'),
  entry('health','Health Score','Puntaje de 0 a 100 que resume salud operacional según componentes publicados por la política.','Ayuda a identificar dónde hay degradación; más alto significa mejor salud.','A 0–100 score that summarizes operational health from policy-published components.','It helps identify degradation; higher means better health.',['salud operativa']),
  entry('health','Outcome Health','Componente de salud asociado a resultados de ejecución.','Aporta evidencia de éxito, fallos o cancelaciones al Health Score.','The health component associated with execution outcomes.','It contributes success, failure, or cancellation evidence to the Health Score.'),
  entry('health','Anomaly Health','Componente de salud asociado a la frecuencia de anomalías.','Aporta qué tanto se aleja el período de su referencia esperada.','The health component associated with anomaly frequency.','It contributes how far the period departs from its expected reference.'),
  entry('health','Processing Health','Componente de salud asociado al procesamiento, incluida duración.','Aporta evidencia sobre cambios en el comportamiento de ejecución.','The health component associated with processing, including duration.','It contributes evidence about changes in execution behavior.'),
  entry('health','Trend Health','Componente que compara la tendencia del período con una referencia.','Evita interpretar una sola señal aislada como toda la salud.','The component that compares the period trend with a reference.','It prevents treating one isolated signal as all of health.'),
  entry('health','Datos insuficientes','No existe evidencia comparable suficiente para un score confiable.','Indica explícitamente que el sistema no debe afirmar una salud.','There is not enough comparable evidence for a reliable score.','It explicitly indicates that the system should not claim a health score.',['insufficient data']),
  entry('decision','Severity / Severidad','Nivel de importancia de una desviación según la política.','Ayuda a ordenar qué observaciones revisar primero.','The importance level of a deviation under the policy.','It helps order which observations to review first.'),
  entry('decision','Score','Valor numérico producido por una regla o detector.','Se interpreta junto con su umbral y su evidencia, no como causa.','A numeric value produced by a rule or detector.','It is interpreted with its threshold and evidence, not as a cause.'),
  entry('decision','Threshold / Umbral','Límite que separa una señal marcada de una no marcada.','Hace explícita la regla usada por cada detector.','The limit that separates a flagged signal from an unflagged one.','It makes each detector’s rule explicit.'),
  entry('models','Isolation Forest','Algoritmo de Machine Learning no supervisado que identifica observaciones raras porque suelen aislarse más fácilmente.','Es el candidato de Machine Learning comparado en este dataset.','An unsupervised Machine Learning algorithm that identifies rare observations because they tend to be isolated more easily.','It is the Machine Learning candidate compared in this dataset.',['IF']),
  entry('models','Machine Learning no supervisado','Aprendizaje que busca patrones sin etiquetas de respuesta durante el ajuste.','Describe el enfoque de Isolation Forest; no afirma causas de anomalías.','Learning that finds patterns without response labels during fitting.','It describes Isolation Forest’s approach; it does not claim anomaly causes.',['unsupervised machine learning']),
  entry('models','MAD','Método estadístico robusto basado en la distancia respecto a la mediana.','Es un baseline comparado y el detector seleccionado por calibración en este dataset.','A robust statistical method based on distance from the median.','It is a compared baseline and the calibration-selected detector for this dataset.'),
  entry('models','IQR','Método estadístico basado en el rango intercuartílico.','Es un baseline robusto usado para comparar detectores.','A statistical method based on the interquartile range.','It is a robust baseline used to compare detectors.'),
  entry('models','Train','Conjunto usado para ajustar un modelo.','Se mantiene separado de calibración y test para evaluar honestamente.','The set used to fit a model.','It remains separate from calibration and test for honest evaluation.',['training']),
  entry('models','Calibration / Calibración','Etapa para seleccionar detector o umbral sin usar el test final.','Justifica la selección de MAD sin mirar el desempeño final para decidir.','The stage used to select a detector or threshold without using the final test.','It justifies selecting MAD without using final test performance to decide.'),
  entry('models','Test','Conjunto reservado para evaluar el desempeño final.','Permite reportar métricas sin usarlo para seleccionar el detector.','The set reserved to evaluate final performance.','It allows metrics to be reported without using it to select the detector.'),
  entry('models','Baseline','Método de referencia con el que se compara otro método.','MAD e IQR permiten evaluar el aporte de Isolation Forest.','A reference method against which another method is compared.','MAD and IQR make it possible to assess Isolation Forest’s contribution.'),
  entry('metrics','Precision','De todo lo marcado como anomalía, qué proporción realmente era anomalía.','Mide cuántas alertas fueron correctas.','Of everything marked anomalous, the proportion that truly was anomalous.','It measures how many alerts were correct.'),
  entry('metrics','Recall','De todas las anomalías reales, qué proporción encontró el detector.','Mide cuántas anomalías reales no dejó pasar.','Of all real anomalies, the proportion the detector found.','It measures how many real anomalies it did not miss.'),
  entry('metrics','F1','Métrica que equilibra Precision y Recall.','Permite comparar detectores sin mirar solo cuántas anomalías encontraron.','A metric that balances Precision and Recall.','It compares detectors without looking only at how many anomalies they found.'),
  entry('metrics','TP','Anomalía real correctamente detectada.','Es uno de los cuatro conteos que explican las métricas de un detector.','A real anomaly correctly detected.','It is one of four counts that explain a detector’s metrics.',['true positive']),
  entry('metrics','FP','Caso normal marcado por error como anomalía.','Explica alertas que requerirían revisión innecesaria.','A normal case incorrectly marked as anomalous.','It explains alerts that would require unnecessary review.',['false positive']),
  entry('metrics','TN','Caso normal correctamente reconocido.','Completa la matriz de evaluación del detector.','A normal case correctly recognized.','It completes the detector evaluation matrix.',['true negative']),
  entry('metrics','FN','Anomalía real que el detector no detectó.','Explica los casos inusuales que una detección dejó pasar.','A real anomaly that the detector did not detect.','It explains unusual cases that a detector missed.',['false negative']),
  entry('decision','Priority Queue','Orden de entidades que conviene revisar primero.','Dirige la investigación hacia mayor evidencia de degradación; no determina la causa.','An ordering of entities that are worth reviewing first.','It directs investigation toward stronger degradation evidence; it does not determine cause.',['cola de prioridades']),
  entry('decision','Result Contract','Estructura validada que conecta resultados del pipeline con la interfaz.','Evita que la pantalla invente o altere resultados científicos.','A validated structure that connects pipeline results to the interface.','It prevents the screen from inventing or altering scientific results.'),
  entry('decision','Why Flagged','Explicación basada en evidencia de por qué una observación fue marcada.','Muestra observación, referencia, scores y umbrales sin inventar una causa.','Evidence-based explanation of why an observation was flagged.','It shows observation, reference, scores, and thresholds without inventing a cause.'),
  entry('data','UTC','Estándar de tiempo universal, sin zona horaria local.','Mantiene los timestamps comparables entre ejecuciones y períodos.','A universal time standard without a local time zone.','It keeps timestamps comparable across executions and periods.')
]);

const CATEGORIES=Object.freeze({es:['Todos','DATOS','ANÁLISIS','ANOMALÍAS','SALUD','MODELOS','MÉTRICAS','DECISIÓN'],en:['All','DATA','ANALYSIS','ANOMALIES','HEALTH','MODELS','METRICS','DECISION']});
const CATEGORY_KEYS=Object.freeze(['all','data','analysis','anomalies','health','models','metrics','decision']);

export const DEFENSE_AIDS=Object.freeze({
  overview:{es:{simple:'Esta vista resume el comportamiento del período. Los KPI se calculan desde los resultados del pipeline.',show:'Qué demostrar: cantidad de ejecuciones, éxito, anomalías, salud y duración.',decision:'Entender rápidamente el estado general antes de investigar una entidad.'},en:{simple:'This view summarizes period behavior. KPIs are calculated from pipeline results.',show:'Show: execution count, success, anomalies, health, and duration.',decision:'Understand the overall state before investigating an entity.'}},
  health:{es:{simple:'El Health Score resume resultados, anomalías, procesamiento y tendencia frente a una referencia. Más alto = mejor salud.',show:'Datos insuficientes significa que no existe evidencia suficiente para producir un score confiable.',decision:'Identificar qué cuenta, workspace, dispositivo o herramienta muestra degradación.'},en:{simple:'The Health Score summarizes outcomes, anomalies, processing, and trend against a reference. Higher = better health.',show:'Insufficient data means there is not enough evidence for a reliable score.',decision:'Identify the account, workspace, device, or tool showing degradation.'}},
  anomaly:{es:{simple:'Una anomalía es un comportamiento inusual. No necesariamente significa que la ejecución falló.',show:'Compare duración observada contra mediana, P95 y umbrales de los detectores.',decision:'Revisar una ejecución que se alejó significativamente de su comportamiento esperado.'},en:{simple:'An anomaly is unusual behavior. It does not necessarily mean the execution failed.',show:'Compare observed duration with the median, P95, and detector thresholds.',decision:'Review an execution that departed substantially from expected behavior.'}},
  priority:{es:{simple:'La cola de prioridades combina señales normalizadas para decidir qué revisar primero. No determina la causa.',show:'Presenta el orden de revisión, no un diagnóstico.',decision:'Dirigir la investigación hacia entidades con mayor evidencia de degradación.'},en:{simple:'The priority queue combines normalized signals to decide what to review first. It does not determine cause.',show:'It presents review order, not a diagnosis.',decision:'Direct investigation toward entities with stronger degradation evidence.'}},
  models:{es:{simple:'Se comparó un modelo de Machine Learning con dos baselines estadísticos robustos.',show:'Isolation Forest: no supervisado. MAD: mediana. IQR: cuartiles. En este dataset, MAD obtuvo el mejor F1 y fue seleccionado mediante calibración.',decision:'No significa que MAD sea universalmente mejor; explica la comparación de este dataset.'},en:{simple:'A Machine Learning model was compared with two robust statistical baselines.',show:'Isolation Forest: unsupervised. MAD: median-based. IQR: quartile-based. In this dataset, MAD had the best F1 and was selected through calibration.',decision:'This does not mean MAD is universally better; it explains this dataset comparison.'}},
  conclusion:{es:{simple:'Operation Suite registra lo que ocurrió. Operation Suite Intelligence agrega qué fue inusual, qué está degradado, qué revisar primero y por qué.',show:'TELEMETRÍA ↓ EVIDENCIA ↓ PRIORIDAD ↓ DECISIÓN',decision:'Cerrar con evidencia y una decisión de revisión, no con una causa inventada.'},en:{simple:'Operation Suite records what happened. Operation Suite Intelligence adds what was unusual, what is degraded, what to review first, and why.',show:'TELEMETRY ↓ EVIDENCE ↓ PRIORITY ↓ DECISION',decision:'Close with evidence and a review decision, not an invented cause.'}}
});

export function DefenseAid({section,language}) {
  const copy=DEFENSE_AIDS[section]?.[language]||DEFENSE_AIDS[section].es;
  const key='operations-intelligence-defense-aids';
  const [open,setOpen]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(key)||'{}')[section]??true;}catch{return true;}});
  const toggle=()=>setOpen(value=>{
    const next=!value;
    try{sessionStorage.setItem(key,JSON.stringify({...JSON.parse(sessionStorage.getItem(key)||'{}'),[section]:next}));}catch{}
    return next;
  });
  return <aside className="int-defense-aid" data-defense-aid={section}>
    <button type="button" aria-expanded={open} onClick={toggle}>{language==='es'?'En palabras simples':'In plain language'} <span aria-hidden="true">{open?'−':'+'}</span></button>
    {open&&<div className="int-defense-aid-body"><p>{copy.simple}</p><p><strong>{language==='es'?'Qué demostrar':'What to show'}:</strong> {copy.show}</p><p><strong>{language==='es'?'Decisión':'Decision'}:</strong> {copy.decision}</p></div>}
  </aside>;
}

export function DefenseGlossary({language,onClose}) {
  const dialog=useRef(null),close=useRef(null),titleId=useId();
  const [query,setQuery]=useState(''),[category,setCategory]=useState('all');
  const lang=language==='en'?'en':'es',categories=CATEGORIES[lang];
  useEffect(()=>{
    const node=dialog.current,origin=document.activeElement;
    node.showModal();close.current?.focus();
    return ()=>{if(node.open)node.close();if(origin instanceof HTMLElement&&origin.isConnected)origin.focus({preventScroll:true});};
  },[]);
  const entries=useMemo(()=>{
    const needle=query.trim().toLocaleLowerCase();
    return GLOSSARY.filter(item=>{
      const copy=item[lang],haystack=[item.term,item.category,...item.aliases,copy.simple,copy.purpose].join(' ').toLocaleLowerCase();
      return (category==='all'||item.category===category)&&(!needle||haystack.includes(needle));
    });
  },[category,lang,query]);
  const trap=event=>{if(event.key!=='Tab')return;const items=[...dialog.current.querySelectorAll(FOCUSABLE)].filter(node=>node.getClientRects().length);if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}};
  const label=lang==='es'?'Buscar término':'Search term';
  return <dialog ref={dialog} className="int-dialog int-glossary" aria-modal="true" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();onClose();}} onKeyDown={trap} onClick={event=>{if(event.target===dialog.current)onClose();}}>
    <header className="int-dialog-head"><div className="int-dialog-titles"><div className="int-dialog-eyebrow">{lang==='es'?'GLOSARIO DE INTELLIGENCE':'INTELLIGENCE GLOSSARY'}</div><h2 id={titleId}>{lang==='es'?'Glosario de defensa':'Defense glossary'}</h2><p className="int-dialog-subtitle">{lang==='es'?'Apoyo opcional para explicar términos técnicos sin sustituirlos.':'Optional support for explaining technical terms without replacing them.'}</p></div><div className="int-dialog-tools"><button type="button" ref={close} className="int-dialog-close" onClick={onClose}>{lang==='es'?'Cerrar glosario':'Close glossary'}</button></div></header>
    <div className="int-dialog-body int-glossary-body"><label className="int-glossary-search">{label}<input autoComplete="off" value={query} onChange={event=>setQuery(event.target.value)} placeholder={lang==='es'?'Buscar término…':'Search term…'} /></label>
      <div className="int-glossary-categories" aria-label={lang==='es'?'Categorías del glosario':'Glossary categories'}>{CATEGORY_KEYS.map((key,index)=><button key={key} type="button" aria-pressed={category===key} onClick={()=>setCategory(key)}>{categories[index]}</button>)}</div>
      <p className="int-note" role="status">{entries.length} {lang==='es'?'términos encontrados':'terms found'}</p>
      <div className="int-glossary-list">{entries.map(item=>{const copy=item[lang];return <article key={item.term} className="int-glossary-entry"><div className="int-glossary-entry-head"><h3>{item.term}</h3><span>{categories[CATEGORY_KEYS.indexOf(item.category)]}</span></div><dl><dt>{lang==='es'?'SIGNIFICADO SIMPLE':'PLAIN MEANING'}</dt><dd>{copy.simple}</dd><dt>{lang==='es'?'PARA QUÉ SIRVE AQUÍ':'WHY IT MATTERS HERE'}</dt><dd>{copy.purpose}</dd></dl></article>;})}</div>
      {!entries.length&&<p>{lang==='es'?'No hay términos que coincidan con la búsqueda.':'No terms match this search.'}</p>}
    </div>
  </dialog>;
}

export const DEFENSE_GLOSSARY_TERMS=GLOSSARY;
