import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { searchPlaces, type Place } from '../../social/geocode';
import { saveArea, skipZona } from '../../social/profileArea';
import { LoaderCircle, MapPin } from '../icons';
import { Banner } from '../components/Banner';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { useToast } from '../components/Toast';
import '../styles/social.css';

/** Espera tras la última tecla: Nominatim no admite autocompletar letra a letra. */
const TYPING_PAUSE_MS = 400;
const HELP = 'Solo guardamos el nombre del pueblo y una zona aproximada. Tu dirección exacta no sale del móvil.';

type Search = 'idle' | 'busy' | 'empty' | 'error';

/**
 * «Tu zona»: el pueblo desde el que sale a rodar. Se pide una vez tras el login y se cambia desde
 * Ajustes. Al servidor va el nombre y una celda redondeada; Casa, si faltaba, queda en el móvil.
 */
export function Zona() {
  const account = useAccount();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const done = params.get('desde') === 'ajustes' ? '/ajustes?abrir=zona' : '/';
  const [q, setQ] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [chosen, setChosen] = useState<Place | null>(null);
  const [search, setSearch] = useState<Search>('idle');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const listId = useId();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setPlaces([]);
      setChosen(null);
      setSearch('idle');
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setSearch('busy');
      searchPlaces(term, fetch, ctrl.signal).then(
        (found) => {
          setPlaces(found);
          setChosen(null);
          setSearch(found.length ? 'idle' : 'empty');
        },
        () => {
          if (!ctrl.signal.aborted) setSearch('error');
        },
      );
    }, TYPING_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!account || !chosen || busy) return;
    setBusy(true);
    setSaveError('');
    try {
      await saveArea(account, chosen);
      toast('Zona guardada', { tone: 'good' });
      navigate(done, { replace: true });
    } catch {
      setSaveError('No se ha podido guardar tu zona. Comprueba la conexión e inténtalo de nuevo.');
      setBusy(false);
    }
  }

  function skip() {
    skipZona(Date.now());
    navigate(done, { replace: true });
  }

  return (
    <Page
      title="Tu zona"
      back={done === '/' ? undefined : '/ajustes'}
      variant="narrow"
      className="page--zona"
      lead="Con tu pueblo, Rutas sabe desde dónde sales y otros ciclistas de la zona pueden encontrarte."
    >
      {!account ? (
        <p>Inicia sesión para indicar tu zona.</p>
      ) : (
        <form className="card zona-card" onSubmit={save} aria-label="Elegir tu zona">
          <Field
            label="¿Desde qué pueblo sales a rodar?"
            type="search"
            value={q}
            maxLength={80}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="search"
            placeholder="Escribe al menos 3 letras"
            help={HELP}
            onChange={(e) => setQ(e.target.value)}
          />
          <p className="zona-status" role="status">
            {search === 'busy' ? (
              <>
                <LoaderCircle className="ic spin" aria-hidden="true" />
                Buscando pueblos…
              </>
            ) : search === 'empty' ? (
              'No hay pueblos con ese nombre. Prueba a añadir la provincia.'
            ) : null}
          </p>
          {search === 'error' ? (
            <Banner tone="error">
              <b>No se ha podido buscar el pueblo.</b> Puedes indicarlo más tarde desde Ajustes.
            </Banner>
          ) : null}
          {places.length ? (
            <fieldset className="zona-places" aria-describedby={listId}>
              <legend className="sr-only">Pueblos encontrados</legend>
              <p className="help" id={listId}>
                Elige el tuyo:
              </p>
              {places.map((p) => (
                <label className="zona-place" key={`${p.name}|${p.lat}|${p.lng}`}>
                  <input type="radio" name="zona-place" checked={chosen === p} onChange={() => setChosen(p)} />
                  <MapPin className="ic" aria-hidden="true" />
                  <span>{p.name}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {saveError ? <Banner tone="error">{saveError}</Banner> : null}
          <div className="zona-actions">
            <button type="submit" className="btn btn--primary btn--block" disabled={!chosen || busy}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={skip} disabled={busy}>
              Ahora no
            </button>
          </div>
        </form>
      )}
    </Page>
  );
}
