# Operation Suite Intelligence — documentación técnica

## Propósito

Este directorio contiene el diseño técnico interno de **Operation Suite Intelligence**. Se mantiene separado de los documentos `FOUNDATION_*` y del documento académico maestro para evitar presentar planes analíticos como si fueran capacidades ya liberadas de la plataforma.

El componente convierte telemetría operacional autorizada en señales explicables para el Super Administrator:

```text
ExecutionEvent V1
  → dataset analítico híbrido
  → ETL y EDA
  → Isolation Forest + baseline robusto
  → anomalías y severidad
  → Operational Health Score
  → Priority Engine
  → Intelligence Center (entregado en v0.2, vista nativa Super Admin)
```

## Estado de la iniciativa

- [x] COMPLETADO: decisión académica y alcance oficial documentados.
- [x] COMPLETADO: contrato real de telemetría y fronteras de privacidad auditados.
- [x] COMPLETADO: diseño de dataset, ETL, modelo, Health Score y Priority Engine.
- [x] COMPLETADO: generador reproducible, dataset sintético v0.1 de 1,440 eventos, validación de esquema y ETL sin rechazos.
- [x] COMPLETADO: EDA reproducible en resumen y reporte Markdown, con dos visualizaciones iniciales incluidas en el entregable académico externo PDF.
- [x] COMPLETADO: evaluación temporal de Isolation Forest y baseline MAD/IQR sobre etiquetas sintéticas retenidas; los resultados se reportan sin afirmar rendimiento productivo.
- [x] COMPLETADO: Operational Health Score, explicaciones y Priority Engine determinísticos sobre los resultados derivados de referencia.
- [x] COMPLETADO: integración Web App nativa, servicio local protegido y RBAC Super Admin sobre el dataset v0.2 de 6,125 eventos. Cierre y verificación independiente registrados abajo.
- [ ] PENDIENTE: lectura de telemetría productiva y configuración administrativa. El adaptador `REAL_CONTROLLED` está preparado y probado solo contra Emulator.

## Documentos

| Documento | Contenido |
| --- | --- |
| [DATASET_AND_ETL.md](DATASET_AND_ETL.md) | Fuentes, esquema, dataset híbrido, ETL, limpieza y EDA. |
| [MODEL_AND_DECISION_DESIGN.md](MODEL_AND_DECISION_DESIGN.md) | Isolation Forest, baseline, evaluación, Health Score y Priority Engine. |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Fases, límites de integración, RBAC, UI objetivo, pruebas y criterios de salida. |
| [FINAL_IMPLEMENTATION_LOG.md](FINAL_IMPLEMENTATION_LOG.md) | Registro por fases del cierre v0.2, con comandos y resultados. |
| [FINAL_ACCEPTANCE.md](FINAL_ACCEPTANCE.md) | Matriz de aceptación A–AH del cierre académico. |
| [POST_IMPLEMENTATION_AUDIT.md](POST_IMPLEMENTATION_AUDIT.md) | Verificación independiente: reproducibilidad, ausencia de fuga y comprobaciones sobre el sistema en ejecución. |

## Límites no negociables

- No usar ni registrar arte, nombres/rutas de archivo, configuración de workspace, MAC address, IP, correos, secretos ni credenciales.
- No usar identificadores de usuario, dispositivo, workspace o cuenta como features directas iniciales de anomalía.
- No modificar Clean Vector PRO, Sep Maker PRO, CEP, Local Bridge, Firebase cloud o `Documents/SEP MAKER/` para construir la primera capa analítica.
- No presentar datos sintéticos como información productiva real.
- No usar el sistema para calificar desempeño individual de empleados.

## Fuente de verdad de la plataforma

Para capacidades actuales de Operation Suite prevalecen `docs/PROJECT_STATUS.md`, `docs/ROADMAP.md`, `docs/FOUNDATION_3_0_PLATFORM_COMPLETE.md` y el código fuente. Este directorio describe trabajo de Ciencia de Datos planificado o implementado en fases posteriores.
