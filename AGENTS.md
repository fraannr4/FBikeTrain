# FBikeTrain: guía para agentes (Codex y otros)

Plataforma de ciclismo personal. Es una web estática en Vite + React 18 + TypeScript strict, publicada en GitHub Pages:
- repositorio: https://github.com/fraannr4/FBikeTrain (rama `main`);
- app: https://fraannr4.github.io/FBikeTrain/

Cada push a `main` ejecuta vitest, genera el build y despliega (`.github/workflows/deploy.yml`).

## Lee primero

1. `docs/ESTADO.md`, sección «0. Cierre del 2026-11-09». Es la fuente de verdad del estado y de lo pendiente.
2. `docs/superpowers/plans/2026-11-09-cuentas-perfiles-social.md`: plan de cuentas, sincronización y perfiles.
3. `CLAUDE.md`: reglas del proyecto y flujo de trabajo completo.
4. `docs/superpowers/plans/2026-11-09-login-cartografia-carga-rutas-ia.md` y `docs/design/2026-11-09-acceso-ciclista-ia.md`: últimas decisiones del usuario. Login **B Cartografía**, animación sutil, ciclista tras login y durante cargas, IA común con coste cero, referencias de Wikiloc/equivalentes y empalme de tramos. La columna central de `docs/design/2026-11-09-opciones-login.png` es la referencia aprobada del nuevo acceso. Pendiente de implementar; no confundir con el login local anterior ya desarrollado.

## Reglas que no pueden fallar

- **Logo:** el usuario ha elegido B Trazado para toda la web. Ya integrado en SVG mediante `BrandMark.tsx` y favicon, con colores de los temas actuales. Referencia: `docs/design/2026-11-09-logo-propuestas.md`. El alcance del login B no implica cambiar la identidad cromática de todas las pantallas.

- **Commits:** nunca sin la confirmación explícita del usuario. No hagas commit, push ni deploy por tu cuenta.
- **Repositorio público:** no subas claves, archivos de Strava ni tracks reales. Los fixtures son sintéticos. El ZIP real (`C:\Users\Fran.Romano\Downloads\export_180782712.zip`) nunca entra en el repositorio.
- **Supabase:** la clave publicable (anon) puede ir en el código. La clave de servicio nunca: no la pidas, no la guardes y no la registres.
- **IA:** solo interviene en las rutas. Recibe cifras resumidas, nunca tracks GPS ni la dirección de «Casa». Las claves personales de ORS y Groq se quedan en local. Nueva dirección solicitada: servicio común sin configuración de claves para el usuario y con coste cero/cuotas; sus futuras claves comunes irán en secretos del servidor, nunca en el cliente. No migrar claves personales automáticamente.
- **Strava:** no se usan ni su API ni su MCP.
- **Mobile-first:** cada pantalla se valida primero en el móvil, a 360-430 px (`docs/requisito-mobile-first.md`).
- **Presupuesto:** el usuario pide no pasar del 60 % de su límite semanal. Trabajo ligero, verificación con comandos.

## Pendiente a 2026-11-09

### 1. Cambios sin commit (esperan el OK del usuario)

- `src/import/summary.ts`: arreglo de los saltos del GPS. Un tramo calculado con haversine que supera `GPS_SPIKE_SPEED_MS` cuenta a la mediana de su ventana de 5 tramos, no con la distancia del salto. La distancia del dispositivo (FIT) no se toca.
- `tests/summary.test.ts`: prueba nueva, «a GPS jump out and back does not add its metres to the distance».
- `docs/ESTADO.md`: sección 0 y decisiones del login.
- `docs/superpowers/plans/2026-11-09-cuentas-perfiles-social.md` (sin seguimiento) y este `AGENTS.md`.

Verificado el 2026-11-09 a las 12:01, con estos cambios: `npx vitest run` da 933 de 933 en verde (76 ficheros) y `npx tsc --noEmit` sale limpio. El mensaje de commit propuesto está en `docs/ESTADO.md`, sección 0.

Si git rechaza `git status` por «dubious ownership», díselo al usuario. No cambies la configuración global por tu cuenta.

### 2. Cuentas y sincronización con Supabase (viernes 2026-11-13)

Ya decidido:
- La cuenta es obligatoria.
- Se sincroniza todo: perfil, salidas, tracks, calendario y objetivos.
- Los tracks son privados, con RLS y sin cifrado en el cliente.
- Las estadísticas son visibles para todos por defecto, o solo para amigos si el usuario lo elige.
- La primera comparativa: distancia, desnivel, tiempo en movimiento y número de salidas, por semana, mes y año.

Antes de empezar:
- Supabase, Google Cloud y Brevo ya están creados; URL y clave publishable facilitadas, Gmail verificado como remitente. Acceso por correo/contraseña y Google decidido. El acceso y perfil ya están implementados localmente; falta configuración real y aplicación de migración. Estado actualizado y pruebas en `docs/ESTADO.md` y `docs/verificaciones.md`.
- Quedan decisiones de incorporación de datos existentes, conflictos/borrados y sincronización. Las mejoras visuales y de rutas no cierran esos pendientes.

Fases: siguen el plan citado arriba.

### 3. Comprobaciones que solo puede hacer el usuario

- Meter las claves de ORS y Groq en Ajustes y probar una ruta real y una ruta con IA.
- Comparar un mes real con Strava (distancia, desnivel, tiempo) y anotarlo en `docs/verificaciones.md`.
- Confirmar si la salida que la app descartó por corta del ZIP real es basura de verdad.
- Las comprobaciones reales de F2 a F5 que enumera `docs/ESTADO.md` («Revisión de planes»).

### 4. Mejoras opcionales (no bloquean)

La lista está en `docs/ESTADO.md`, sección 3: dividir el bundle, leer el ZIP en streaming, añadir nombres en castellano a `CYCLING_TYPES`, entre otras.

## Comandos

- Pruebas: `npx vitest run` (unos 3-4 minutos)
- Tipos: `npx tsc --noEmit`
- Build: `npm run build`
- Extremo a extremo: `npx playwright test` (puerto 4173, que debe estar libre)
- Local: `npm run dev`, en http://localhost:5173
