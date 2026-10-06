# SGC · Sistema de Gestión Clínica (PMV)

Sistema web para el flujo de atención de un centro de salud de primer nivel:
**Admisión → Triaje → Consulta médica → Receta y alta**. Incluye la pantalla de la sala de espera, un tablero
gerencial para Jefatura y la historia clínica de cada paciente.

Hecho con **React 19 + Vite**, publicado en **Vercel**, con **Supabase** (PostgreSQL, Auth y Realtime) como servidor.

## Qué incluye

| Espacio | Secciones |
|---|---|
| Admisión (`#/admision`) | Registro por DNI o apellido, validación SIS, turno y ticket; flujo en vivo con nombres |
| Enfermería (`#/triaje`) | Cola de triaje; signos vitales con estado por signo, prioridad en vivo, IMC y tendencia de visitas anteriores |
| Médico (`#/consulta`) | Cola por prioridad; ficha del paciente, diagnóstico CIE-10, receta con control de alergias y destino; historias clínicas |
| Jefatura (`#/jefatura`) | Tablero gerencial, flujo en vivo (solo códigos), usuarios, auditoría y umbrales clínicos con escala visual |
| Sala (`#/sala`, pública) | Llamado actual con tono y voz, próximos turnos; nunca muestra nombres ni DNI |

Comunes a todos los espacios:

- **La ruta en vivo**, de Admisión a Alta, con los turnos que avanzan entre etapas.
- **Paleta de comandos** con <kbd>Ctrl</kbd> + <kbd>K</kbd>, para ir a cualquier sección o llamar al siguiente.
- **Centro de avisos** con lo que hacen las otras estaciones. Los casos críticos además aparecen como aviso emergente.
- **Tema claro u oscuro** y diseño adaptable a celular.
- **Accesibilidad.** Se respeta la preferencia de «reducir movimiento» del sistema y todos los gráficos se pueden
  leer con el teclado.

**Tablero gerencial.** Funciona con hechos anónimos, sin nombres, DNI ni historia. Incluye:

- **Cifras principales:** atendidos, tiempo total, esperas dentro del objetivo y abandono. Cada una se compara con
  el periodo anterior.
- **Gráficos:**
  - turnos por prioridad;
  - espera por día;
  - tiempo por etapa de la ruta;
  - demanda por día y hora (mapa de calor);
  - cumplimiento por prioridad;
  - morbilidad CIE-10;
  - destino de los pacientes;
  - perfil por etapas de vida (MINSA);
  - productividad por consultorio.
- **Resumen en tabla** con exportación a CSV.

## Arquitectura

```
Navegador (React 19 + Vite, desplegado en Vercel con cabeceras de seguridad)
   │  HTTPS · JWT de Supabase Auth
   ▼
Supabase
   ├─ Auth ............ cuentas, bcrypt, sesiones JWT
   ├─ API (PostgREST) . solo funciones: sgc_cargar · sgc_guardar · sgc_historia · sgc_indicadores
   │                    sgc_clave_cambiada · sgc_restablecer_demo(+_lote) · sgc_sala
   ├─ Realtime ........ cambios de turno/paciente/usuario/umbral/auditoría, filtrados por RLS
   └─ PostgreSQL ...... 13 tablas del modelo del informe + RLS por rol + reglas en funciones
```

- **Carga liviana.**
  - Cada estación carga solo los turnos de hoy y los que siguen abiertos.
  - La historia de un paciente se pide al abrirla, con `sgc_historia`, que solo pueden usar Enfermería y Medicina.
  - Los indicadores se piden por periodo, con `sgc_indicadores`, que solo puede usar Jefatura.
- **Una sola fuente de cálculo.**
  - Toda la agregación del tablero vive en `src/lib/analytics.js`.
  - Una prueba comprueba que Supabase y el modo local dan exactamente las mismas cifras.
- **Código por demanda.** Cada sección se descarga cuando se abre, y un rol nunca descarga el código de los demás.
  Los datos de demostración también se descargan solo al restablecerlos.
- **Capas del código.**
  - `lib/`: reglas puras.
  - `store/actions.js`: casos de uso.
  - `data/`: repositorios intercambiables.
  - `views/`: secciones.
  - La base vuelve a validar todo en `sgc_guardar()`.

Seguridad, despliegue y verificación: [`DESPLIEGUE.md`](DESPLIEGUE.md).

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 33 pruebas: lógica clínica, flujo, indicadores, avisos y seguridad
npm run lint       # oxlint, sin advertencias
npm run build      # versión de producción en /dist
```

Sin las variables de `.env`, la app arranca en **modo local de desarrollo**: guarda los datos en el navegador
y todas las cuentas usan la contraseña `SgcDemo2026`. El sistema publicado usa siempre Supabase.

## Estructura

```
src/
  lib/                lógica pura, sin React (probada)
    clinical.js         prioridad de triaje, IMC, máquina de estados, alergias, colas, validaciones
    analytics.js        indicadores del tablero (hechos anónimos → cifras, series, mapa de calor, CSV)
    activity.js         avisos para cada rol a partir de los cambios de datos
    constants.js        roles y secciones, ruta y etapas, estados, CIE-10, medicamentos, umbrales
    ids.js · format.js  correlativos por día (TR-), por año (REC-) y HC; formatos es-PE
    seed.js · seedHistory.js  demostración: 5 semanas de atenciones generadas con semilla fija
    motion.js           animaciones compartidas
  store/              StoreProvider (sesión, carga, inactividad, avisos) · actions.js (reglas de negocio)
  data/               supabaseRepo (Auth + funciones sgc_*) · localRepo (desarrollo) · merge.js
  hooks/              consulta asíncrona, historia del paciente, tema, atajos, avisos, confirmación, documentos
  components/         marco (Shell), ruta en vivo, paleta de comandos, avisos, documentos, ui
    charts/           gráficos SVG propios: columnas, líneas, mapa de calor, barras, medidor, tendencia
  views/              Login, Admision, Triaje, Consulta, Historias, Flujo, Sala, jefatura/*
  styles/             tokens (claro y oscuro), base, componentes y marco
  assets/icons3d/     íconos 3D Fluent Emoji (Microsoft, licencia MIT)
supabase/schema.sql   13 tablas, cuentas, RLS por rol, funciones sgc_* y tiempo real
vercel.json           cabeceras de seguridad (CSP, HSTS, X-Frame-Options…)
```

## Créditos

- **Íconos 3D:** [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) de Microsoft, con licencia MIT
  (`src/assets/icons3d/LICENSE-fluentui-emoji.txt`).
- **Íconos de interfaz:** [Lucide](https://lucide.dev), con licencia ISC.
- **Animaciones:** [Motion](https://motion.dev), con licencia MIT.
- **Tipografías:** Onest y Bricolage Grotesque, con licencia OFL. Se sirven desde el propio sitio, sin peticiones a
  terceros.
