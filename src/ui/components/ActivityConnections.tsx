import { useEffect, useState } from 'react';
import { useConnections } from '../../connections/ConnectionsProvider';
import { validateCredentials } from '../../connections/intervalsClient';
import { Disclosure } from './Disclosure';
import { Field } from './Field';
import { Banner } from './Banner';
import { ImportReportView } from './ImportReportView';
import { RefreshCw } from '../icons';

export function ActivityConnections({ defaultOpen }: { defaultOpen: boolean }) {
  const connections = useConnections();
  const [athleteId, setAthleteId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [, setClock] = useState(0);
  const config = connections?.connection;
  useEffect(() => {
    setAthleteId(config?.athleteId ?? ''); setApiKey(config?.apiKey ?? ''); setAutoSync(config?.autoSync ?? true);
  }, [config?.athleteId, config?.apiKey, config?.autoSync]);
  const retryAt = connections?.state.retryAt;
  useEffect(() => {
    if (!retryAt || retryAt <= Date.now()) return;
    const timer = setTimeout(() => setClock(v => v + 1), Math.min(retryAt - Date.now() + 50, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [retryAt]);
  if (!connections) return null;
  const { state, ready, busy, storageError } = connections;
  const dirty = config?.athleteId !== athleteId.trim() || config?.apiKey !== apiKey.trim() || config?.autoSync !== autoSync;
  const blocked = !!state.retryAt && state.retryAt > Date.now();
  const date = (t: number) => new Date(t).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  async function save() {
    setError(''); setSaved(false);
    try {
      const valid = validateCredentials({ athleteId, apiKey });
      await connections!.save({ ...valid, autoSync });
      setSaved(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar la conexión.'); }
  }
  async function disconnect() {
    try { await connections!.save(); setError(''); setSaved(false); }
    catch { setError('No se pudo desconectar. Revisa el almacenamiento del navegador.'); }
  }
  return (
    <Disclosure id="conexiones" name="ajustes" icon={RefreshCw} accent="dist" title="Conexiones" meta={busy ? 'Comprobando salidas…' : config ? 'Intervals.icu · uso personal' : 'Trae tus salidas de Intervals.icu'} defaultOpen={defaultOpen}>
      <div className="activity-connection">
        <h2 className="sub-h">Intervals.icu</h2>
        <p>{config ? `Cuenta ${config.athleteId} conectada en este navegador.` : 'Trae tus salidas con tu clave personal, sin contraseñas.'}</p>
        <details className="connection-options" open={!config}>
        <summary>{config ? 'Cambiar conexión y sincronización' : 'Configurar la conexión'}</summary>
        <div className="activity-connection">
        <p>Genera una clave en <a href="https://intervals.icu/settings" target="_blank" rel="noreferrer">Ajustes de Intervals.icu</a>, al final, en las opciones de desarrollador.</p>
        <Field id="intervals-athlete" label="Athlete id de Intervals.icu" help="Incluye la i si tu id la lleva (i12345). Puedes usar 0 para tu propia cuenta." autoCapitalize="none" spellCheck={false} autoComplete="off" maxLength={21} value={athleteId} disabled={!ready || busy} onChange={e => { setAthleteId(e.target.value); setSaved(false); }} />
        <Field id="intervals-key" label="Clave de API de Intervals.icu" type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={256} value={apiKey} disabled={!ready || busy} onChange={e => { setApiKey(e.target.value); setSaved(false); }} />
        <label className="connection-check"><input type="checkbox" checked={autoSync} disabled={!ready || busy} onChange={e => { setAutoSync(e.target.checked); setSaved(false); }} /><span>Traer salidas al abrir o volver a la app, como máximo cada 6 horas</span></label>
        <button type="button" className="btn btn--secondary btn--block" disabled={!ready || busy || !dirty} onClick={() => void save()}>Guardar conexión</button>
        </div>
        </details>
        <p>La clave queda en este navegador, para tu cuenta. Solo se envía a Intervals.icu; no entra en Supabase ni en tus copias de seguridad.</p>
        {error || storageError ? <p role="alert">{error || 'No se puede acceder al almacenamiento de conexiones.'}</p> : null}
        {saved ? <p role="status">Conexión guardada en este navegador.</p> : null}
        <button type="button" className="btn btn--primary btn--block" disabled={!config || dirty || busy || blocked} onClick={() => void connections.sync()}>Traer salidas nuevas</button>
        {dirty && config ? <p>Guarda los cambios antes de traer salidas.</p> : null}
        {busy ? <><p role="status">Descargando e importando salidas…</p><button type="button" className="btn btn--secondary btn--block" onClick={connections.cancel}>Parar sincronización</button></> : null}
        {state.lastAttemptAt ? <p>Último intento: {date(state.lastAttemptAt)}.</p> : null}
        {state.lastSuccessAt ? <p>Última comprobación completa: {date(state.lastSuccessAt)}.</p> : null}
        {state.error ? <p role="alert">{state.error}</p> : null}
        {blocked ? <p>Podrás reintentar después de {date(state.retryAt!)}.</p> : null}
        {config ? <button type="button" className="btn btn--ghost btn--block" disabled={busy} onClick={() => void disconnect()}>Desconectar Intervals.icu</button> : null}
        <p>Desconectar borra la clave local y el seguimiento, y conserva tus salidas. Puedes revocar la clave en Intervals.icu.</p>
        <details className="connection-options"><summary>Qué salidas se traen</summary><div className="activity-connection">
          <p>La app debe estar abierta. Se buscan salidas desde tu última salida guardada; si no tienes historial, desde hace 30 días. Se revisan también días anteriores por si una salida llegó con retraso.</p>
          <Banner>Solo originales disponibles: FIT, GPX o TCX. Strava y los datos identificados como Garmin quedan fuera de este conector. Para iGPSPORT, activa la conexión oficial a Intervals.icu si tu app la ofrece; si no, comparte el archivo.</Banner>
        </div></details>
        {state.result ? <>
          <p>Resultado del {date(state.result.at)}.</p>
          {state.result.excluded ? <p>{state.result.excluded} actividades excluidas por su fuente o sin datos disponibles.</p> : null}
          {state.result.pending ? <Banner tone="error">Quedan salidas pendientes. Vuelve a traerlas; las ya guardadas no se duplican.</Banner> : null}
          <ImportReportView report={state.result.report} />
        </> : null}
      </div>
    </Disclosure>
  );
}
