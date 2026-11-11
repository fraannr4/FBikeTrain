import { APP_BASES, APP_BASE_PLACEHOLDER } from './protocol';

/**
 * Página estática `public/wikiloc-marcador.html`, generada por `npm run build:bookmarklet`:
 * el marcador para arrastrar a favoritos, el código para copiar en Chrome para Android y
 * qué lee y qué no. Sin dependencias, para cargarla desde el script de build.
 */

const APP_BASE = /^https?:\/\/[a-z0-9.-]+(:\d+)?\/([\w-]+\/)*$/i;

/** Enlace `javascript:` del marcador con la dirección de la app puesta en el código. */
export function bookmarkletHref(code: string, appBase: string): string {
  if (!APP_BASE.test(appBase)) throw new Error(`La dirección de la app no es válida: ${appBase}`);
  const parts = code.split(APP_BASE_PLACEHOLDER);
  if (parts.length !== 2) throw new Error('El código del marcador debe llevar una sola vez la dirección de la app.');
  return `javascript:${encodeURIComponent(parts.join(appBase))}`;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Mismos valores que src/ui/styles/tokens.css: esta página no carga el CSS de la app.
const STYLE = `
:root,:root[data-theme="dark"]{color-scheme:dark;--bg:#14221F;--surface:#1D3029;--surface-2:#233B30;--line:#415548;--ink:#E5EDDF;--ink-2:#C3D0C0;--action:#80B4F5;--on-action:#14221F;--focus:#80B4F5;--link:#80B4F5;--good:#9BD3AB}
:root[data-theme="light"]{color-scheme:light;--bg:#F7F4EA;--surface:#FFFDF5;--surface-2:#EDEFE3;--line:#CBD1BD;--ink:#163B30;--ink-2:#3D5543;--action:#2465D5;--on-action:#FFFFFF;--focus:#1D56B5;--link:#1D56B5;--good:#28633D}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.5 'Barlow',system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:40rem;margin:0 auto;padding:24px 16px 48px;display:grid;gap:24px}
h1{margin:0;font-size:1.6rem;line-height:1.2}
h2{margin:0 0 8px;font-size:1.15rem}
p,ol,ul{margin:0}
h1+p,ol+p{margin-top:8px}
ol,ul{padding-left:1.25rem;display:grid;gap:6px}
section{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px}
.lead{color:var(--ink-2)}
a{color:var(--link);text-underline-offset:3px}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.marcador{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:12px;background:var(--action);color:var(--on-action);font-weight:600;text-decoration:none;cursor:grab}
label{display:block;font-weight:600;margin:8px 0 4px}
textarea{width:100%;min-height:6rem;padding:8px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:var(--ink);font:13px/1.4 ui-monospace,monospace;word-break:break-all;resize:vertical}
button{min-height:44px;margin-top:8px;padding:0 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:var(--ink);font:inherit;font-weight:600;cursor:pointer}
.aviso{min-height:1.5em;margin-top:8px;color:var(--good)}
`;

// Tema como en index.html: el guardado por la app (mismo origen) o, sin él, oscuro.
const THEME_SCRIPT = `(function(){var t='dark';try{var s=localStorage.getItem('fbt-theme');if(s==='light'||s==='dark')t=s;}catch(e){}document.documentElement.setAttribute('data-theme',t);})();`;

// En local, el marcador abre la app de desarrollo. Pulsarlo aquí no hace nada: se arrastra o se copia.
const PAGE_SCRIPT = `(function(){
var link=document.getElementById('marcador'),code=document.getElementById('codigo'),copy=document.getElementById('copiar');
var dragHint=document.getElementById('aviso-arrastre'),copyHint=document.getElementById('aviso-copia');
if(/^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)){var dev=link.getAttribute('data-dev-href');link.setAttribute('href',dev);code.value=dev;}
link.addEventListener('click',function(e){e.preventDefault();dragHint.textContent='Arrastra el enlace a la barra de favoritos. Aquí no hace nada: se usa en Wikiloc.';});
copy.addEventListener('click',function(){
code.focus();code.select();
var done=function(){copyHint.textContent='Código copiado.';};
var fail=function(){copyHint.textContent='No se ha podido copiar: mantén pulsado el código seleccionado y elige Copiar.';};
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(code.value).then(done,fail);}
else{try{document.execCommand('copy')?done():fail();}catch(e){fail();}}
});
})();`;

export function renderInstallPage(code: string): string {
  const prod = escapeHtml(bookmarkletHref(code, APP_BASES.prod));
  const dev = escapeHtml(bookmarkletHref(code, APP_BASES.dev));
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Marcador de Wikiloc para FBikeTrain</title>
<link rel="icon" type="image/svg+xml" href="brand-mark.svg">
<script>${THEME_SCRIPT}</script>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<h1>Marcador «→ FBikeTrain» para Wikiloc</h1>
<p class="lead">Con un toque en Wikiloc, el marcador pasa a FBikeTrain las rutas que estás viendo o el GPX de la ruta que tienes abierta.</p>
</header>
<section aria-labelledby="t-lee">
<h2 id="t-lee">Qué lee y qué no</h2>
<ul>
<li>En una lista o en el mapa lee el nombre, los km, el desnivel, la dificultad, el autor y el enlace de las rutas visibles, como mucho 50.</li>
<li>Si el mapa no muestra tarjetas, hace una sola consulta al propio mapa de Wikiloc para esa vista.</li>
<li>En la ficha de una ruta hace la misma descarga de GPX que el botón «Descargar», con tu cuenta y solo de esa ruta.</li>
<li>Solo actúa cuando lo pulsas: no repite peticiones, no recorre otras zonas y no salta Premium ni confirmaciones. Si Wikiloc los pide, te avisa y usas su botón.</li>
<li>No lee tus contraseñas ni tus cookies y no pasa por ningún servidor: entrega los datos a FBikeTrain dentro de tu navegador.</li>
</ul>
</section>
<section aria-labelledby="t-pc">
<h2 id="t-pc">Instalar en el ordenador</h2>
<ol>
<li>Muestra la barra de favoritos del navegador (Ctrl+Mayús+B en Chrome).</li>
<li>Arrastra este enlace a la barra: <a id="marcador" class="marcador" href="${prod}" data-dev-href="${dev}">→ FBikeTrain</a></li>
</ol>
<p id="aviso-arrastre" class="aviso" role="status"></p>
</section>
<section aria-labelledby="t-android">
<h2 id="t-android">Instalar en Chrome para Android</h2>
<ol>
<li>Copia el código del marcador.</li>
<li>Abre cualquier página, toca el menú y la estrella para crear un favorito.</li>
<li>Edita ese favorito: en el nombre escribe «FBikeTrain» y en la dirección pega el código.</li>
<li>En Wikiloc, escribe «FBikeTrain» en la barra de direcciones y toca el favorito que aparece con la estrella, no la búsqueda.</li>
</ol>
<label for="codigo">Código del marcador</label>
<textarea id="codigo" readonly rows="4" spellcheck="false">${prod}</textarea>
<button id="copiar" type="button">Copiar el código</button>
<p id="aviso-copia" class="aviso" role="status"></p>
</section>
<section aria-labelledby="t-uso">
<h2 id="t-uso">Cómo se usa</h2>
<ol>
<li>En FBikeTrain, abre «Rutas de Wikiloc cerca» y pulsa «Buscar en Wikiloc».</li>
<li>En Wikiloc, pulsa el marcador: FBikeTrain se abre con las rutas de esa vista.</li>
<li>Para adaptar una ruta, abre su ficha en Wikiloc y vuelve a pulsar el marcador.</li>
</ol>
<p>Si el navegador bloquea la ventana de FBikeTrain, permite las ventanas emergentes en wikiloc.com.</p>
</section>
<p><a href="./#/rutas">Volver a FBikeTrain</a></p>
</main>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
}
