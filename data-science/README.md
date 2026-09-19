# Operation Suite Intelligence — pipeline académico

## Proyecto final v0.2 — 2026-09-15

Este bloque sustituye las instrucciones del avance que se conservan abajo como historia. Intelligence está integrada en la Web App nativa y protegida por Super Admin. La defensa usa datos **SYNTHETIC**; el adaptador **REAL_CONTROLLED** está preparado y probado únicamente contra Emulator. No se lee producción.

### Requisitos

Node 22 o superior; para Functions/Emulator usar Node 22 de `.cache/node22/`. Dependencias JavaScript: `npm.cmd ci` y `npm.cmd --prefix functions ci`, siempre dentro del proyecto. Firebase Emulator requiere Java. La referencia/figuras utiliza Python 3.12 y los paquetes fijados en `validation/requirements.txt`.

Esta estación dispone de `.cache/python312/python.exe` con esos paquetes. En otra estación, crear un entorno Python dentro del proyecto y dirigir también la caché de pip al proyecto:

```powershell
python -m venv .cache/intelligence-python
.cache/intelligence-python/Scripts/python.exe -m pip install --cache-dir .cache/pip -r data-science/validation/requirements.txt
```

### Pipeline exacto, desde la raíz

```powershell
npm.cmd run data-science:generate      # genera dataset.csv v0.2
npm.cmd run data-science:etl           # valida, limpia y deriva processed.csv + quality.json
npm.cmd run data-science:train         # reproducción integrada: genera/ETL/entrena/score/eval/EDA
npm.cmd run data-science:score         # carga model.json; NO entrena
npm.cmd run data-science:evaluate      # test reservado, NO selecciona el detector
npm.cmd run data-science:eda           # especificaciones de 32 gráficos
.cache/python312/python.exe data-science/validation/reference_and_figures.py
npm.cmd run data-science:intelligence  # result contract validado, sin entrenamiento
node data-science/scripts/write-final-report.mjs
node scripts/export-intelligence-document.mjs # HTML/PDF; Chrome/Edge local y marked del lockfile
npm.cmd run test:data-science
npm.cmd run test:intelligence
npm.cmd run test:all                   # incluye data-science/tests y pruebas Intelligence
npm.cmd run build
npm.cmd run demo:intelligence -- --port 5177 --strictPort
```

La referencia Python debe usar el intérprete del entorno creado si no existe `.cache/python312/`. La UI funciona con los artefactos versionados incluso sin Python. Abrir `http://127.0.0.1:5177`, seleccionar Super Administrador y entrar a Intelligence. Para login real local, usar `demo:intelligence:emulator` después de iniciar Emulator y conceder el claim con el helper descrito en [DEMO_RUNBOOK.md](../DEMO_RUNBOOK.md).

### Artefactos y decisiones

- `artifacts/v0.2/model.json`: árboles IF serializados, MAD/IQR, umbrales, semillas, selección por calibration y particiones 54/18/18/90 días.
- `scored.json`: inferencia independiente de entrenamiento. `metrics.json`: precision/recall/F1 y confusión de cada detector sobre test reservado.
- `intelligence-result.json`: contrato 2.0.0 con metadata/origen/versiones, calidad, salud, entidades, anomalías, prioridad, tendencias, detectores y filtros.
- `eda.json`, 32 SVG y `figures/EDA_FIGURES.pdf`: datos/figuras reproducibles. `reference-validation.json`: comparación numérica independiente con scikit-learn.
- IF es el modelo ML académico; MAD/IQR son baselines. La selección usa F1 de calibration entre candidatos fijos, con desempate MAD/IQR/IF. El test no modifica esa selección. Las métricas finales se leen del pipeline; el frontend nunca las hardcodea.
- `computed_at` en el fixture académico usa el cierre determinístico del dataset para reproducibilidad; no afirma la hora de ejecución del comando. El modo controlado usa la hora de cómputo real.
- La referencia académica de Health es train, anterior a la inferencia. El filtro de período se ancla al último día del dataset, no a la fecha del ordenador. Los estados requieren una muestra mínima por grupo comparable.

### Privacidad y acceso

El navegador no carga CSV ni modelos. El endpoint de desarrollo valida resultados y tokens; los archivos de datos/artifacts están bloqueados por Vite. Modo offline entrega solo una capacidad sintética local, sin datos reales ni privilegios productivos. Modo Emulator comprueba el claim del token. Telemetría controlada y derivados privados permanecen en memoria o en las rutas ignoradas `data/real-controlled/` y `artifacts/private/`; nunca se incluyen en Git.

No hay consultas ilimitadas: máximo 1.000 eventos actuales + 1.000 históricos, 400 dispositivos, 500 agregados por análisis. Cobertura incompleta y muestra insuficiente se declaran. No hay jobs, entrenamiento React, despliegue ni billing.

### Verificación y defensa

```powershell
node scripts/verify-intelligence-browser.mjs   # con demo en 5177
npm.cmd run test:functions
npm.cmd run test:firestore
# Node 22 para integración completa
$env:PATH = (Join-Path (Get-Location) '.cache/node22') + ';' + $env:PATH
npm.cmd run test:emulator-admin
git diff --check
```

Suites Emulator secuenciales. No existe script lint; se usan pruebas, build y comprobación de diff. Evidencia vigente: [FINAL_ACCEPTANCE.md](../docs/data-science/FINAL_ACCEPTANCE.md). [Runbook](../DEMO_RUNBOOK.md) y [presentación](../PRESENTATION_OUTLINE.md).

### v0.1 histórico

Datos/reportes v0.1 y PDFs de avance se conservan. Los tests de `legacy/v0.1/lib` siguen comprobando su reproducibilidad. Los comandos superiores producen exclusivamente v0.2. No ejecutar los comandos inferiores como cierre actual.

---

## Registro histórico del avance

Esta carpeta contiene artefactos aislados de Ciencia de Datos. No forma parte
del frontend, no accede a Firebase y no modifica el contrato de telemetría.

## Estructura

```text
data-science/
  data/synthetic/     Dataset público, reproducible y sin datos sensibles
  data/processed/     Dataset analítico derivado del sintético versionable
  lib/                Generación, CSV y transformaciones puras
  scripts/            Puntos de entrada de generación y ETL
  tests/              Pruebas del dataset y ETL
```

Los datos reales controlados, si se autorizan posteriormente, nunca se ubican
en `data/synthetic/` y no deben versionarse sin una revisión de privacidad.

## Comandos

```powershell
npm.cmd run data-science:generate
npm.cmd run data-science:etl
npm.cmd run data-science:eda
npm.cmd run data-science:model
npm.cmd run data-science:intelligence
npm.cmd run test:data-science
```

Los scripts usan únicamente Node.js estándar. Esta decisión evita instalar
dependencias o alterar el entorno mientras el avance académico requiere un
dataset reproducible. El EDA y el entrenamiento con Pandas/Scikit-learn se
ejecutarán en un entorno Python autorizado; actualmente Python no está
instalado como intérprete funcional en esta estación.
