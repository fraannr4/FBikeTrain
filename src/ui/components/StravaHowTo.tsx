import { Archive } from '../icons';
import { Panel } from './Panel';

/** Los tres pasos para pedir el archivo de Strava. Sin enlaces: Strava cambia sus rutas. */
export function StravaHowTo() {
  return (
    <Panel titleId="howto-title" title="Cómo conseguir tu archivo de Strava" icon={Archive} className="howto-card">
      <ol className="howto">
        <li>
          <span>
            En strava.com, abre <b>Ajustes, Mi cuenta</b> y pulsa <b>Descargar o eliminar tu cuenta</b>.
          </span>
        </li>
        <li>
          <span>Pide el archivo. Strava te lo envía por correo; puede tardar unas horas.</span>
        </li>
        <li>
          <span>
            Suelta el <b>.zip</b> en Importar. Se lee en tu navegador: nada sale de tu equipo.
          </span>
        </li>
      </ol>
    </Panel>
  );
}
