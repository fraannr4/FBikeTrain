const CONTACT = 'fbiketrain@gmail.com';

/** Página pública sin dependencias de la sesión ni del almacén de salidas. Garmin exige una política accesible sin cuenta. */
export function Privacidad() {
  return <main className="privacy-page" id="contenido">
    <header><p className="page-kicker">FBikeTrain</p><h1 className="page-title">Privacidad</h1><p>Actualizada el 19 de noviembre de 2026.</p></header>
    <section><h2>Tu cuenta y tus salidas</h2><p>FBikeTrain es una aplicación personal de ciclismo. El correo de acceso y la sesión se gestionan con Supabase. Las salidas, tracks, calendario, objetivos y ajustes se guardan en este navegador, separados por cuenta.</p><p>Lo que compartes en la parte social (perfil, amistades, retos y cuaderno) se guarda en Supabase, con acceso limitado a tu cuenta y a las personas que tú permitas. Puedes borrar los datos de este navegador desde Ajustes; una copia de seguridad descargada queda bajo tu control.</p></section>
    <section><h2>Chat</h2><p>Solo puedes escribir a tus amigos. Los mensajes se guardan en Supabase y solo los leen las personas de cada conversación. No hay cifrado de extremo a extremo: quien administra el proyecto podría leerlos. El texto de un mensaje viaja en el aviso push y aparece en la pantalla de quien lo recibe. Cada uno puede borrar sus mensajes para todos, y al borrar tu cuenta se borran todos tus mensajes. La IA no interviene en el chat.</p></section>
    <section><h2>Garmin Connect</h2>
      <p>Conectar Garmin es opcional y usa la autorización oficial de Garmin: inicias sesión en la web de Garmin y eliges qué permites. FBikeTrain nunca ve ni guarda tu contraseña de Garmin.</p>
      <p>Qué guardamos en el servidor (Supabase): tu identificador de usuario de Garmin, los permisos que concedes y los tokens de acceso, cifrados y ligados a tu cuenta. Nunca llegan al navegador ni a las copias de seguridad.</p>
      <p>Cuando sincronizas una salida nueva, Garmin la avisa a nuestro servidor, que descarga el archivo FIT y lo guarda en un espacio privado de tu cuenta solo para que la app lo importe en tu navegador. A los 30 días deja de estar disponible y se borra en la siguiente limpieza. Si envías un recorrido a Garmin, mandamos su trazado, nombre, distancia y desnivel a Garmin Connect para que aparezca en tu dispositivo.</p>
      <p>Usamos estos datos solo para tu historial, tus estadísticas y tus rutas. No los vendemos ni los cedemos a terceros.</p>
      <p>Cómo borrarlos: en Ajustes, Conexiones, pulsa Desconectar. Retiramos el permiso en Garmin y borramos al momento los tokens, el identificador y los archivos pendientes. También puedes retirar el acceso desde la configuración de tu cuenta Garmin; en ese caso Garmin nos avisa y lo borramos igual. Las salidas ya importadas se borran desde Ajustes, en este navegador.</p>
    </section>
    <section><h2>Otros servicios externos</h2><p>La clave personal de Intervals.icu se guarda cifrada en este navegador y solo se envía a Intervals.icu. OpenRouteService recibe las coordenadas necesarias para calcular rutas; Nominatim, las búsquedas de lugares; Open-Meteo, el punto de salida redondeado a alrededor de 1 km (nunca el exacto) para darte el tiempo y el viento; las teselas del mapa vienen de OpenStreetMap y CyclOSM.</p><p>La IA (Groq) recibe cifras resumidas, como kilómetros, desnivel y carga de la semana, para proponer rutas y entrenos. No recibe tracks GPS, ficheros de salidas ni la dirección de Casa. Los servicios compartidos pasan por Supabase, que controla el acceso y las cuotas.</p></section>
    <section><h2>Contacto</h2><p>Para cualquier duda o para pedir que borremos tus datos, escribe a <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. El código del proyecto es público en el <a href="https://github.com/fraannr4/FBikeTrain">repositorio de FBikeTrain</a>.</p></section>
    <a className="btn btn--secondary" href="#/">Volver a FBikeTrain</a>
  </main>;
}
