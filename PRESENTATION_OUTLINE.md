# Operation Suite Intelligence — defensa de 10–12 minutos

**Curso:** Ciencia de Datos II · **Estudiante:** Miguel Angel Carranza Avilez.

Este es el esquema oral; no son slides.

| Tiempo | Tema | Mensaje y evidencia |
| --- | --- | --- |
| 0:00–0:45 | Contexto | Operations Suite ya administra ejecución y telemetría. El proyecto individual es Intelligence. |
| 0:45–1:20 | Problema y objetivo | Un historial exige interpretación manual. Buscamos evidencia contextual y una cola de revisión. |
| 1:20–2:10 | Dataset y privacidad | v0.1 histórico; v0.2 sintético, 180 días, escenarios reproducibles, IDs compuestos y ningún dato de arte. |
| 2:10–2:55 | ETL y EDA | Fechas, semver, conflictos, unknown/null. Mostrar histograma y resultados; éxito no implica duración normal. |
| 2:55–3:45 | Isolation Forest | Árboles aleatorios, log duración por herramienta/acción, score de rareza; artefacto guardado e inferencia sin reentrenar. |
| 3:45–4:30 | MAD/IQR y metodología | Baselines independientes. Train/calibration/test/inference globales; el test no elige el detector. |
| 4:30–5:15 | Resultados | Leer métricas del panel: MAD supera IF en este dataset. Mostrar falsos positivos y limitación sintética. |
| 5:15–6:10 | Integración y salud | Abrir la vista nativa y pulsar **Modo defensa**; la barra inferior guía los seis pasos. **Visión global**: fuente sintética, KPI, clic en **Salud global** → Health Explorer (componentes y pesos leídos del contrato). **Salud**: cinco estados, referencia anterior y mínimo de muestra. |
| 6:10–7:10 | Anomalía y Prioridad | **Anomalía**: **Mostrar anomalía destacada** → *Por qué se marcó* (observada vs mediana y P95, IF/MAD/IQR, detector de decisión). **Prioridad**: la entidad que requiere revisión primero y sus detalles. Sin causas inventadas. |
| 7:10–8:25 | Filtros y Modelos | Período 90 → 30 días: el panel **Filtro aplicado** muestra antes → después. **Modelos**: Model Comparison Lab; IF en foco es **SOLO COMPARACIÓN** y no cambia el detector de decisión ni el Health Score. Mostrar insuficiencia y estado vacío si hay tiempo. |
| 8:25–9:10 | Decisión y valor | Paso **Conclusión**: revisar ejecuciones y consistencia de versión antes de intervenir. La herramienta prioriza, no sanciona. Salir del modo defensa. |
| 9:10–10:00 | Validación y límites | Pruebas actuales en FINAL_ACCEPTANCE; RBAC en varias capas, Emulator, ES/EN y responsive. Generalización no demostrada. |
| 10:00–10:45 | Conclusión | Pipeline reproducible integrado en una decisión operativa explicable. Mejoras: datos autorizados, drift y validación de políticas. |
| 10:45–12:00 | Margen y preguntas | Reabrir Why Flagged con **Mostrar anomalía destacada** o explicar por qué MAD fue elegido desde el paso **Modelos**. Plan B documentado. |

## Preguntas previsibles

- **¿Por qué usar IF si MAD gana?** Para evaluar un enfoque ML frente a baselines y elegir con evidencia. La complejidad no garantiza mejor resultado.
- **¿El F1 perfecto demuestra calidad productiva?** No. Describe este benchmark sintético; exige validación externa.
- **¿Hay fuga de etiquetas?** No entran como features. Calibration elige entre candidatos; test solo evalúa. La prueba altera test y verifica invariancia de selección y umbrales.
- **¿Por qué algunas entidades no tienen score?** Faltan 20 ejecuciones actuales o de referencia por grupo comparable; no se inventa precisión.
- **¿Puede identificar fallos de CPU o artistas?** No se miden esas variables ni se afirman causas. Se reportan duraciones, resultados y desviaciones.
- **¿La anomalía destacada se eligió a mano?** No. Sale del result contract con una política fija: severidad, luego distancia a la mediana en escala logarítmica, luego la más reciente y, al final, el identificador.
- **¿Poner IF en foco cambia la salud o la decisión?** No. Es una lente de comparación: el detector de decisión sigue siendo el calibrado y ningún Health Score se recalcula.
- **¿Cómo se protege el acceso?** Navegación, proyección y servicio filtran; el backend local verifica el claim del token de Emulator. Plan B es explícitamente sintético.

Leer cifras desde el documento generado y el panel actual; no memorizar números históricos. Referencia operativa: [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).
