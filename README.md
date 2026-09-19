# Operation Suite Intelligence

**Proyecto final — Ciencia de Datos II**
Miguel Carranza · 2026-09-15

Detección de anomalías sobre telemetría de operaciones, entregada como vista nativa
dentro de una Web App real y no como cuaderno suelto. El modelo académico es
**Isolation Forest**, contrastado contra dos baselines estadísticos (**MAD** e **IQR**)
sobre el mismo conjunto de prueba reservado.

---

## Cómo ejecutarlo (3 comandos)

Requiere **Node 22 o superior**. No requiere Python, ni Java, ni Firebase, ni cuenta
alguna: los artefactos del pipeline vienen versionados y la aplicación corre en modo
offline contra ellos.

```powershell
npm ci
npm run data-science:train
npm run demo:intelligence -- --port 5177 --strictPort
```

Abrir **http://127.0.0.1:5177** → seleccionar **Super Administrador** → pestaña **Intelligence**.

El segundo comando es opcional para ver la interfaz: reproduce el pipeline completo
(genera el dataset, ETL, entrena, califica, evalúa y EDA) y vuelve a escribir los
artefactos. Si solo se desea ver el resultado, basta con `npm ci` y el tercer comando,
porque los artefactos ya están en el repositorio.

### Verificar sin abrir el navegador

```powershell
npm run test:data-science     # pipeline, detectores, contrato analítico
npm run test:intelligence     # servicio, presentación, layout y glosario de la vista
```

### Verificación automatizada de la interfaz

Con el demo corriendo en el puerto 5177, y con Chrome o Edge instalados:

```powershell
npm run verify:intelligence-defense
```

Maneja un navegador headless real, compara cada número en pantalla contra el valor
recalculado en Node desde el mismo contrato de resultados, y falla si la interfaz
muestra una cifra que el pipeline no produjo. Escribe capturas y
`docs/data-science/evidence/defense-checks.json`.

---

## Por dónde leer

| Documento | Qué contiene |
|---|---|
| [Proyecto Final - Ciencia de Datos II.md](Proyecto%20Final%20-%20Ciencia%20de%20Datos%20II.md) | El informe de la entrega. También en PDF y HTML. |
| [data-science/README.md](data-science/README.md) | El pipeline académico etapa por etapa, artefactos y decisiones de diseño. |
| [docs/data-science/DATASET_AND_ETL.md](docs/data-science/DATASET_AND_ETL.md) | Origen del dataset, validación, limpieza y variables derivadas. |
| [docs/data-science/MODEL_AND_DECISION_DESIGN.md](docs/data-science/MODEL_AND_DECISION_DESIGN.md) | Isolation Forest, baselines, umbrales, particiones y criterio de selección. |
| [docs/data-science/FINAL_ACCEPTANCE.md](docs/data-science/FINAL_ACCEPTANCE.md) | Evidencia de aceptación final. |
| [docs/data-science/evidence/](docs/data-science/evidence/) | Capturas y JSON de las verificaciones ejecutadas. |
| [PRESENTATION_OUTLINE.md](PRESENTATION_OUTLINE.md) | Esquema de la defensa. |

Código del análisis en [data-science/lib/](data-science/lib/) y
[data-science/scripts/](data-science/scripts/); la vista en
[src/views/IntelligenceCenter.jsx](src/views/IntelligenceCenter.jsx) y
[src/intelligence/](src/intelligence/).

---

## Naturaleza de los datos

El dataset es **sintético y determinístico**, generado por
[data-science/lib/synthetic-telemetry.mjs](data-science/lib/synthetic-telemetry.mjs)
con semillas fijas, por lo que la ejecución es reproducible. El adaptador para
telemetría controlada existe y está probado, pero solo contra emulador local: **este
trabajo no lee datos de producción**. El navegador nunca recibe CSV ni modelos; el
endpoint local entrega únicamente el resultado ya validado contra el contrato 2.0.0.

## Alcance de este repositorio

Operation Suite Intelligence es un módulo de Operations Suite, una plataforma mayor.
Este repositorio contiene **solo lo necesario para leer y ejecutar Intelligence**: el
pipeline de datos, la vista y la cáscara de la aplicación que la monta. Quedan fuera,
por no participar del análisis, las Cloud Functions, el puente local con Adobe
Illustrator, la extensión CEP, las reglas de Firebase y el control de costos. Algunos
comandos citados en el README académico (`test:functions`, `test:all`,
`export-intelligence-document.mjs`) pertenecen a ese repositorio completo y no están
aquí; todo lo que esta página indica sí corre.
