# Operation Suite Intelligence — dataset, ETL, limpieza y EDA

## 1. Contratos y fuentes reales

La fuente principal implementada es `ExecutionEvent V1` en `src/execution-contract.js`. El backend persiste eventos en `accounts/{accountId}/telemetry/{executionId}` mediante `recordWorkstationExecution`; además actualiza `telemetryDaily/{workspaceId}_{day}` de manera transaccional e idempotente.

### Campos persistidos de telemetría

| Campo Firestore | Disponibilidad | Observación |
| --- | --- | --- |
| `schemaVersion`, `executionId` | Sí | `executionId` es la clave de idempotencia. |
| `accountId`, `workspaceId`, `deviceId`, `actorUid` | Sí | Identificadores opacos; `actorUid` lo asigna el backend. |
| `toolId`, `toolVersion`, `action` | Sí | Catálogo y ejecución autorizados. |
| `status`, `errorCode` | Sí | Vocabulario cerrado; los mensajes libres no se almacenan. |
| `durationMs`, `startedAt`, `completedAt`, `receivedAt` | Sí | `receivedAt` es timestamp de servidor. |
| `source`, `hostVersion`, `suiteVersion` | Sí | Las dos versiones son opcionales. |

### Agregados disponibles

`telemetryDaily` guarda `day`, `workspaceId`, `totalRuns`, `successfulRuns`, `failedRuns`, `cancelledRuns`, `totalDurationMs` y `byTool`. Es útil para tendencias y para verificar que el ETL no contradiga los eventos crudos, pero no sustituye el dataset de ejecución porque no contiene duración individual.

### Uniones permitidas

| Colección | Campo aprovechable | Propósito |
| --- | --- | --- |
| `devices` | `platform`, `status`, `workspaceId`, `lastSeenAt` | Plataforma, estabilidad y agrupación. |
| `workspaces` | ID, estado y metadatos seguros | Filtros y ranking. |
| `tools` | herramienta, versiones y estado | Segmentación y análisis de versiones. |

No se extraen archivos de Illustrator, JSON técnicos, rutas, arte ni configuraciones de Sep Maker.

## 2. Dataset híbrido

El pipeline conserva dos orígenes exclusivos:

```text
REAL_CONTROLLED  = ejecución aprobada y sanitizada en entorno académico
SYNTHETIC        = observación reproducible creada por el generador
```

El campo `data_origin` es obligatorio para el dataset analítico. La etiqueta `expected_anomaly` solo puede existir en los datos sintéticos y se utiliza exclusivamente para evaluación, nunca como feature de entrenamiento.

Los datos reales controlados no se mezclarán silenciosamente con los sintéticos. Todo reporte deberá mostrar el conteo de cada origen.

## 3. Esquema analítico definitivo v0.1

### Identidad y contexto, excluidos de las features iniciales

`execution_id`, `account_id`, `workspace_id`, `device_id`, `actor_uid`, `data_origin`.

Estos campos sirven para unicidad, alcance, filtros, agrupaciones, explicación y ranking. La alta cardinalidad de workspace/dispositivo/actor desaconseja introducirlos directamente al Isolation Forest inicial: una identidad poco frecuente no equivale a comportamiento anómalo.

### Señal operacional

`tool_id`, `tool_version`, `action`, `device_platform`, `status`, `error_code`, `duration_ms`, `started_at`, `completed_at`, `received_at`, `source`, `host_version`, `suite_version`.

### Variables derivadas

| Variable | Fórmula o regla |
| --- | --- |
| `duration_seconds` | `duration_ms / 1000`. |
| `log_duration` | `log1p(duration_ms)`. |
| `hour_of_day` | Hora UTC de `completed_at`, de 0 a 23. |
| `day_of_week` | Día UTC de `completed_at`, de 0 a 6. |
| `hour_sin`, `hour_cos` | Codificación cíclica de la hora. |
| `day_sin`, `day_cos` | Codificación cíclica del día. |
| `is_anomaly` | Resultado del modelo o del baseline; nunca dato de entrada. |
| `anomaly_score` | Puntaje normalizado de anomalía. |
| `severity` | `low`, `medium`, `high` o `critical`, derivada de umbrales calibrados. |

## 4. ETL

### Extract

1. Leer telemetría dentro de un alcance autorizado.
2. Leer dispositivos, workspaces y herramientas mínimos para enriquecer eventos.
3. Leer agregados diarios para controles de reconciliación.
4. Leer datasets sintéticos reproducibles desde el directorio aislado de Ciencia de Datos.

La extracción se ejecuta solo contra Emulator Suite, datos controlados exportados o archivos sintéticos. No incluye Firebase cloud ni datos empresariales reales.

### Transform

1. Validar columnas y tipos contra el contrato analítico.
2. Renombrar campos a `snake_case` sin alterar el contrato de la aplicación.
3. Verificar unicidad de `execution_id`.
4. Parsear timestamps como UTC y comprobar el orden temporal.
5. Normalizar `tool_id`, `action`, versión y plataforma mediante allow-lists.
6. Unir `device_platform` por `device_id`, conservando únicamente atributos permitidos.
7. Calcular duración en segundos, transformación logarítmica y variables temporales cíclicas.
8. Mantener `status` y `error_code` como contexto para EDA/explicación, no como features primarias.
9. Separar datos por origen y reservar conjuntos de evaluación temporalmente posteriores.
10. Reconciliar conteos diarios con `telemetryDaily` cuando ambos orígenes estén presentes.

### Load

| Destino | Uso |
| --- | --- |
| Dataset analítico bruto | Reproducibilidad y auditoría de la extracción. |
| Dataset limpio con variables derivadas | EDA y entrenamiento. |
| Resultado de scoring | Dashboard futuro, Health Score y Priority Engine. |

Los archivos que representen datos reales controlados se mantendrán fuera de Git si contienen información que no deba publicarse, incluso cuando use IDs opacos. Los datasets puramente sintéticos sí pueden ser versionables.

## 5. Limpieza y calidad

| Condición | Tratamiento | Clasificación |
| --- | --- | --- |
| `execution_id` duplicado con mismo contenido | Conservar una observación y registrar el duplicado. | Calidad/idempotencia. |
| `execution_id` duplicado con contenido distinto | Rechazar y registrar conflicto. | Calidad crítica. |
| `duration_ms <= 0` | Aislar para revisión; no entrenar como normal. | Calidad o ejecución incompleta. |
| `duration_ms > 43,200,000` | Rechazar por violar el contrato de doce horas. | Calidad crítica. |
| Timestamp inválido u orden temporal imposible | Rechazar/aislar. | Calidad crítica. |
| Herramienta, acción o estado fuera de allow-list | Rechazar/aislar. | Calidad crítica. |
| `error_code` incongruente con éxito | Rechazar por contrato. | Calidad crítica. |
| Valor extremo que cumple contrato | Conservar y analizar. | Posible anomalía operacional. |
| Campo opcional nulo | Conservar con marcador de ausencia; no inventar valores. | Calidad no crítica. |

Un outlier válido no es un dato defectuoso. El pipeline debe impedir que errores de captura entrenen el modelo, pero debe preservar ejecuciones largas o inusuales que puedan ser señal operacional legítima.

## 6. EDA reproducible

El EDA debe contestar antes del modelado:

1. ¿Cuántas ejecuciones hay por origen, herramienta, workspace y plataforma?
2. ¿Cómo se distribuyen las duraciones y qué transformación necesitan?
3. ¿Cambian mediana, percentiles o dispersión entre Clean Vector PRO y Sep Maker PRO?
4. ¿Existen diferencias temporales por hora o día?
5. ¿Qué versiones, herramientas o estaciones concentran fallos/cancelaciones?
6. ¿Cómo evolucionan duración, tasa de anomalía y resultado a través del tiempo?

Gráficos mínimos: conteos por categoría, histogramas, boxplots por herramienta, series temporales, matriz de tasas por herramienta/plataforma, gráficos de percentiles y tabla de posibles anomalías MAD/IQR. Cada gráfico debe desagregar `data_origin` para no confundir simulación con operación controlada real.
