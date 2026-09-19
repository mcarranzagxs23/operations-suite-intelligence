import {readFile,writeFile} from 'node:fs/promises';
const root='data-science/artifacts/v0.2';
const read=async n=>JSON.parse(await readFile(root+'/'+n,'utf8'));
const [r,reference,model]=await Promise.all(['intelligence-result.json','reference-validation.json','model.json'].map(read));
const f=n=>n==null?'No evaluable':Number(n).toFixed(4);
const metrics=r.modelMetrics.filter(m=>m.group==='total');
const health=r.workspaces.map(e=>`| ${e.account_id} | ${e.entity_id} | ${e.health_score??'Sin score'} | ${e.health_status} | ${e.sample_size} |`).join('\n');
const doc=`# PROYECTO FINAL — Ciencia de Datos II

## Operation Suite Intelligence

### Sistema de salud, detección de anomalías y priorización operativa

| Portada | Información |
| --- | --- |
| Estudiante | Miguel Angel Carranza Avilez |
| Docente | Ing. Naomy Ríos |
| Curso | Ciencia de Datos II |
| Fecha de cierre | 15 de septiembre de 2026 |
| Proyecto individual | Operation Suite Intelligence |
| Sistema base | Operations Suite |
| Alcance de entrega | Integración local funcional; dataset académico sintético; sin despliegue productivo |

## 1. Descripción del proyecto original

Operations Suite administra cuentas, workspaces, permisos, herramientas, estaciones y telemetría operacional. Sus motores se ejecutan localmente en Illustrator. La plataforma base está terminada; el proyecto individual de Ciencia de Datos es únicamente Intelligence. Esta entrega añade análisis a la consola existente con una vista React nativa y exclusiva del Super Administrador.

## 2. Problema seleccionado

Un listado de ejecuciones describe qué ocurrió, pero exige revisión manual para distinguir duración atípica, deterioro operativo y entidades que merecen atención primero. El problema seleccionado es convertir esa telemetría mínima en evidencia comparable, contextual y explicable. Una anomalía temporal puede haber terminado con éxito; un fallo puede durar poco. Por ello se mantienen separados el detector de duración y el resultado operativo.

## 3. Objetivos

- Construir un pipeline reproducible con contrato, ETL, EDA, entrenamiento, evaluación e inferencia.
- Comparar Isolation Forest con MAD e IQR mediante partición temporal global y selección exclusiva por calibración.
- Derivar salud, tendencias y prioridad por cuenta, workspace, dispositivo y herramienta, sin confundir IDs iguales entre cuentas.
- Integrar resultados validados en Operations Suite, con filtros, explicaciones determinísticas, acceso protegido y ES/EN.
- Demostrar decisiones prudentes sin atribuir causas técnicas no medidas ni evaluar empleados.

## 4. Dataset

El dataset v0.2 (${r.metadata.dataset_version}) contiene **${r.dataQuality.accepted_count} ejecuciones sintéticas**, tres cuentas, cinco workspaces, diez dispositivos y dos herramientas. Cubre 180 días, del 1 de marzo al 27 de agosto de 2026. La semilla ${model.seed} reproduce las observaciones. Los primeros 90 días permiten desarrollo/evaluación; los siguientes 90, inferencia de escenarios operativos.

v0.1 se conserva íntegro como evidencia del avance, con módulos históricos en 'data-science/legacy/v0.1/'. Sus métricas no se mezclan con esta evaluación final.

'SYNTHETIC' indica generación académica. 'REAL_CONTROLLED' corresponde al adaptador de telemetría autorizada: usa lista cerrada de campos, etiquetas desconocidas null y lecturas acotadas. La entrega no incorpora datos empresariales reales. No se usan arte, nombres de documento, rutas, MAC, correos ni credenciales como variables. IDs sirven para agrupar y aislar, nunca para entrenar.

Los cinco escenarios tienen comportamiento propio: actividad saludable, seguimiento, riesgo elevado, incidente crítico y muestra insuficiente. Los scores no se asignan manualmente: se calculan después de inferir las ejecuciones. La generación de escenarios facilita la defensa pero también limita la validez externa.

## 5. Proceso de Ciencia de Datos

### Obtención

'generateScenarios' produce los eventos sintéticos; 'telemetry-adapter.mjs' prepara extracción autorizada del emulador. La extracción exige claim Super Admin y cuenta explícita, con máximo de 1.000 eventos actuales, 1.000 de referencia, 400 dispositivos y 500 agregados diarios. La cobertura incompleta se declara y evita afirmar salud precisa.

### ETL y limpieza

Se validan esquema, fechas ISO, semver, origen, duración y categorías. Los duplicados idénticos se deduplican; todos los participantes de un conflicto se aíslan. Las claves compuestas incluyen cuenta y workspace. Se derivan segundos, 'log1p(duration_ms)' y atributos temporales. Las etiquetas conocidas se reservan a evaluación; unknown/null no se convierten en normales. Resultado de esta ejecución: ${r.dataQuality.input_count} entradas, ${r.dataQuality.accepted_count} aceptadas, ${r.dataQuality.rejected_count} rechazadas y ${r.dataQuality.conflict_count} conflictos.

### EDA

El proceso genera 32 figuras desde observaciones y métricas, más 'EDA_FIGURES.pdf'. Para la defensa se seleccionan distribución de duración, resultados operativos, comparación de detectores y evolución temporal. Las tablas de salud y prioridad complementan el EDA con resultados operativos derivados.

![Distribución de duración](data-science/artifacts/v0.2/figures/histogram-clean-vector-pro.svg)

La duración tiene una escala dependiente de la herramienta. Se modela por herramienta/acción y se transforma a escala logarítmica para comparar desviaciones relativas.

![Resultados operativos](data-science/artifacts/v0.2/figures/status.svg)

El resultado operativo se mantiene separado de la etiqueta de anomalía: la duración atípica no demuestra fallo.

![Ejecuciones en el tiempo](data-science/artifacts/v0.2/figures/executions.svg)

## 6. Modelos utilizados

### Isolation Forest — modelo ML académico principal

Isolation Forest aísla observaciones mediante particiones aleatorias y asigna mayor rareza a caminos promedio más cortos [1]. La implementación serializable usa ${model.models[0].treeCount} árboles y submuestras de ${model.models[0].sampleSize}, con una variable: 'log_duration'. Excluye status, etiquetas e identificadores. No produce una probabilidad de fallo. El umbral IF es el percentil 95 de scores de calibración.

La implementación se contrastó con scikit-learn [2] bajo las mismas particiones y parámetros: correlaciones Spearman ${reference.results.map(v=>f(v.spearman_score_correlation)).join(' y ')}. El criterio previo fue ≥0,90. No se exige identidad de árboles porque cambian el generador aleatorio y la construcción de particiones. Se conserva 'reference-validation.json' con esas diferencias.

### MAD e IQR — baselines estadísticos

MAD calcula la distancia robusta absoluta 0,6745 × (log duración − mediana) / MAD; su umbral fijo es 3,5. Si MAD es cero se aplica un respaldo explícito probado para valores constantes. IQR usa distancia fuera de Q1/Q3 normalizada por su rango intercuartílico; su umbral es 1,5. Los tres detectores se evalúan independientemente, sin una unión que infle el resultado.

### Partición y decisión

| Partición | Días | Inicio | Fin |
| --- | --- | --- | --- |
${Object.entries(model.periods).map(([name,p])=>`| ${name} | ${Math.round((Date.parse(p.end)-Date.parse(p.start)+1)/86400000)} | ${p.start.slice(0,10)} | ${p.end.slice(0,10)} |`).join('\n')}

Se elige el detector por F1 en calibration entre candidatos fijos. Los empates prefieren MAD, IQR e IF en ese orden. Test no ajusta umbrales ni selección: una prueba altera sus resultados y confirma que las decisiones de calibración permanecen iguales. En ambos grupos se seleccionó **${[...new Set(r.detectors.map(d=>d.decision_detector))].join(', ')}**. El conjunto test permanece reservado a evaluación; inference contiene datos posteriores, puntuados con el artefacto guardado y sin reentrenar.

## 7. Resultados y métricas

Evaluación reservada: ${metrics[0].evaluation_rows} ejecuciones con ${metrics[0].labelled_count} etiquetas conocidas.

| Detector | Precision | Recall | F1 | TP | FP | TN | FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
${metrics.map(m=>`| ${m.detector} | ${f(m.precision)} | ${f(m.recall)} | ${f(m.f1)} | ${m.TP} | ${m.FP} | ${m.TN} | ${m.FN} |`).join('\n')}

![Comparación de detectores](data-science/artifacts/v0.2/figures/detector-comparison.svg)

**MAD supera a Isolation Forest en este dataset.** La aplicación lo muestra y usa MAD para decisiones. El desempeño perfecto de MAD refleja este escenario sintético, no garantiza desempeño en producción. IF conserva su función como modelo ML académico comparado honestamente con baselines.

### Artefacto e inferencia

'model.json' contiene árboles, semillas, parámetros, umbrales, selección y períodos. 'score' carga ese artefacto y puntúa nuevas observaciones sin llamar al entrenamiento. 'intelligence-result.json' versión ${r.schema_version} presenta ${r.observations.length} ejecuciones del período de inferencia. El navegador recibe ese contrato por HTTP protegido, nunca CSV arbitrario ni el artefacto de entrenamiento.

### Health Score

Se promedian con pesos iguales cuatro componentes 0–100: éxito operativo; complemento del límite superior Wilson de la tasa de anomalías; deterioro de mediana respecto al rango mediana–P95 histórico por herramienta/acción/versión; y deterioro máximo entre anomalías, fallos, cancelaciones y duración. La referencia académica es train, siempre anterior a la ventana visible. El componente trend es una puntuación de estabilidad, no un porcentaje de crecimiento. Los gráficos agregan semanas; no se interpola salud cuando falta muestra.

Se requieren al menos 20 ejecuciones tanto actuales como históricas por grupo comparable. Healthy ≥90; monitor ≥75; high_risk ≥60; critical <60. Si la referencia o muestra no alcanza, el estado es insufficient_data y el score es null. Los umbrales de salud son una política operativa explícita, no parámetros aprendidos ni clínicamente validados.

| Cuenta | Workspace | Health Score | Estado | Ejecuciones |
| --- | --- | --- | --- | --- |
${health}

### Priority y Why Flagged

Se ordena primero por estado y menor salud, luego por tasas normalizadas, severidad, estabilidad, confianza y desempates determinísticos. El volumen no es una penalización independiente; interviene en la incertidumbre y como desempate tardío. Las entidades con muestra insuficiente requieren más evidencia y se distinguen de un incidente confirmado.

Why Flagged muestra duración observada, mediana y P95 de referencia, desviación, scores y umbrales IF/MAD/IQR, intervalo IQR convertido a segundos, detector de decisión, severidad, resultado y acción. Las recomendaciones consisten en revisar ejecuciones, verificar consistencia de versiones o monitorear. Nunca se atribuyen problemas de CPU, red o desempeño del operador.

## 8. Decisiones que se pueden tomar

El Super Admin puede empezar por '${r.priorityQueue[0].entity_id}' de '${r.priorityQueue[0].account_id}', revisar evidencia y ejecuciones de su contexto y comparar herramientas/versiones antes de actuar. Puede acotar la revisión a una cuenta, workspace o dispositivo, variar 7/30/90 días y contrastar detectores. El resultado orienta revisión; no suspende estaciones ni cambia permisos automáticamente.

## 9. Valor agregado demostrado

La integración transforma un historial de ejecuciones en una cola de revisión explicada y navegable. Incluye diez KPI derivados, tablas ordenables/paginadas, seis tendencias, filtros, detalles accesibles y ES/EN. Se mantiene el aislamiento por cuenta incluso ante workspaces con el mismo ID. La navegación, el servicio y la proyección niegan roles menores; el backend de Emulator verifica tokens reales. El modo offline sirve exclusivamente el dataset sintético mediante una capacidad local: representa una identidad de demostración, no autentica a una persona real.

La validación ejecutada y sus cantidades vigentes están en [FINAL_ACCEPTANCE.md](docs/data-science/FINAL_ACCEPTANCE.md). La demo está documentada en [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).

## 10. Limitaciones

- Datos sintéticos y una variable de duración: no se demuestra generalización empresarial ni causalidad.
- Escenarios conocidos al diseñar el generador; hacen la demostración reproducible pero pueden favorecer baselines sencillos.
- Políticas de salud/prioridad requieren validación con responsables operativos antes de uso real.
- Telemetría autorizada queda preparada y probada contra Emulator; no se realizó extracción ni despliegue productivo.
- Unknown/null no permite precision/recall/F1; se presenta como no evaluable.
- El filtro de detector distinto al calibrado es exploratorio. Las métricas test no cambian con períodos, outcome o severidad para evitar sesgar el benchmark.
- Campos filtrados pueden dejar referencia insuficiente. La UI conserva null; no rellena scores artificiales.
- Sin alertas automáticas, jobs pagos, entrenamiento en React ni ingestión continua.

## 11. Futuras mejoras

Validar con telemetría autorizada y etiquetas revisadas; medir drift y costo de falsos positivos; evaluar variables operativas adicionales solo si son legítimas y medibles; versionar recalibraciones; validar umbrales de salud y comparar contra decisiones de un supervisor. Cada ampliación productiva requiere su propio alcance y revisión.

## 12. Reproducción y defensa

Seguir los comandos exactos del [README académico](data-science/README.md). Los artefactos finales se generan fuera de React. La defensa dura 10–12 minutos y cuenta con [PRESENTATION_OUTLINE.md](PRESENTATION_OUTLINE.md). Los PDFs de avance se conservan como historia; este documento es el proyecto final individual.

## 13. Bibliografía

1. Liu, F. T., Ting, K. M. y Zhou, Z.-H. (2008). *Isolation Forest*. IEEE ICDM, 413–422. DOI 10.1109/ICDM.2008.17. [Texto de los autores](https://cs.nju.edu.cn/zhouzh/zhouzh.files/publication/icdm08b.pdf).
2. scikit-learn. *IsolationForest API*. Referencia independiente de implementación y convención de score. [Documentación oficial](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html). La ejecución local usa ${reference.scikit_learn}.
3. Código y evidencia reproducible del proyecto: 'dataset-etl.mjs', 'model-analysis.mjs', 'src/intelligence/analysis.js', 'metrics.json', 'quality.json' y 'reference-validation.json'.
`;
await writeFile('Proyecto Final - Ciencia de Datos II.md',doc);
console.log('Final academic report generated from validated pipeline results.');
