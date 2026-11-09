# Login Cartografía, ciclista de carga y rutas con referencias externas

Fecha: 2026-11-09. Estado: requisitos documentados; logo B global implementado como sublote de identidad. Los lotes de login B, ciclista y rutas IA siguen pendientes. Complementa el plan de cuentas y sincronización; no sustituye sus pendientes ni autoriza commits/push/despliegues.

## Decisiones que Claude debe conservar

- El usuario elige **B Cartografía**, columna central de `docs/design/2026-11-09-opciones-login.png`. La app mantiene su identidad; esta decisión afecta al acceso. No reinterpretar como aprobación de C ni rediseñar toda la aplicación.
- Login con animación sutil, sin sobrecarga. Ciclista subiendo una cuesta después del login y en pantallas de carga, también rutas IA. No prolongar esperas artificialmente.
- Servicio de IA compartido con **coste cero** y búsquedas limitadas. Investigar cuotas efectivas antes de fijar números o prometer disponibilidad ilimitada.
- Rutas: consultar Wikiloc o fuentes equivalentes y combinarlas con el planificador propio, considerando punto de salida, puntos de paso y empalme de recorridos/tramos.
- Preservar privacidad: modelo sin tracks ni coordenadas de Casa; tracks de cuentas privados; estadísticas públicas no autorizan compartir geometría.

## Base disponible y pendientes anteriores

Acceso obligatorio, perfil editable, PKCE, bases locales por cuenta y Worker adaptado están implementados localmente. Tipos y build pasaron; 66 pruebas e2e pasaron con backend simulado. Vitest completo tuvo cinco fallos bajo carga y sus tres archivos pasaron aislados. SQL/RLS pasó en PostgreSQL embebido, no en el servicio real.

Pendientes reales: aplicar migración Supabase, Google/SMTP/redirects y dos cuentas reales; migración asistida de la base antigua, sincronización y funciones sociales. Ver `docs/ESTADO.md`, `docs/verificaciones.md` y el plan de cuentas. No presentar el login real, la sincronización o estas nuevas capacidades como terminadas.

## Lote 1: acceso B

- [x] Identidad global: el usuario elige también **logo B Trazado**, coherente con toda la web. `BrandMark.tsx` compartido en cabeceras, Inicio, carril, acceso; favicon SVG y vista de variantes con tokens actuales. Tipos/build y 37 pruebas aprobadas. Ver `docs/design/2026-11-09-logo-propuestas.md`.

- [x] Trasladar la columna B a HTML/CSS/SVG nativos y tokens acotados al acceso. La imagen es una maqueta, no un recurso que reemplace botones o campos. Hecho (`src/auth/AuthScreen.tsx`, `account.css`).
- [x] Adaptar móvil primero y composición dividida en escritorio; mantener campos, recuperación, errores, Google, privacidad y teclado accesibles. Hecho.
- [x] Crear equivalente oscuro coherente con B; conservar controles de tema existentes. Hecho.
- [x] Animar una sola vez el trazo ascendente y, si aporta, un marcador. Sin bucles de fondo constantes, parallax pesado ni animación del formulario. Hecho; además, la escena «Cumbre» tras el login (`6fdc2e8`).
- [ ] Validar capturas reales a 360/390/412/430 px, apaisado, ambos temas, zoom y movimiento reducido. Repetir pruebas de acceso para no perder funcionalidad.

## Lote 2: ciclista de carga

- [x] Componente SVG reutilizable: bicicleta, ruedas y pedaleo articulado creíble; movimiento suave del cuerpo y terreno, con jerarquía clara y sin dependencias de animación pesadas por defecto. Hecho (`src/ui/components/CyclingLoader.tsx`).
- [x] Integrarlo después del login durante la preparación real de la cuenta, en importación y generación de rutas. Versión compacta para esperas pequeñas. No forzar una duración mínima para que se vea el espectáculo. Hecho: cuenta, importación, Rutas y Rutas con IA.
- [ ] Separar animación de progreso: cifras reales cuando haya total, etapas cuando no; cancelación, errores, avisos y lectores de pantalla operan independientemente del decorado.
- [x] Con movimiento reducido: imagen estática y estado textual. Detener bucles al ocultar pestaña o desmontar; evitar renderizados React por fotograma. Hecho.
- [ ] Verificar móvil modesto, teclado y capturas de los estados relevantes. Definir con el usuario el estilo exacto del ciclista si la primera propuesta no se deduce de B.

## Lote 3: IA compartida y cuotas

- [ ] Validar plan gratuito y acceso real del proveedor. Supabase aloja la coordinación HTTP, no un modelo grande permanente. Reutilizar validación y lógica de objetivos existentes.
- [x] Función autenticada, claves comunes solo en secretos del servidor, entradas y modelo controlados, tamaño/tokens/reintentos acotados, cuota atómica por usuario y global. No aceptar prompts, URLs o modelos arbitrarios del navegador como proxy abierto. Hecho (`ai-routes`, `ors-proxy`, cuotas 0002 y 202611100001).
- [ ] Para nuevas claves comunes de la app, la propuesta cambia la arquitectura previa de claves personales locales. No subir las claves personales existentes ni la dirección Casa automáticamente. Documentar qué proveedor recibe cada dato.
- [x] Evaluar centralizar también el acceso al motor de carreteras para eliminar su configuración al usuario; verificar cuotas y compatibilidad del host ORS/HeiGIT vigente. Esta parte aún no está decidida ni desplegada. Hecho: `ors-proxy` (`386a5fd`), pendiente de desplegar.
- [x] Interfaz sin pasos de claves para el modo compartido, con etapas claras y explicación de límite alcanzado. Conservar una salida útil cuando la cuota o una fuente no esté disponible; no activar un plan de pago automáticamente. Hecho con las variables `VITE_SHARED_*`; apagado hasta desplegar.
- [x] Probar sesión inválida, abuso/concurrencia de cuota, respuesta inválida, caída del proveedor y cancelación; garantizar que no hay tracks/coordenadas en solicitudes al modelo ni secretos en el bundle. Hecho con pruebas unitarias, SQL y la comprobación de secretos del bundle.

## Lote 4: biblioteca, fuentes y composición de rutas

- [x] Diseñar adaptadores separados para búsqueda de referencias, metadatos y geometrías. Registrar URL, proveedor, autor cuando esté disponible, fecha de consulta y condiciones de uso/atribución. Hecho (`route-sources`, `src/routes/sources`, `f794820`).
- [ ] Wikiloc no ofrece API pública según su ayuda oficial: verificar si existe acceso autorizado que sirva al caso. Hasta entonces no basar la función en scraping ni prometer descarga automática. Prever GPX/TCX aportado por el usuario y otras fuentes cuyo acceso esté comprobado.
- [ ] Crear biblioteca de recorridos de referencia separada de actividades realizadas: no contaminar distancia, objetivos, comparativas ni calendario al añadir un track candidato.
- [x] Permitir seleccionar tramos y puntos de paso; elegir orientación y entrada/salida sobre la red, calcular conectores para bici de carretera y regreso si se pide circular. No concatenar coordenadas con saltos ni invertir sentidos de vía inválidos. Hecho para rutas completas en `/rutas/empalmar`; la selección de tramos parciales queda fuera.
- [x] Recalcular distancia, desnivel, duración estimada, dificultad y proporción nueva después de empalmar; descontar solapes y detectar duplicados/retrocesos no deseados. Validar firme y tipo de vía sin asegurar condiciones de tráfico o apertura no verificadas. Hecho (`src/routes/splice.ts`).
- [ ] El modelo propone objetivos, selecciona referencias por identificadores y explica hechos verificables. El motor GIS resuelve coordenadas y conexiones; no usar recuerdos del modelo ni texto web como prueba de que una carretera conecta o es transitable.
- [ ] Mostrar origen de los tramos, conectores añadidos y limitaciones. Si solo existe un enlace sin track, tratarlo como referencia; ofrecer incorporar un fichero o seguir con generación propia.
- [x] GPX final continuo y válido para el dispositivo; pruebas sintéticas de rutas desconectadas, sentidos opuestos, conectores imposibles, solapes, ausencia de altitud, cuota agotada y cancelación. Verificar con ejemplos reales sin subir tracks privados al repositorio. Hecho con pruebas sintéticas; falta la prueba real en el BSC200S.

## Revisión y documentación

Después de cada lote, actualizar plan, `docs/ESTADO.md` y `docs/verificaciones.md` con cambios, comandos y límites reales. Revisar cumplimiento y calidad, corregir y validar móvil antes de cerrar. Commits solo con confirmación expresa. No marcar como disponible una fuente externa por haber escrito un adaptador simulado.

Fuentes y razonamiento técnico: `docs/design/2026-11-09-acceso-ciclista-ia.md`.
