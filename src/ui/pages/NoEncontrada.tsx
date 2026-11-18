import { Link } from 'react-router-dom';
import { Page } from '../components/Page';

/** Dirección que no es de ninguna pantalla: un enlace antiguo o mal escrito. */
export function NoEncontrada() {
  return (
    <Page title="Pantalla no encontrada" variant="narrow" lead="Esta dirección no lleva a ninguna pantalla de la app.">
      <Link className="btn btn--primary" to="/">Ir a Inicio</Link>
    </Page>
  );
}
