import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount } from '../../auth/AccountBoundary';
import { sharedOrsEnabled } from '../../routes/orsProxy';
import type { ProbeResult, Settings } from '../../domain/types';
import { BackupError, exportBackup, getBackupMeta, needsBackup, restoreBackup } from '../../backup/backup';
import { clearAllData } from '../../db/repo';
import { db } from '../../db/db';
import { clearDemoData, hasDemoData } from '../../demo/demoData';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../settings/settings';
import { probeLlm, probeOrs } from '../../settings/probes';
import { daysAgoLabel, formatCount } from '../format';
import { localDay } from '../../metrics/calendar';
import {
  Archive,
  CircleAlert,
  CircleCheck,
  ClipboardPaste,
  Clock,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  Info,
  KeyRound,
  LoaderCircle,
  MapPin,
  Navigation,
  Palette,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  User,
} from '../icons';
import { Banner } from '../components/Banner';
import { Disclosure } from '../components/Disclosure';
import { Field } from '../components/Field';
import { Page } from '../components/Page';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { ThemeToggle } from '../shell/ThemeToggle';
import { InstallApp } from '../components/InstallApp';
import { useTheme } from '../theme/theme';

const DAY = 86_400_000;
const GROQ_URL = DEFAULT_SETTINGS.llm.baseUrl;
const ORS_SIGNUP = 'https://openrouteservice.org/dev/#/signup';
const GROQ_KEYS = 'https://console.groq.com/keys';
const STORAGE_DOWN = 'el almacenamiento de este navegador no está disponible.';
const SECTIONS = ['perfil', 'casa', 'claves', 'apariencia', 'copia', 'borrar'] as const;

function probeMessage(r: ProbeResult): string {
  if (r.ok) return 'Conexión correcta.';
  switch (r.reason) {
    case 'unauthorized':
      return 'La clave no es válida.';
    case 'network':
      // ORS responde a una clave mala sin cabecera CORS: el navegador lo ve como fallo de red.
      return 'No se pudo contactar con el servidor, o ha rechazado la clave. Revisa la clave y tu conexión.';
    case 'cors':
      return 'El servidor no admite llamadas desde el navegador (CORS).';
    case 'other':
      return `El servidor respondió con un error (${r.detail}).`;
  }
}

/** Nombre del proveedor de IA a partir de su dirección: «Groq» o el dominio («ejemplo.com»). */
export function providerName(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(^|\.)groq\.com$/.test(host) ? 'Groq' : host.replace(/^(api|www)\./, '');
  } catch {
    return 'la IA';
  }
}

function validUrl(url: string): boolean {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Abre una sección del acordeón, la trae a la vista y lleva el foco a su cabecera. */
function openSection(id: string) {
  const d = document.getElementById(id);
  if (!(d instanceof HTMLDetailsElement)) return;
  d.open = true;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  d.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  d.querySelector('summary')?.focus({ preventScroll: true });
}

type Extra = { rides: number; demo: boolean; lastBackupAt?: number; staleBackup: boolean };

async function loadExtra(): Promise<Extra> {
  const [rides, demo, backup] = await Promise.all([db.activities.count(), hasDemoData(), getBackupMeta()]);
  return { rides, demo, lastBackupAt: backup.lastBackupAt, staleBackup: needsBackup(backup) };
}

/**
 * Ajustes: un acordeón con perfil, Casa, claves de servicio, apariencia, copia de seguridad y borrar
 * datos. Cada cambio se guarda al salir del campo; las claves solo viven en este navegador.
 */
export function Ajustes() {
  const [initial, setInitial] = useState<Settings | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Cambia tras restaurar una copia o borrar todo, para que el formulario se monte de nuevo.
  const [formKey, setFormKey] = useState(0);
  const [params] = useSearchParams();
  const open = params.get('abrir');

  useEffect(() => {
    let alive = true;
    Promise.all([loadSettings(), loadExtra()]).then(
      ([s, x]) => {
        if (!alive) return;
        setInitial(s);
        setExtra(x);
      },
      () => {
        if (alive) setLoadFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async (settings?: Settings) => {
    const [s, x] = await Promise.all([settings ? Promise.resolve(settings) : loadSettings(), loadExtra()]);
    setInitial(s);
    setExtra(x);
    setFormKey((k) => k + 1);
  }, []);

  let body: ReactNode = <SettingsSkeleton />;
  if (initial && extra)
    body = (
      <SettingsForm
        key={formKey}
        initial={initial}
        extra={extra}
        open={open === 'restaurar' ? 'copia' : open}
        openRestore={open === 'restaurar'}
        onExtra={setExtra}
        onReplaced={refresh}
      />
    );
  else if (loadFailed)
    body = (
      <p role="alert" className="banner banner--error">
        <CircleAlert className="ic" aria-hidden="true" />
        <span>
          No se puede usar el almacenamiento de este navegador. Revisa que no esté bloqueado para esta web o que no
          estés en una ventana privada.
        </span>
      </p>
    );

  return (
    <Page
      title="Ajustes"
      back="/mas"
      variant="narrow"
      className="page--ajustes"
      lead={
        <>
          Todo queda en este navegador y <b>cada cambio se guarda al momento</b>.
        </>
      }
    >
      <InstallApp />
      {body}
    </Page>
  );
}

function SettingsSkeleton() {
  const widths: [string, string][] = [
    ['38%', '24%'],
    ['30%', '56%'],
    ['52%', '64%'],
    ['42%', '20%'],
    ['60%', '44%'],
  ];
  return (
    <section className="section" aria-busy="true">
      <span className="sr-only" role="status">
        Cargando tus ajustes
      </span>
      <div className="settings" aria-hidden="true">
        {widths.map(([a, b]) => (
          <div className="disclosure sk-sum" key={a}>
            <Skeleton variant="circle" />
            <span className="sk-stack">
              <Skeleton width={a} />
              <Skeleton width={b} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

type ProbeState = { busy: boolean; ok?: boolean; error?: string };
type FormProps = {
  initial: Settings;
  extra: Extra;
  /** Sección abierta al llegar (`?abrir=copia`). */
  open: string | null;
  /** Llegar desde «¿Vienes de otro teléfono?»: la hoja de restaurar se abre sola. */
  openRestore: boolean;
  onExtra: (x: Extra) => void;
  /** Tras restaurar una copia o borrar todo: se vuelve a leer todo. */
  onReplaced: (s?: Settings) => Promise<void>;
};

function SettingsForm({ initial, extra, open, openRestore, onExtra, onReplaced }: FormProps) {
  const account = useAccount();
  const toast = useToast();
  const theme = useTheme();
  const [settings, setSettings] = useState(initial);
  const saved = useRef(initial);
  const [saveFailed, setSaveFailed] = useState(false);
  const [ors, setOrs] = useState<ProbeState>({ busy: false });
  const [llm, setLlm] = useState<ProbeState>({ busy: false });
  const [shown, setShown] = useState({ ors: false, llm: false });
  const [providerOpen, setProviderOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const isOpen = (id: (typeof SECTIONS)[number]) => open === id;

  // Al llegar con `?abrir=`, la sección abierta se trae a la vista: «Copia» queda al final de la página.
  useEffect(() => {
    if (open) document.getElementById(open)?.scrollIntoView?.({ block: 'start' });
  }, [open]);

  const persist = useCallback(
    async (next: Settings, message: string): Promise<boolean> => {
      try {
        await saveSettings(next);
        saved.current = next;
        setSaveFailed(false);
        toast(message, { tone: 'good' });
        return true;
      } catch {
        setSaveFailed(true);
        return false;
      }
    },
    [toast],
  );

  /** Al salir de un campo: si cambió algo desde lo último guardado, se guarda. */
  function saveIfChanged(message: string) {
    if (JSON.stringify(settings) !== JSON.stringify(saved.current)) void persist(settings, message);
  }

  async function probe(which: 'ors' | 'llm') {
    const set = which === 'ors' ? setOrs : setLlm;
    const key = which === 'ors' ? settings.ors.apiKey : settings.llm.apiKey;
    const name = which === 'ors' ? 'OpenRouteService' : providerName(settings.llm.baseUrl);
    if (!key.trim()) {
      set({ busy: false, error: 'Pega la clave antes de probarla.' });
      document.getElementById(which === 'ors' ? 'f-ors' : 'f-ia')?.focus();
      return;
    }
    set({ busy: true });
    const result = which === 'ors' ? await probeOrs(key) : await probeLlm(settings.llm);
    if (result.ok) {
      set({ busy: false, ok: true });
      toast(`Conexión probada: ${name} responde`, { tone: 'good' });
      saveIfChanged('Clave guardada');
    } else {
      set({ busy: false, ok: false, error: probeMessage(result) });
      toast(`La conexión con ${name} ha fallado`, { tone: 'error' });
    }
  }

  const missingHome = settings.home === null;
  // Con el servicio común de rutas no hace falta clave: las propias quedan como opción avanzada.
  const sharedRoads = sharedOrsEnabled() && account !== null;
  const ownKey = settings.ors.apiKey.trim() !== '';
  const missingKey = !sharedRoads && !ownKey;
  const provider = providerName(settings.llm.baseUrl);

  let keysMeta: ReactNode = `Rutas: ${!ownKey ? (sharedRoads ? 'servicio común' : 'sin clave') : ors.ok ? 'conectada' : 'con clave'} · IA: ${
    settings.llm.apiKey.trim() ? (llm.ok ? 'conectada' : 'con clave') : 'sin clave'
  }`;
  if (ors.ok === false) keysMeta = <Warn bad>Rutas: la clave no funciona</Warn>;
  else if (missingKey) keysMeta = <Warn>Falta la clave de rutas</Warn>;

  return (
    <>
      {saveFailed ? (
        <Banner tone="error">
          <b>No se han podido guardar los ajustes:</b> {STORAGE_DOWN} Revisa que no esté bloqueado o que no estés en
          una ventana privada.
        </Banner>
      ) : null}

      {extra.demo ? <DemoBanner onRemoved={() => onExtra({ ...extra, demo: false })} /> : null}

      {missingHome || missingKey ? (
        <Banner
          icon={Route}
          action={
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => openSection(missingHome ? 'casa' : 'claves')}
            >
              {missingHome && missingKey ? 'Empezar por Casa' : missingHome ? 'Elegir Casa' : 'Añadir la clave'}
            </button>
          }
        >
          {missingHome && missingKey ? (
            <>
              <b>Para crear rutas faltan dos cosas:</b> tu Casa y la clave de OpenRouteService.
            </>
          ) : missingHome ? (
            <>
              <b>Para crear rutas falta tu Casa:</b> el punto donde empiezan y acaban.
            </>
          ) : (
            <>
              <b>Para crear rutas falta la clave</b> de OpenRouteService. Es gratis.
            </>
          )}
        </Banner>
      ) : null}

      <section className="section" aria-label="Secciones de ajustes">
        <div className="settings">
          <Disclosure
            id="perfil"
            name="ajustes"
            icon={User}
            accent="dist"
            title="Perfil"
            meta={<span className="sum-name">{settings.displayName.trim() || 'Sin nombre'}</span>}
            defaultOpen={isOpen('perfil')}
          >
            <Field
              id="displayName"
              label="Nombre"
              help="Solo para el saludo de Inicio."
              value={settings.displayName}
              maxLength={40}
              autoComplete="given-name"
              autoCapitalize="words"
              enterKeyHint="done"
              placeholder="Tu nombre"
              onChange={(e) => setSettings((s) => ({ ...s, displayName: e.target.value }))}
              onBlur={() => saveIfChanged(settings.displayName.trim() ? 'Nombre guardado' : 'Nombre borrado')}
            />
          </Disclosure>

          <Disclosure
            id="casa"
            name="ajustes"
            icon={MapPin}
            accent="elev"
            leadTone={missingHome ? 'warn' : undefined}
            title="Casa"
            meta={missingHome ? <Warn>Sin elegir</Warn> : 'Punto de salida guardado'}
            defaultOpen={isOpen('casa')}
          >
            {missingHome ? (
              <p className="status-line" data-tone="warn">
                <TriangleAlert className="ic" aria-hidden="true" />
                <span>
                  <b>Aún no has elegido Casa.</b> Las rutas salen y vuelven a ella.
                </span>
              </p>
            ) : (
              <p className="status-line" data-tone="good">
                <CircleCheck className="ic" aria-hidden="true" />
                <span>
                  <b>Punto de salida guardado.</b> Aquí no se muestra la dirección, por privacidad.
                </span>
              </p>
            )}
            <Banner icon={ShieldCheck}>
              <b>La IA nunca recibe Casa.</b> Solo la usa OpenRouteService para trazar tus rutas, y va en tus copias de
              seguridad.
            </Banner>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setHomeOpen(true)}>
              <MapPin className="ic" aria-hidden="true" />
              {missingHome ? 'Elegir Casa' : 'Cambiar Casa'}
            </button>
          </Disclosure>

          <Disclosure
            id="claves"
            name="ajustes"
            icon={KeyRound}
            accent="time"
            leadTone={ors.ok === false ? 'bad' : missingKey ? 'warn' : undefined}
            title={sharedRoads ? 'Avanzado: usar mis propias claves' : 'Claves de servicio'}
            meta={keysMeta}
            defaultOpen={isOpen('claves')}
          >
            <div className="key-group">
              <h2 className="sub-h">
                <Route className="ic" aria-hidden="true" />
                Rutas: OpenRouteService
              </h2>
              <KeyField
                id="f-ors"
                label="Clave de OpenRouteService"
                owner="OpenRouteService"
                help="Es gratis. Solo se guarda en este navegador."
                value={settings.ors.apiKey}
                shown={shown.ors}
                error={ors.error}
                onToggle={() => setShown((v) => ({ ...v, ors: !v.ors }))}
                onChange={(apiKey) => {
                  setOrs({ busy: false });
                  setSettings((s) => ({ ...s, ors: { apiKey } }));
                }}
                onBlur={() => saveIfChanged('Clave guardada')}
              />
              <a className="btn btn--ghost key-get" href={ORS_SIGNUP} target="_blank" rel="noreferrer">
                <ExternalLink className="ic" aria-hidden="true" />
                Conseguir una clave gratis
                <span className="sr-only"> en openrouteservice.org (se abre en otra pestaña)</span>
              </a>
              <ProbeLine state={ors} name="OpenRouteService" empty="Sin ella no se pueden generar rutas." hasKey={!missingKey} />
              <button
                type="button"
                className="btn btn--secondary btn--block"
                aria-label="Probar conexión con OpenRouteService"
                aria-disabled={ors.busy || undefined}
                onClick={() => !ors.busy && void probe('ors')}
              >
                <RefreshCw className="ic" aria-hidden="true" />
                Probar conexión
              </button>
            </div>

            <div className="key-group">
              <h2 className="sub-h">
                <Sparkles className="ic" aria-hidden="true" />
                <span>IA: {provider}</span>
              </h2>
              <KeyField
                id="f-ia"
                label="Clave de la IA"
                owner="la IA"
                help="Opcional. La IA solo recibe cifras resumidas: nunca tus tracks ni Casa."
                placeholder="Pégala aquí…"
                value={settings.llm.apiKey}
                shown={shown.llm}
                error={llm.error}
                onToggle={() => setShown((v) => ({ ...v, llm: !v.llm }))}
                onChange={(apiKey) => {
                  setLlm({ busy: false });
                  setSettings((s) => ({ ...s, llm: { ...s.llm, apiKey } }));
                }}
                onBlur={() => saveIfChanged('Clave guardada')}
              />
              {provider === 'Groq' ? (
                <a className="btn btn--ghost key-get" href={GROQ_KEYS} target="_blank" rel="noreferrer">
                  <ExternalLink className="ic" aria-hidden="true" />
                  Conseguir una clave gratis
                  <span className="sr-only"> en console.groq.com (se abre en otra pestaña)</span>
                </a>
              ) : null}
              <ProbeLine
                state={llm}
                name={provider}
                empty="Las rutas se generan igual, sin las preguntas guiadas."
                hasKey={Boolean(settings.llm.apiKey.trim())}
              />
              <button
                type="button"
                className="btn btn--secondary btn--block"
                aria-label="Probar conexión con la IA"
                aria-disabled={llm.busy || undefined}
                onClick={() => !llm.busy && void probe('llm')}
              >
                <RefreshCw className="ic" aria-hidden="true" />
                Probar conexión
              </button>
              <button type="button" className="btn btn--ghost key-other" onClick={() => setProviderOpen(true)}>
                Usar otro proveedor
              </button>
            </div>
          </Disclosure>

          <Disclosure
            id="apariencia"
            name="ajustes"
            icon={Palette}
            title="Apariencia"
            meta={theme === 'light' ? 'Claro' : 'Oscuro'}
            defaultOpen={isOpen('apariencia')}
          >
            <ThemeToggle className="theme-switch" />
            <p className="help">
              El oscuro es la montaña de noche, con el trazado iluminado. El claro, un amanecer sin brillos, mejor a pleno
              sol.
            </p>
          </Disclosure>

          <BackupSection
            extra={extra}
            defaultOpen={isOpen('copia')}
            openRestore={openRestore}
            onExported={(t) => onExtra({ ...extra, lastBackupAt: t, staleBackup: false })}
            onRestored={() => onReplaced()}
          />

          <DeleteSection rides={extra.rides} onDeleted={() => onReplaced(structuredClone(DEFAULT_SETTINGS))} />
        </div>
      </section>

      <ProviderSheet
        open={providerOpen}
        llm={settings.llm}
        onClose={() => setProviderOpen(false)}
        onSave={async (baseUrl, model) => {
          const next = { ...settings, llm: { ...settings.llm, baseUrl, model } };
          setSettings(next);
          setLlm({ busy: false });
          const name = providerName(baseUrl);
          if (await persist(next, name === 'Groq' ? 'Proveedor: Groq, el de siempre' : `Proveedor guardado: ${name}`))
            setProviderOpen(false);
        }}
      />

      <HomeSheet
        open={homeOpen}
        onClose={() => setHomeOpen(false)}
        onPlace={async (home) => {
          const next = { ...settings, home };
          setSettings(next);
          if (await persist(next, 'Casa guardada')) setHomeOpen(false);
        }}
      />
    </>
  );
}

/** Resumen con aviso: icono ámbar (o rojo) y el texto en tinta. */
function Warn({ bad, children }: { bad?: boolean; children: ReactNode }) {
  const Icon = bad ? CircleAlert : TriangleAlert;
  return (
    <span className={bad ? 'sum-warn sum-bad' : 'sum-warn'}>
      <Icon className="ic" aria-hidden="true" />
      {children}
    </span>
  );
}

type KeyFieldProps = {
  id: string;
  label: string;
  /** «OpenRouteService» o «la IA»: completa los nombres de los botones. */
  owner: string;
  help: string;
  placeholder?: string;
  value: string;
  shown: boolean;
  error?: string;
  onToggle: () => void;
  onChange: (v: string) => void;
  onBlur: () => void;
};

const canPaste = () => typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

/** Campo de clave: oculta por defecto, con «Pegar» (si el navegador deja leer el portapapeles) y «Mostrar». */
function KeyField({ id, label, owner, help, placeholder, value, shown, error, onToggle, onChange, onBlur }: KeyFieldProps) {
  const toast = useToast();
  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        toast('El portapapeles está vacío');
        return;
      }
      onChange(text);
      toast('Clave pegada. Pruébala para comprobarla', { tone: 'good' });
    } catch {
      toast('No se pudo leer el portapapeles. Mantén pulsado el campo y elige Pegar');
      document.getElementById(id)?.focus();
    }
  }
  return (
    <Field
      id={id}
      label={label}
      help={help}
      error={error}
      type={shown ? 'text' : 'password'}
      inputClassName="input--key"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      inlineAction={
        <>
          {canPaste() ? (
            <button type="button" className="icon-btn key-paste" aria-label={`Pegar la clave de ${owner}`} onClick={paste}>
              <ClipboardPaste className="ic" aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="icon-btn" aria-label={`Mostrar la clave de ${owner}`} aria-pressed={shown} onClick={onToggle}>
            {shown ? <EyeOff className="ic" aria-hidden="true" /> : <Eye className="ic" aria-hidden="true" />}
          </button>
        </>
      }
    />
  );
}

function ProbeLine({ state, name, empty, hasKey }: { state: ProbeState; name: string; empty: string; hasKey: boolean }) {
  let tone: string | undefined;
  let body: ReactNode;
  if (state.busy) {
    tone = 'busy';
    body = (
      <>
        <LoaderCircle className="ic spin" aria-hidden="true" />
        <span>Probando con {name}…</span>
      </>
    );
  } else if (state.ok) {
    tone = 'good';
    body = (
      <>
        <CircleCheck className="ic" aria-hidden="true" />
        <span>
          <b>Conexión correcta.</b> La clave funciona.
        </span>
      </>
    );
  } else if (state.ok === false) {
    body = (
      <>
        <Clock className="ic" aria-hidden="true" />
        <span>Probada ahora: no conecta.</span>
      </>
    );
  } else if (!hasKey) {
    body = (
      <>
        <Info className="ic" aria-hidden="true" />
        <span>
          <b>Sin clave.</b> {empty}
        </span>
      </>
    );
  } else {
    body = (
      <>
        <Info className="ic" aria-hidden="true" />
        <span>Pruébala para saber si conecta.</span>
      </>
    );
  }
  return (
    <p className="status-line" role="status" data-tone={tone}>
      {body}
    </p>
  );
}

function ProviderSheet({
  open,
  llm,
  onClose,
  onSave,
}: {
  open: boolean;
  llm: Settings['llm'];
  onClose: () => void;
  onSave: (baseUrl: string, model: string) => void;
}) {
  const [url, setUrl] = useState(llm.baseUrl);
  const [model, setModel] = useState(llm.model);
  const [invalid, setInvalid] = useState(false);

  // Cada vez que se abre, parte de lo guardado.
  useEffect(() => {
    if (!open) return;
    setUrl(llm.baseUrl);
    setModel(llm.model);
    setInvalid(false);
  }, [open, llm.baseUrl, llm.model]);

  function save(nextUrl = url.trim(), nextModel = model.trim()) {
    if (!validUrl(nextUrl)) {
      setInvalid(true);
      document.getElementById('llmBaseUrl')?.focus();
      return;
    }
    onSave(nextUrl, nextModel);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Proveedor de IA"
      sub="Cualquiera compatible con la API de OpenAI. Groq va por defecto."
      footer={
        <button type="button" className="btn btn--primary btn--block" onClick={() => save()}>
          Guardar proveedor
        </button>
      }
    >
      <Field
        id="llmBaseUrl"
        label="URL base de la IA"
        type="url"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={url}
        help="La que termina en /v1, tal como la da tu proveedor."
        error={invalid ? 'Escribe la dirección completa, empezando por https://' : undefined}
        onChange={(e) => {
          setInvalid(false);
          setUrl(e.target.value);
        }}
      />
      <Field
        id="llmModel"
        label="Modelo de la IA"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={model}
        placeholder="openai/gpt-oss-20b"
        onChange={(e) => setModel(e.target.value)}
      />
      {providerName(llm.baseUrl) === 'Groq' ? null : (
        <button type="button" className="btn btn--ghost" onClick={() => save(GROQ_URL, '')}>
          <RefreshCw className="ic" aria-hidden="true" />
          Volver a Groq
        </button>
      )}
    </Sheet>
  );
}

function HomeSheet({
  open,
  onClose,
  onPlace,
}: {
  open: boolean;
  onClose: () => void;
  onPlace: (home: { lat: number; lng: number }) => void;
}) {
  const toast = useToast();
  const [locating, setLocating] = useState(false);

  function locate() {
    if (!('geolocation' in navigator)) {
      toast('Este navegador no da la ubicación', { tone: 'error' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        toast('No se ha podido leer tu ubicación. Revisa el permiso de ubicación del navegador', { tone: 'error' });
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Casa" sub="El punto donde empiezan y acaban tus rutas.">
      <button type="button" className="choice" data-m="dist" aria-busy={locating || undefined} onClick={locate}>
        <span className="row-lead" aria-hidden="true">
          {locating ? <LoaderCircle className="ic spin" /> : <Navigation className="ic" />}
        </span>
        <span>
          <b>Usar mi ubicación</b>
          <span>{locating ? 'Buscando dónde estás…' : 'El teléfono te pedirá permiso una vez'}</span>
        </span>
      </button>
      <Banner icon={ShieldCheck}>
        Se guarda en este navegador. <b>La IA nunca la recibe.</b>
      </Banner>
    </Sheet>
  );
}

function restoreMessage(e: unknown): string {
  if (!(e instanceof BackupError)) return `No se ha podido restaurar la copia: ${STORAGE_DOWN}`;
  if (e.reason === 'version') return 'La copia es de otra versión de la aplicación y no se puede restaurar.';
  return 'El fichero no es una copia de esta aplicación.';
}

function backupLabel(extra: Extra): string {
  if (extra.lastBackupAt === undefined) return 'Aún no has hecho ninguna copia';
  return `Última copia: ${daysAgoLabel(Math.floor((Date.now() - extra.lastBackupAt) / DAY))}`;
}

function BackupSection({
  extra,
  defaultOpen,
  openRestore,
  onExported,
  onRestored,
}: {
  extra: Extra;
  defaultOpen: boolean;
  openRestore: boolean;
  onExported: (t: number) => void;
  onRestored: () => Promise<void>;
}) {
  const toast = useToast();
  const [includeKeys, setIncludeKeys] = useState(false);
  const [status, setStatus] = useState('');
  const [restoreOpen, setRestoreOpen] = useState(openRestore);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onExport() {
    try {
      const blob = await exportBackup({ includeKeys });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ciclismo-copia-${localDay(Date.now())}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Copia exportada.');
      onExported(Date.now());
    } catch {
      setStatus(`No se ha podido exportar la copia: ${STORAGE_DOWN}`);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setRestoreOpen(false);
    if (!file) return;
    try {
      await restoreBackup(file);
      // El formulario se monta de nuevo con lo restaurado; el aviso, global, sale cuando ya se ve.
      await onRestored();
      toast('Copia restaurada.', { tone: 'good' });
    } catch (err) {
      setStatus(restoreMessage(err));
    }
  }

  const stale = extra.staleBackup;
  return (
    <Disclosure
      id="copia"
      name="ajustes"
      icon={Archive}
      accent="dist"
      leadTone={stale ? 'warn' : undefined}
      title="Copia de seguridad"
      meta={stale ? <Warn>Hay cambios sin copiar</Warn> : backupLabel(extra)}
      defaultOpen={defaultOpen}
    >
      {stale ? (
        <Banner tone="warn">
          <b>Tienes cambios sin copiar.</b> Has tocado el calendario o los objetivos después de la última copia.
          {extra.lastBackupAt !== undefined ? ` ${backupLabel(extra)}.` : null}
        </Banner>
      ) : null}
      <p className="help">
        La copia guarda tus <b>ajustes, calendario y objetivos</b> en un .json. Las salidas no van: se recuperan
        importando otra vez el archivo de Strava.
      </p>
      <label className="switch-line">
        <span className="row-main">
          <span className="row-title" id="sw-claves">
            Incluir claves
          </span>
          <span className="row-meta" id="sw-claves-d">
            Quien tenga el fichero podrá usar tus claves.
          </span>
        </span>
        <input
          type="checkbox"
          className="switch-input"
          checked={includeKeys}
          aria-labelledby="sw-claves"
          aria-describedby="sw-claves-d"
          onChange={(e) => setIncludeKeys(e.target.checked)}
        />
        <span className="switch" aria-hidden="true" />
      </label>
      <button type="button" className="btn btn--primary btn--block" onClick={onExport}>
        <Download className="ic" aria-hidden="true" />
        Exportar copia
      </button>
      <button type="button" className="btn btn--secondary btn--block" onClick={() => setRestoreOpen(true)}>
        <Upload className="ic" aria-hidden="true" />
        Restaurar
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        aria-label="Fichero de copia"
        hidden
        onChange={onFile}
      />
      <p className="status-line backup-status" role="status">
        {status}
      </p>

      <Sheet
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title="Restaurar una copia"
        footer={
          <>
            <button type="button" className="btn btn--primary btn--block" onClick={() => fileInput.current?.click()}>
              <File className="ic" aria-hidden="true" />
              Elegir la copia
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setRestoreOpen(false)}>
              Cancelar
            </button>
          </>
        }
      >
        {extra.rides > 0 || extra.lastBackupAt !== undefined ? (
          <>
            <Banner tone="warn">
              <b>Sustituye tu calendario y tus objetivos</b> por los de la copia. Tus salidas no cambian.
            </Banner>
            <p className="help">Tus ajustes también vienen de la copia. Si no lleva claves, se quedan las que tienes.</p>
          </>
        ) : (
          <>
            <Banner tone="warn">
              <b>Sustituye tu calendario y tus objetivos</b> por los de la copia.
            </Banner>
            <p className="help">
              Trae tus <b>ajustes, calendario y objetivos</b> del .json que descargaste en el otro teléfono. Las salidas
              se importan aparte, con el archivo de Strava.
            </p>
          </>
        )}
      </Sheet>
    </Disclosure>
  );
}

function DeleteSection({ rides, onDeleted }: { rides: number; onDeleted: () => Promise<void> }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState(false);

  async function deleteAll() {
    try {
      await clearAllData();
      setConfirm(false);
      setFailed(false);
      await onDeleted();
      toast('Datos borrados.', { tone: 'info' });
    } catch {
      setFailed(true);
    }
  }

  return (
    <Disclosure id="borrar" name="ajustes" icon={Trash2} leadTone="bad" danger title="Borrar datos" meta="Empezar de cero">
      <p className="help">
        Borra de este navegador las salidas, el calendario, los objetivos y los ajustes. Te pedirá confirmación.
      </p>
      <button type="button" className="btn btn--danger btn--block" onClick={() => setConfirm(true)}>
        <Trash2 className="ic" aria-hidden="true" />
        Borrar todos los datos
      </button>

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Borrar todos los datos"
        footer={
          <>
            <button type="button" className="btn btn--danger btn--block" onClick={deleteAll}>
              <Trash2 className="ic" aria-hidden="true" />
              Borrar todo
            </button>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => setConfirm(false)}>
              Cancelar
            </button>
          </>
        }
      >
        <p className="help">
          Se borran de este navegador{' '}
          {rides > 0 ? (
            <>
              <b>{rides === 1 ? '1 salida' : `${formatCount(rides)} salidas`}</b>, el calendario
            </>
          ) : (
            'el calendario'
          )}
          , los objetivos, Casa y las claves. <b>No se puede deshacer.</b>
        </p>
        <p className="help">Las salidas vuelven importando el archivo de Strava; el resto, solo con una copia.</p>
        {failed ? (
          <Banner tone="error">
            <b>No se ha podido borrar:</b> {STORAGE_DOWN}
          </Banner>
        ) : null}
      </Sheet>
    </Disclosure>
  );
}

function DemoBanner({ onRemoved }: { onRemoved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await clearDemoData();
      toast('Datos de ejemplo quitados', { tone: 'good' });
      onRemoved();
    } catch {
      toast(`No se han podido quitar: ${STORAGE_DOWN}`, { tone: 'error' });
      setBusy(false);
    }
  }
  return (
    <Banner
      action={
        <button type="button" className="btn btn--ghost" aria-disabled={busy || undefined} onClick={() => !busy && void remove()}>
          Quitar datos de ejemplo
        </button>
      }
    >
      <b>Hay datos de ejemplo en este navegador.</b> Quítalos cuando quieras: tus salidas, tu calendario y tus
      objetivos se quedan.
    </Banner>
  );
}
