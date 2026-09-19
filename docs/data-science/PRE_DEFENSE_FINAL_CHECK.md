# Operation Suite Intelligence — chequeo final previo a la defensa

**Estado:** PRE-DEFENSE FREEZE — revalidado el 2026-09-18 sobre `feature/ciencia-datos-ii-final`, commit *feat(intelligence): enhance interactive defense experience* (padre `5b331e1`). Los artefactos científicos son idénticos byte a byte a los de `0cd97ef`.
**Alcance:** Ciencia de Datos II, dataset sintético v0.2, local. Sin deploy, push ni datos reales.

## 1. Comando para iniciar la demo

Una sola terminal, en la raíz del repositorio:

```powershell
npm.cmd run demo:intelligence -- --port 5177 --strictPort
```

**URL:** `http://127.0.0.1:5177`

No requiere credenciales, Java, Emulator ni Bridge. La insignia **Bridge no disponible** es esperada.

## 2. Ruta exacta de clics

1. Abre `http://127.0.0.1:5177` → el selector ya está en **Super Administrador**.
2. Clic en **Intelligence** en la navegación lateral.
3. Clic en **▶ Modo defensa**. Confirma la barra inferior con **DEMO ACADÉMICA — DATOS SINTÉTICOS**, el banner **Dataset académico sintético** y el recuadro que declara identidad sintética y puente local no necesario.
4. **1 Visión global** → **Salud global 65,73 · Alto riesgo** y los 10 KPI. Clic en la tarjeta **Salud global** → Health Explorer (cuatro componentes, peso 25 % cada uno según el contrato) → Escape.
5. **Período → 30 días** → panel **Filtro aplicado** (sección 5) → **Restablecer filtros**.
6. **2 Salud** → Cuentas, Workspaces, Dispositivos, Herramientas (los cinco estados, incluido *Datos insuficientes*). **◎ Ver workspace prioritario** → Health Explorer del workspace oficial (sección 4) → Escape.
7. **3 Anomalía** → **✦ Mostrar anomalía destacada** → *Por qué se marcó* de la anomalía oficial (sección 3) → **Cerrar detalles** o Escape.
8. **4 Prioridad** → leer la entrada 1 → **Detalles** → Escape.
9. **Tendencias** (6 gráficos; flechas o ratón para leer un punto, Enter abre **Datos del gráfico**).
10. **5 Modelos** → Model Comparison Lab (sección 6). Opcional: **IF** en *Detector en foco* → **SOLO COMPARACIÓN**; vuelve a **MAD**.
11. **Calidad de datos** (6125 entrada / 6125 aceptados / 0 rechazados).
12. **6 Conclusión**. Si surge una pregunta técnica o queda tiempo, pulsar **Abrir glosario de defensa**: buscar `F1`, `P95` o `MAD`, comprobar categoría y cerrar con Escape. El glosario es auxiliar, no es un séptimo paso ni modifica resultados.
13. Botón de idioma **ES/EN** y **volver a ES**. **Salir del modo defensa**.

## 3. Anomalía oficial

`exec_v02_0005709` — la elige **✦ Mostrar anomalía destacada** con la política documentada (severidad → distancia a la mediana en escala logarítmica → más reciente → identificador); no está fijada en el código. También es la primera fila al ordenar **Duración** descendente.

| Campo | Valor |
| --- | --- |
| Cuenta / workspace / dispositivo | `account_demo_b` / `workspace_incident` / `device_incident_1` |
| Herramienta / acción / versión | `sepmaker-pro` / `Apply` / 1.6.0 |
| Resultado | Fallo (`PROCESSING_FAILED`) |
| Duración observada | **196,06 s** |
| Referencia histórica (mediana) | 11,18 s |
| P95 de referencia | 16,81 s |
| Desviación respecto a la mediana | **1653,29 %** (≈17,5×) |
| Isolation Forest | score 0,77 · umbral 0,63 |
| MAD | score 14,98 · umbral 3,5 |
| IQR | score 10,38 · umbral 1,5 · intervalo 6,66 – 19,04 s |
| Detectada por | IF, MAD, IQR |
| Detector de decisión | **MAD** |
| Severidad | Crítica |
| Acción recomendada | Revisar las ejecuciones recientes de esta entidad |

Frase de cierre: *son observaciones de duración y resultado; no afirman causa técnica ni evalúan a personas.*

## 4. Workspace oficial

`account_demo_b / workspace_incident` — prioridad **1** entre workspaces (3 en la cola global). Se abre con **◎ Ver workspace prioritario**, que lo deriva de la cola.

| Campo | Valor |
| --- | --- |
| Salud / estado | **3,33** · Crítico |
| Muestra / referencia | 720 ejecuciones · 432 de referencia |
| Tasa de éxito | 12,36 % |
| Tasa de anomalías | 98,33 % (referencia 3,47 %) |
| Tasa de fallos | 76,67 % (referencia 2,08 %) |
| Tasa de cancelación | 10,97 % (referencia 0,46 %) |
| Duración mediana | 25,32 s |
| Razón principal | ANOMALY_RATE, con FAILURE_RATE, CANCELLATION_RATE y DURATION_INCREASE |
| Acción recomendada | Revisar la actividad reciente del workspace |

**Aislamiento por cuenta:** `workspace_shared` existe en las dos cuentas y no se mezcla —
`account_demo_a` 96,35 (Saludable) vs `account_demo_b` 71,85 (Alto riesgo), 720 ejecuciones cada uno y dispositivos distintos.

## 5. Los dos filtros oficiales

**Filtro 1 — Período: 30 días**

| KPI | Antes (90 días) | Después (30 días) |
| --- | --- | --- |
| Salud global | 65,73 | 64,75 |
| Ejecuciones | 2885 | **961** |
| Tasa de éxito | 62,63 % | 62,02 % |
| Anomalías | 810 | **274** |
| Altas / críticas | 242 | 94 |
| Duración mediana | 10,93 s | 11,18 s |

El panel **Filtro aplicado** muestra ejecuciones, anomalías, salud global, tasa de éxito y duración mediana antes → después.

**Filtro 2 — Workspace: `account_demo_b / workspace_incident`**

| KPI | Antes (todos) | Después |
| --- | --- | --- |
| Salud global | 65,73 (Alto riesgo) | **3,33 (Crítico)** |
| Ejecuciones | 2885 | **720** |
| Tasa de éxito | 62,63 % | **12,36 %** |
| Anomalías | 810 | **708** |
| Duración mediana | 10,93 s | **25,32 s** |

Pulsar **Restablecer filtros** después de cada uno.

## 6. Métricas oficiales (test reservado, 648 ejecuciones)

Lo que aparece en pantalla, grupo `total` (la pantalla redondea a 2 decimales; el PDF usa 4):

| Detector | Precisión | Recall | F1 | TP | FP | TN | FN |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IF | 0,79 | 1 | 0,88 | 30 | 8 | 610 | 0 |
| MAD | **1** | **1** | **1** | 30 | 0 | 618 | 0 |
| IQR | 0,86 | 1 | 0,92 | 30 | 5 | 613 | 0 |

Valores exactos del pipeline: IF F1 0,8824 · MAD 1,0000 · IQR 0,9231.

Relato: **IF** es el modelo ML principal; **MAD** baseline robusto; **IQR** baseline estadístico.
**Detector de decisión = MAD** en los dos grupos, elegido por **F1 de calibración**; el test nunca selecciona.
MAD gana en este dataset sintético y eso se dice sin adornos: no se promete superioridad universal.

## 7. Plan B

Ya es el comando de la sección 1 (modo offline `ACADEMIC_SYNTHETIC`), y conserva Intelligence, KPI, anomalías, Why Flagged, Priority y Modelos. Verificado en navegador real el 2026-09-18: aceptación 13/13 (`browser-checks.json`) y experiencia de defensa 106/106 (`defense-checks.json`), sin excepciones.

Si además quieres login real con Auth Emulator (tres terminales, requiere Java y Node 22 de `.cache/node22/`), el procedimiento está en [DEMO_RUNBOOK.md](../../DEMO_RUNBOOK.md) — verificado 9/9. **No es necesario para la defensa.**

Otros imprevistos:

- **Puerto 5177 ocupado:** usa otro puerto en el comando y abre esa dirección. No detengas procesos ajenos.
- **"Resultados faltantes":** `npm.cmd run data-science:train` y `npm.cmd run data-science:intelligence`, y recarga.
- **Proyector:** verificado sin recortes a 1920×1080, 1600×900, 1366×768, 1280×720, 1024×768, 768×1024, 1366×633 y 1280×585. La barra lateral hace scroll propio si no cabe; los identificadores no se parten; las tablas anchas hacen scroll horizontal dentro de su marco con filas compactas; los diálogos caben en pantalla con el botón de cierre visible. El modo defensa deja más espacio con la navegación reducida a iconos. Antes/después medido en `evidence/before-after-layout.json`.

## 8. Cómo cerrar la demo

`Ctrl+C` en la terminal de la sección 1. No hay nada más que apagar: sin Emulator, sin deploy, sin servicios en segundo plano.

## 9. Preguntas con respuesta corta

- **¿Por qué 9 dispositivos si el dataset tiene 10?** `device_sparse_1` no tiene ejecuciones en la ventana de inferencia; el panel muestra el período, no el histórico.
- **¿Por qué una anomalía crítica de 0,67 s?** Los detectores marcan desviación en ambos sentidos: también lo anormalmente rápido.
- **¿Hay fuga de etiquetas?** La única feature es `log_duration`; `status`, `error_code` e `expected_anomaly` están excluidos. Una prueba duplica duraciones e invierte etiquetas en todo el período de test y el artefacto no cambia.
- **¿Por qué algunas entidades no tienen score?** Menos de 20 ejecuciones por grupo comparable → `insufficient_data` y score nulo.

Evidencia completa: [FINAL_ACCEPTANCE.md](FINAL_ACCEPTANCE.md) · [runbook](../../DEMO_RUNBOOK.md) · [guion](../../PRESENTATION_OUTLINE.md).
