# Operation Suite Intelligence — modelo y decisiones

## 1. Isolation Forest

### Objetivo

Detectar ejecuciones operacionalmente atípicas, incluso cuando su `status` sea `success`. El modelo no pretende predecir errores ni juzgar personas; identifica desviaciones de patrón para que un administrador pueda investigarlas.

### Segmentación de modelos

La configuración objetivo es un modelo Isolation Forest por grupo homogéneo de herramienta y acción:

| Modelo | Grupo |
| --- | --- |
| `clean_vector_clean_art` | Clean Vector PRO / `CLEAN ART` |
| `sep_maker_apply` | Sep Maker PRO / `Apply` |

La decisión evita mezclar distribuciones naturalmente diferentes de duración. Cada modelo específico solo se habilita cuando el grupo alcance una muestra suficiente y cubra varias fechas. Mientras eso no ocurra, el pipeline habilitará un modelo combinado temporal con `tool_id` y `action` codificados, etiquetado explícitamente como fallback.

### Features

| Feature | Uso | Motivo |
| --- | --- | --- |
| `log_duration` | Sí, versión inicial | Señal principal, menos sensible a cola larga. |
| `hour_sin`, `hour_cos` | Candidata | Se habilita solo si la ablación temporal reduce falsos positivos o mejora F1. |
| `day_sin`, `day_cos` | Candidata | Se habilita solo si la ablación temporal reduce falsos positivos o mejora F1. |
| `device_platform` | Candidata, one-hot | Cardinalidad baja; no se activa sin mejora demostrada. |
| `tool_version` | Condicional | Solo si hay observaciones, variación y mejora demostrada. |
| `tool_id`, `action` | Solo fallback combinado | No son necesarios dentro de modelos específicos. |
| `workspace_id`, `device_id`, `account_id`, `actor_uid` | No | Alta cardinalidad; se reservan para grupos y explicación. |
| `status`, `error_code` | No | Evita que el modelo aprenda “fallo = anomalía”. |

La primera evaluación sintética confirmó esta disciplina: añadir de entrada contexto temporal/plataforma elevó falsos positivos frente a la feature mínima de duración. Por ello, el pipeline conserva `log_duration` como configuración inicial y documenta las demás variables como candidatas de ablación, no como mejoras asumidas.

### Puntaje y sensibilidad

Isolation Forest produce un puntaje continuo. La sensibilidad no se definirá mediante un número arbitrario fijo: se calibrará sobre un conjunto de validación temporal y se guardará como configuración versionada.

La interfaz futura podrá exponer tres políticas administrativas:

| Sensibilidad | Objetivo de alerta | Regla de calibración inicial |
| --- | --- | --- |
| Low | Pocas alertas, alta precisión esperada | Umbral cercano al percentil 99 de rareza en baseline. |
| Medium | Balance operativo | Umbral cercano al percentil 97.5. |
| High | Mayor cobertura, más revisión manual | Umbral cercano al percentil 95. |

Los percentiles son puntos de partida de validación, no afirmaciones de precisión. La configuración deberá registrar fecha, dataset, modelo, ventana temporal, umbral y responsable administrativo.

## 2. Línea base estadística

Antes de adoptar el modelo, cada grupo herramienta/acción tendrá un baseline robusto:

```text
median_duration = mediana(log_duration)
MAD = mediana(|log_duration - median_duration|)
robust_z = 0.6745 * (log_duration - median_duration) / MAD
```

Una observación será candidata para el baseline cuando su valor absoluto de `robust_z` supere un umbral definido y documentado. Si `MAD = 0`, se utilizará IQR como fallback. Este baseline es explicable, fácil de revisar y permite comparar Isolation Forest contra una referencia no supervisada sencilla.

## 3. Evaluación

### Separación de datos

La separación se hará por tiempo, no aleatoriamente: el entrenamiento usará el período inicial y evaluación el período posterior. Esto evita que eventos temporalmente cercanos del mismo patrón queden simultáneamente en entrenamiento y evaluación.

### Anomalías sintéticas conocidas

El generador sintético inyectará anomalías documentadas, principalmente ejecuciones exitosas con duración inusual. `expected_anomaly` no será feature; solo se consultará después del scoring para evaluar detección.

### Métricas

| Métrica | Uso |
| --- | --- |
| Precision | Proporción de alertas que correspondieron a anomalías conocidas. |
| Recall | Proporción de anomalías conocidas detectadas. |
| F1 | Balance entre Precision y Recall. |
| Precision@K | Calidad de las primeras K alertas que un administrador revisaría. |
| Tasa de falsos positivos | Carga operativa generada por alertas incorrectas. |
| Comparación MAD/IQR | Verificar si Isolation Forest mejora o complementa el baseline. |

Los resultados sobre datos sintéticos no se generalizarán como rendimiento productivo. Las ejecuciones reales controladas se utilizarán para revisión manual y validación de plausibilidad.

### Resultado inicial reproducible

La corrida `v0.1` separó cronológicamente 1,440 eventos sintéticos en 1,007 observaciones de entrenamiento y 433 de evaluación. Isolation Forest, limitado deliberadamente a `log_duration`, obtuvo F1 de **0.571** para Clean Vector PRO / `CLEAN ART` y **0.889** para Sep Maker PRO / `Apply`. El baseline MAD obtuvo respectivamente **0.909** y **1.000**.

Por tanto, el baseline es actualmente la referencia operativa más precisa para este conjunto univariado sintético. Isolation Forest se conserva como técnica académica identificada y como candidato para telemetría multivariable futura, pero no se declarará superior ni se usará para automatizar decisiones. Los dos resultados se mostrarán juntos, con revisión humana obligatoria.

## 4. Operational Health Score

### Principio

El Operational Health Score es una capa determinística, trazable y separada del modelo. Convierte señales de un período y entidad determinada —global, cuenta, workspace, dispositivo o herramienta— en una escala de 0 a 100.

No se afirmará una ponderación de negocio sin evidencia. La versión inicial usa el promedio no ponderado de componentes válidos; esto evita asignar importancia subjetiva a una señal antes de calibrarla. Cualquier peso futuro deberá estar versionado, justificado, probado y visible para el Super Administrator.

### Componentes posibles con los datos actuales

| Componente | Cálculo inicial | Datos requeridos |
| --- | --- | --- |
| Outcome Health | `100 × successful_runs / total_runs`. | `status`. |
| Anomaly Health | `100 × (1 - anomaly_rate_adjusted)`. | Resultado del modelo y volumen. |
| Processing Health | Penaliza desviación de mediana contra baseline del mismo grupo herramienta/acción/versión. | `duration_ms`, baseline. |
| Trend Health | Penaliza deterioro reciente de duración, anomalía o fallo frente al período anterior mediante medida robusta. | Series temporales. |

La implementación de referencia usa el límite superior Wilson al 95% para `anomaly_rate_adjusted` y una muestra mínima de 20 ejecuciones para Processing y Trend Health. Si un componente no tiene evidencia suficiente, se excluye y el promedio no ponderado se calcula sobre los componentes restantes.

### Estados preliminares

| Rango | Estado | Interpretación |
| --- | --- | --- |
| 90–100 | Healthy | Sin señal prioritaria detectada. |
| 75–89 | Monitor | Requiere observación. |
| 60–74 | High Risk | Requiere revisión administrativa. |
| 0–59 | Critical | Atención prioritaria. |

Estos rangos serán calibrados después de revisar el EDA y resultados de evaluación; no deben presentarse como umbrales productivos definitivos.

## 5. Priority Engine

La prioridad debe ser reproducible y no depender de un LLM. La primera versión será un orden lexicográfico explicable:

1. estado de salud, de peor a mejor;
2. menor Health Score;
3. cantidad de anomalías de alta/critical severidad;
4. degradación reciente robusta;
5. tasa de fallo/cancelación;
6. recencia de la última anomalía;
7. identificador opaco, solo para desempate determinista.

Este orden evita ocultar pesos arbitrarios. Una versión posterior puede calcular un puntaje de prioridad, pero deberá conservar los mismos contribuyentes, el orden de negocio aprobado y una explicación por cada componente.

### Explicabilidad: Why Flagged

La explicación se construirá con reglas determinísticas sobre métricas observadas. Ejemplo de salida:

```text
Workspace: ws_opaque_04
Health Score: 68 / 100
Contribuyentes:
- Mediana de duración 41% por encima del baseline Sep Maker PRO / Apply.
- 8 ejecuciones anómalas en el período seleccionado.
- Tasa de fallo aumentó de 4% a 11% frente al período anterior.
- 4 anomalías provienen del dispositivo dev_opaque_04.
Acción recomendada: revisar actividad de dev_opaque_04 y Sep Maker PRO.
```

La explicación solo se emite si cada afirmación tiene datos suficientes y comparación definida. Nunca inventa causas ni atribuye responsabilidad individual.
