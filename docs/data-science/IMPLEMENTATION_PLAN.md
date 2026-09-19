# Operation Suite Intelligence — plan de implementación e integración

## Objetivo de arquitectura

La integración debe añadir inteligencia sobre la telemetría existente, no crear una segunda fuente de verdad ni debilitar las fronteras de confianza de Operation Suite.

```text
Telemetry y agregados autorizados
  → ETL analítico aislado
  → EDA / modelo / baseline
  → resultados de anomalía y salud derivados
  → proyección autorizada para Intelligence Center
  → decisión del Super Administrator
```

## Fases

| Fase | Alcance | Estado |
| --- | --- | --- |
| A | Documento académico, diseño técnico, esquema, ETL, modelo y decisiones. | [x] COMPLETADO |
| B | Generador sintético reproducible, validación de esquema y dataset seguro. | [x] COMPLETADO |
| C | EDA reproducible y evidencia visual. | [x] COMPLETADO — reporte tabular reproducible y dos visualizaciones sintéticas en el entregable externo PDF |
| D | Preprocesamiento, Isolation Forest, MAD/IQR y evaluación. | [x] COMPLETADO — resultados sintéticos de referencia, no productivos |
| E | Operational Health Score y explicaciones determinísticas. | [x] COMPLETADO — resultados derivados de referencia |
| F | Priority Engine por workspace, dispositivo y herramienta. | [x] COMPLETADO — orden y desempates determinísticos |
| G | Web integration, controles administrativos y pruebas de integración. | [ ] PENDIENTE |

## Puntos seguros de integración futura

| Capa actual | Punto de integración | Restricción |
| --- | --- | --- |
| `src/execution-contract.js` | Fuente contractual de eventos. | No ampliar campos sin necesidad ni registrar datos sensibles. |
| `functions/src/index.js` | Persistencia y agregados server-side. | No modificar sin pruebas de Functions y Emulator. |
| `src/services/platform-data.js` | Lectura autorizada de eventos/agregados. | Evitar lecturas amplias o costosas. |
| `src/selectors/platform-projection.js` | Proyección por rol. | Reaplicar alcance; Cliente no recibe datos individuales. |
| `src/App.jsx` | Vista futura Intelligence. | Añadir solo cuando pipeline/resultados estén estables. |
| `firebase/firestore.rules` | Protección de resultados derivados. | Default-deny; sin escritura directa del navegador. |

No es necesario modificar los motores JSX, el panel CEP ni el Local Bridge para la primera versión: el contrato actual ya entrega herramienta, acción, resultado seguro y duración.

## RBAC y filtros

La primera vista Intelligence estará restringida a `super_admin`. Las futuras lecturas deberán filtrar por cuenta, workspace, herramienta, dispositivo, plataforma y período, pero la autorización se aplicará antes de ejecutar el filtro. Los roles Cliente y Artista no recibirán anomalías individuales de otros usuarios; una ampliación para Gerente deberá diseñar agregados y alcance explícitos.

La configuración administrativa futura —sensibilidad, período de baseline y pesos aprobados— será backend-managed, auditada y versionada. El navegador no será autoridad de configuración ni de resultados.

## UI objetivo

La futura capacidad puede incorporarse como una vista de navegación independiente llamada **Intelligence**, disponible únicamente para Super Administrator. Tendrá:

- Global Health y KPIs.
- tabla Workspace Intelligence;
- rankings de workspaces, dispositivos y herramientas;
- ejecuciones anómalas con baseline, score, severidad y explicación;
- tendencias de salud, anomalías, duración y resultados;
- filtros por cuenta, workspace, herramienta, dispositivo, plataforma y período;
- Intelligence Settings administrado de forma segura.

No se implementará la UI antes de validar dataset, modelo y explicación. Un dashboard sin resultados confiables sería una visualización decorativa, no una capacidad de Ciencia de Datos defendible.

## Criterios de validación por fase

| Área | Verificación |
| --- | --- |
| Dataset | Reproducible, sin secretos, IDs opacos, procedencia explícita y esquema validado. |
| ETL | Duplicados, límites de duración, timestamps y allow-lists probados. |
| EDA | Gráficos reproducibles con separación de origen de datos. |
| Modelo | Evaluación temporal, baseline MAD/IQR, Precision/Recall/F1 sobre anomalías sintéticas. |
| Health/Priority | Fórmulas, datos faltantes, desempates y explicaciones deterministas probados. |
| Web | RBAC, Firestore Rules, Functions, proyección, build y pruebas existentes sin regresión. |

## Límites de plataforma

- Firebase permanece en Spark; no se despliega nada sin autorización expresa.
- No se usan datos empresariales reales para completar el dataset académico.
- No se instalan dependencias ni se introduce infraestructura cloud solo para el avance.
- Cualquier cambio futuro a módulos de política requiere `npm.cmd run sync:policy` y `npm.cmd run test:policy-sync`.
