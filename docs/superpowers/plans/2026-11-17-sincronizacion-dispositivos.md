# Sincronización entre dispositivos

Fecha: 2026-11-17. Estado: implementado, pendiente de probar con dos dispositivos reales.

## Decisiones del usuario (cerradas)

- Sin contraseña extra: basta iniciar sesión. Los datos van cifrados y la clave se guarda en la cuenta. No es cifrado de extremo a extremo: quien administre la base entera podría leerlos.
- Se sincroniza todo: salidas con su track, rutas propias, plan, objetivos y ajustes (nombre, Casa, FTP y pulso).
- Activada para todas las cuentas registradas. Las cuentas anónimas no sincronizan.
- Automática: al abrir, al volver a la app, al recuperar la red y poco después de cada cambio.
- Con datos móviles los tracks esperan a que haya wifi, en los dos sentidos.
- Gana el cambio más reciente. Los borrados se propagan.

## Qué no se sincroniza

- Los datos de demostración (prefijo `demo-`).
- Las rutas del catálogo precargado: se vuelven a descargar.
- Las claves propias de ORS y de IA: se quedan en cada dispositivo.
- Lo que se recalcula a partir de las salidas (subidas y firmas de recorrido).
- El tema claro u oscuro y el resto de preferencias del navegador.

## Servidor

Migración `202611170006_device_sync.sql`.

- `sync_keys`: una clave AES de 256 bits por cuenta.
- `sync_items`: una fila por dato. Guarda el tipo, el identificador, la fecha del cambio (`changed_ms`), un número de secuencia y el contenido cifrado. Un contenido nulo es un borrado.
- `sync_usage`: bytes y número de datos por cuenta. Límite: 150 MB y 60 000 datos.
- Las tablas no tienen permisos directos. Todo pasa por cuatro funciones que actúan solo sobre `auth.uid()`:
  - `sync_key(candidate)`: devuelve la clave de la cuenta; si no hay, guarda la candidata.
  - `sync_push(items)`: sube hasta 200 cambios. Una fila solo se sustituye si el cambio es posterior al guardado. La fecha nunca supera el reloj del servidor.
  - `sync_list(after, max_rows)`: lista los cambios posteriores a un cursor, sin contenido.
  - `sync_fetch(keys)`: descarga el contenido de hasta 50 datos.
- Pruebas: `supabase/tests/device_sync.sql`, dentro de `node scripts/test-account-sql.mjs`.

## Cliente

- `src/sync/crypto.ts`: gzip y AES-GCM. El tipo y el identificador van como datos asociados.
- `src/sync/local.ts`: qué entra en la copia y cómo se lee, se valida y se escribe cada tipo.
- `src/sync/engine.ts`: una pasada hace cuatro pasos.
  1. Anotar: compara lo local con la tabla `syncState` y marca altas, cambios y borrados. Funciona sin red.
  2. Listar: pide lo cambiado desde el cursor y marca lo que falta descargar.
  3. Descargar: aplica lo marcado, salvo que el cambio local sea posterior.
  4. Subir: envía lo marcado por lotes.
- `src/sync/remote.ts`: las cuatro funciones sobre Supabase.
- `src/sync/DeviceSync.tsx`: proceso de fondo montado en `AppShell`.
- `src/sync/status.ts`: estado para Ajustes y revisión para que las pantallas vuelvan a leer.
- `src/ui/ajustes/SyncSection.tsx`: sección «Sincronización» en Ajustes.
- Base local: versión 6, tabla `syncState`.

## Comportamientos que conviene conocer

- La primera vez que un dato se anota lleva su propia fecha, no la de ese momento. Así un dispositivo con datos antiguos no pisa lo más reciente de otro al estrenar la sincronización.
- Si el navegador borra la base local, el dispositivo se comporta como uno nuevo: descarga la copia y no borra nada.
- «Borrar todos los datos» conserva `syncState` a propósito: el borrado se anota y llega a la cuenta y a los demás dispositivos. La hoja de confirmación lo avisa.
- Un contenido dañado o cifrado con otra clave se salta y no detiene al resto.
- Una pasada interrumpida sigue donde lo dejó.
- Un dato de más de unos 3 MB cifrado no se sube.

## Pruebas

- `tests/deviceSync.test.ts`: dos dispositivos simulados contra una cuenta en memoria.
- `supabase/tests/device_sync.sql`: permisos, orden, borrados y cuota.

## Pendiente

- Probar con dos dispositivos reales (móvil y PC) con la misma cuenta.
- Si el uso crece, mover los tracks a Supabase Storage: la base gratuita tiene 500 MB para todas las cuentas.
