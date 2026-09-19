# Operation Suite Intelligence — auditoría post-implementación

**Fecha:** 2026-09-15. **Rama:** `feature/ciencia-datos-ii-final`. **HEAD auditado:** `9776ef3`.

Verificación independiente del cierre registrado en [FINAL_IMPLEMENTATION_LOG.md](FINAL_IMPLEMENTATION_LOG.md) y [FINAL_ACCEPTANCE.md](FINAL_ACCEPTANCE.md). No se aceptó ninguna cifra por reporte: cada valor se reejecutó desde el pipeline o se midió sobre la aplicación en ejecución. El árbol quedó limpio; no hubo push, merge, deploy ni cambios de billing.

## Reproducibilidad del pipeline

`generate`, `etl`, `train`, `score`, `evaluate`, `eda`, `intelligence`, la referencia Python y `write-final-report.mjs` se reejecutaron completos. Los 43 artefactos versionados de `artifacts/v0.2/` quedaron **byte-idénticos** (SHA-256 comparado antes y después). El documento final `.md` se regenera idéntico desde los artefactos, de modo que ninguna cifra del informe está escrita a mano. El único cambio no determinista es `CreationDate` dentro de `EDA_FIGURES.pdf`; removida esa marca, el PDF es idéntico byte a byte.

## Ausencia de fuga de información

La afirmación «el test no selecciona el detector» se probó de forma adversarial, no solo por lectura de código:

| Experimento | Resultado |
| --- | --- |
| Invertir etiquetas y multiplicar duraciones del período **test** | Selección y umbrales **sin cambio** |
| Forzar que IF gane en **calibration** | Selección cambia a **IF** en ambos grupos |
| Retirar todas las etiquetas de calibration | `MAD_FIXED_UNVALIDATED_FALLBACK` declarado |

La selección responde únicamente a la evidencia de calibration, y responde de verdad: no es un valor fijo disfrazado. El artefacto registra `uses_test: false`. En el escenario real MAD gana con F1 de calibration 1,0000 frente a IQR 0,9333 e IF 0,9032, sin necesidad de desempate.

## Métricas recalculadas

Test reservado de 648 ejecuciones, 648 etiquetadas. Valores obtenidos al reejecutar, no copiados:

| Detector | Precision | Recall | F1 | TP | FP | TN | FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IF | 0,7895 | 1,0000 | 0,8824 | 30 | 8 | 610 | 0 |
| MAD | 1,0000 | 1,0000 | 1,0000 | 30 | 0 | 618 | 0 |
| IQR | 0,8571 | 1,0000 | 0,9231 | 30 | 5 | 613 | 0 |

Correlaciones Spearman contra scikit-learn 1.7.2: 0,9420 y 0,9573. Inferencia: 2.885 ejecuciones puntuadas cargando `model.json`, sin entrenar. Dataset: 6.125 registros aceptados, 0 rechazados, 0 duplicados, 0 conflictos, 180 días, origen íntegramente `SYNTHETIC`.

## Comprobaciones sobre el sistema en ejecución

Los diez KPI del panel se contrastaron uno a uno contra el contrato de resultados: coinciden exactamente. Los filtros recalculan observaciones, salud, entidades y tendencias; cambiar de detector altera el recuento de anomalías (IF 845, MAD 810, IQR 838), lo que confirma que no son filtros cosméticos. RBAC denegó `manager`, `team_leader`, `artist`, `client`, sesión ausente y dos intentos de escalada, tanto en navegación como en proyección; el backend local rechaza token falso y deniega el modo controlado fuera de Emulator. Los archivos crudos de datos y el modelo responden 403.

ES/EN tiene paridad completa (957 claves por idioma, 194 de Intelligence) sin caracteres dañados ni mezcla residual. Los cinco estados de salud se distinguen por texto e icono además del color, con contraste WCAG AA medido entre 8,26 y 12,02. Los 102 enlaces locales de la documentación resuelven.

## Suites reejecutadas

287 locales, 23 Functions, 14 reglas Firestore, 5 integración con Node 22, 13/13 navegador sin excepciones, build correcto y `git diff --check` limpio. Las cifras coinciden con las reportadas en el cierre.

## Observaciones registradas

- `device_sparse_1` aparece en el dataset pero no en el período de inferencia: el escenario `sparse` baja a una ejecución cada 18 días y solo alcanza al primer dispositivo. El panel muestra 9 dispositivos porque informa lo observado en el período, mientras el dataset documenta 10. No es un defecto; conviene poder explicarlo.
- `expected_anomaly` admite `unknown`/`null`, que se proyectan como no evaluables (`status: NOT EVALUABLE`, métricas `null`). El origen `SYNTHETIC` exige etiqueta porque el generador conoce la verdad; `REAL_CONTROLLED` la admite ausente.
- Las particiones de evaluación caen dentro de los 90 días de desarrollo, donde las etiquetas provienen solo de las desviaciones inyectadas y no del comportamiento de escenario. El benchmark no hereda etiquetas de nivel de escenario.
- `.cache/fix-intelligence-copy.py` es una herramienta de un solo uso que reparó acentos en `src/i18n-intelligence.js`. Nunca estuvo versionada, `.cache/` está ignorada y su efecto ya está en el commit correspondiente. No es necesaria para reproducir nada y se conserva sin incluirla en la entrega.

## Límites de esta auditoría

Se verificó el alcance académico local y sintético. No se validó despliegue, datos empresariales reales ni generalización productiva, que siguen sin estar afirmados por la entrega.
