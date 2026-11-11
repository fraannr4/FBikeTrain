import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../src/db/db';
import { parseReferenceRoute } from '../src/routes/library';
import { BibliotecaRutas } from '../src/ui/pages/BibliotecaRutas';

vi.mock('../src/ui/components/RideMap', () => ({ RideMap: () => <div>Mapa sintético</div> }));
vi.mock('../src/ui/components/StartPointCanvas', () => ({ StartPointCanvas: () => <div>Punto sintético</div> }));

it('muestra el origen y el autor del GPX con un enlace seguro', async () => {
  await db.referenceRoutes.clear();
  const parsed = parseReferenceRoute('<gpx><metadata><link href="https://es.wikiloc.com/rutas-ciclismo/sintetica-1234"/><author><name>Autora sintética</name></author></metadata><trk><name>Vuelta sintética</name><trkseg><trkpt lat="41" lon="2.5"><ele>10</ele></trkpt><trkpt lat="41.001" lon="2.501"><ele>20</ele></trkpt></trkseg></trk></gpx>', 'sintetica.gpx');
  await db.referenceRoutes.put({ ...parsed, id: 'synthetic-reference', createdAt: 0, updatedAt: 0 });
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><BibliotecaRutas /></MemoryRouter>);
  await userEvent.setup().click(await screen.findByRole('button', { name: /Vuelta sintética/ }));
  const link = screen.getByRole('link', { name: 'Origen: Wikiloc · Autora sintética' });
  expect(link).toHaveAttribute('href', parsed.sourceUrl);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});
