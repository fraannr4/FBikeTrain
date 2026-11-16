import { useState } from 'react';
import { useGarminConnections } from '../../connections/GarminProvider';
import type { ReferenceRoute } from '../../routes/library';

/** Publica el recorrido en Garmin Connect (Courses API). Solo aparece si la cuenta lo permite. */
export function SendToGarmin({ route }: { route: ReferenceRoute }) {
  const garmin = useGarminConnections();
  const [state, setState] = useState<{ busy?: boolean; done?: boolean; error?: string }>({});
  if (!garmin?.available || !garmin.connected || !garmin.courseAvailable) return null;
  async function send() {
    setState({ busy: true });
    try { await garmin!.sendCourse(route); setState({ done: true }); }
    catch (error) { setState({ error: error instanceof Error ? error.message : 'No se pudo enviar a Garmin.' }); }
  }
  return <>
    <button type="button" className="btn btn--secondary btn--block" disabled={state.busy} onClick={() => void send()}>Enviar a Garmin</button>
    {state.done ? <p className="help" role="status">Enviada a Garmin Connect. Sincroniza tu dispositivo y la verás en Recorridos.</p> : null}
    {state.error ? <p className="help" role="alert">{state.error}</p> : null}
  </>;
}
