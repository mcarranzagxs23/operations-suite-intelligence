# Operation Suite Intelligence — Demo Runbook

## Alcance

Proyecto individual de Ciencia de Datos II. La demostración usa resultados del pipeline v0.2, dentro de Operations Suite. No requiere Illustrator, Bridge, datos empresariales ni infraestructura productiva. Idiomas: ES/EN.

## Preparación (antes de la defensa)

Trabajar en la raíz de este repositorio, rama `feature/ciencia-datos-ii-final`.

```powershell
npm.cmd run data-science:train
npm.cmd run data-science:intelligence
npm.cmd run test:all
npm.cmd run build
```

## Ruta A — Firebase Emulator y login real local

Tres terminales en la raíz. Node 22 está disponible en `.cache/node22/`:

```powershell
# Terminal 1
$env:PATH = (Join-Path (Get-Location) '.cache/node22') + ';' + $env:PATH
npm.cmd run emulators:dev
```

```powershell
# Terminal 2, cuando Auth/Functions/Firestore estén listos
npm.cmd run emulator:grant-super-admin intelligence@operationssuite.test
```

El helper crea una identidad sintética del emulador y muestra las credenciales localmente. No copiarlas al documento, Git o chat. No hace falta seedear herramientas ni cuentas para cargar el dataset académico.

```powershell
# Terminal 3
npm.cmd run demo:intelligence:emulator -- --port 5177 --strictPort
```

Abrir `http://127.0.0.1:5177`, iniciar sesión con esa identidad y abrir **Intelligence**. El servicio verifica el token emitido por Auth Emulator y el claim Super Admin. La pantalla debe decir **DEMO ACADÉMICA — DATOS SINTÉTICOS**, aunque la autenticación sea real del emulador.

## Recorrido (6 minutos de demo)

1. Abrir Operations Intelligence desde navegación. Explicar que Operations Suite es la plataforma base y esta vista es el proyecto individual.
2. Pulsar **▶ Modo defensa**. La navegación se reduce a iconos y aparece la barra inferior con la insignia **DEMO ACADÉMICA — DATOS SINTÉTICOS** y seis pasos: **Visión global → Salud → Anomalía → Prioridad → Modelos → Conclusión**. El recuadro del modo declara el servicio local sin conexión (identidad sintética, no autenticación real) y que el puente local no es necesario. Cada paso hace scroll suave a su sección real; navegar no cambia ningún dato.
3. **1 · Visión global.** Señalar la fuente **Dataset académico sintético** y la fecha ancla. Clic en la tarjeta **Salud global** → Health Explorer: score, estado, muestra y referencia, período actual y de referencia, los cuatro componentes con el peso y el aporte leídos de `metadata.health_policy`, las bandas de los umbrales, actual vs referencia y **¿Cómo se calculó?**. Cerrar con Escape; el foco vuelve a la tarjeta.
4. Filtro **Período → 30 días**. El panel **Filtro aplicado** muestra antes → después (ejecuciones, anomalías, salud global, tasa de éxito, duración mediana) y los KPI cuentan hasta su nuevo valor. El panel se queda abierto hasta **Compactar** u ocultarlo. **Restablecer filtros**.
5. **2 · Salud.** Cuentas, Workspaces, Dispositivos y Herramientas; están los cinco estados, incluido `insufficient_data`. Las dos cuentas tienen un `workspace_shared` distinto y no se mezclan. **◎ Ver workspace prioritario** abre el Health Explorer del primer workspace de la cola; un clic en cualquier fila, o Enter/Espacio sobre su identificador, abre el suyo.
6. **3 · Anomalía.** **✦ Mostrar anomalía destacada** abre *Por qué se marcó* de la anomalía que elige la política: severidad → distancia a la mediana de referencia en escala logarítmica → más reciente → identificador. Leer observada, mediana, P95, desviación (× y %), la escala visual, las tarjetas IF/MAD/IQR (score, umbral, predicción), el detector de decisión y la frase de no causalidad.
7. **4 · Prioridad.** Cola compacta; **Detalles** abre qué está mal, qué cambió, qué tan grave es y qué revisar. No afirmar CPU, red ni error humano.
8. **Tendencias** (entre Prioridad y Modelos): pasar el ratón o usar las flechas sobre un gráfico para leer semana y valor; Enter despliega **Datos del gráfico**.
9. **5 · Modelos.** Model Comparison Lab: detector de decisión **MAD**, elegido por F1 de calibración; el test solo evalúa. Tres tarjetas con Precisión, Recall, F1, TP, FP, TN y FN, y el gráfico de las tres métricas. IF es el modelo ML principal; MAD y IQR son baselines. MAD gana en este dataset sintético: no ocultarlo ni extrapolar su F1 a producción. Elegir **IF** en *Detector en foco* (**SOLO COMPARACIÓN**): cambia cuántas observaciones marcaría IF; el detector de decisión, los filtros y el Health Score no cambian.
10. Opcional: `account_demo_c` → muestra insuficiente; añadir resultado `failure` → estado vacío honesto. Restablecer.
11. **6 · Conclusión.** Hechos derivados del panel: entidad prioritaria, workspace, anomalía y detector. Presentar la decisión: revisar las ejecuciones recientes de la entidad priorizada y verificar la evidencia antes de actuar.
12. **Opcional — Glosario de defensa.** Úsalo solo si surge una pregunta técnica o al final si queda tiempo. El botón **Abrir glosario de defensa** abre una búsqueda por término, sigla, descripción o categoría; no cambia filtros, detector ni resultados.
13. Cambiar ES/EN con el botón del idioma y volver a ES. **Salir del modo defensa** restaura la navegación completa.
13. Cerrar: valor añadido = observaciones → salud contextual → revisión priorizada y explicada. No hay acciones administrativas automáticas.

## Plan B — sin Emulator

Cerrar únicamente la Web App de la terminal 3 con Ctrl+C y arrancar:

```powershell
npm.cmd run demo:intelligence -- --port 5177 --strictPort
```

Abrir la misma dirección. La plataforma entra en modo demo, con el selector **Super Administrador**. No requiere credenciales. Recorrer exactamente los mismos resultados sintéticos. Explicar que este modo usa una identidad sintética local y no demuestra autenticación personal. La prueba `test:emulator-admin` conserva evidencia separada del acceso mediante tokens reales.

Si el servicio informa resultados faltantes, ejecutar `data-science:train` y `data-science:intelligence`, y volver a cargar. Si el puerto 5177 está ocupado, usar otro puerto en el comando y abrir esa dirección; no detener procesos ajenos. Si hay un error de permisos, comprobar que se usa la cuenta del emulador con claim Super Admin.

La insignia **Bridge no disponible** es esperada: Intelligence no necesita el conector ni Illustrator. No intentar emparejarlos durante esta defensa.

## Evidencia automatizada

Con la ruta B abierta en 5177:

```powershell
node scripts/verify-intelligence-browser.mjs
node scripts/verify-intelligence-defense.mjs
```

Si la demo corre en otro puerto, definir antes `$env:INTELLIGENCE_TEST_ORIGIN = 'http://127.0.0.1:<puerto>'`.

El primer script usa un perfil aislado dentro de `.cache`, recorre UI/filtros/detalles/ES/EN/roles y guarda `browser-checks.json`. El segundo recorre la experiencia de defensa con ratón y teclado reales (modo defensa, pasos guiados, Health Explorer, anomalía destacada, Why Flagged, Model Comparison Lab, impacto de filtros, tendencias, foco y movimiento reducido) a 1920×1080, 1600×900, 1366×768, 1280×720, 1024×768, 768×1024, 1366×633 y 1280×585. Compara cada cifra en pantalla con la calculada en Node desde el mismo result contract y guarda `defense-checks.json` y las capturas `01`–`11`. Ambos escriben en `docs/data-science/evidence/`. La ruta A se valida con tokens reales en `npm.cmd run test:emulator-admin`. No lanzar dos suites de Emulator simultáneamente.

No hay deploy, cambios de billing ni lectura productiva en este guion. El plan B permanece disponible aunque la infraestructura productiva se detenga.
