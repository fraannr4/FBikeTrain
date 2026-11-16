import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { blockCyclist, reportCyclist } from '../../social/community';
import { Banner } from '../components/Banner';
import { Sheet } from '../components/Sheet';
import '../styles/community.css';

const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar. Comprueba la conexión.';

/** Acciones privadas: una denuncia no se publica en el perfil ni sanciona automáticamente. */
export function CommunitySafety({ client, targetId, name, onBlocked }: {
  client: SupabaseClient; targetId: string; name: string; onBlocked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // Submitting disables the focused button and clears the form. Keep keyboard focus in the sheet.
  useEffect(() => { if (notice) noticeRef.current?.focus({ preventScroll: true }); }, [notice]);
  async function block() {
    if (busy) return;
    setBusy(true); setError('');
    try { await blockCyclist(client, targetId, true); setOpen(false); onBlocked(); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function report(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await reportCyclist(client, targetId, reason); setReason(''); setNotice('Denuncia enviada. Solo el equipo de moderación puede revisarla; este ciclista no recibirá tu motivo.'); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <>
    <button className="btn btn--ghost btn--block" onClick={() => { setOpen(true); setError(''); setNotice(''); }}>Bloquear o denunciar</button>
    <Sheet title="Cuidar tu comunidad" open={open} onClose={() => { if (!busy) setOpen(false); }}>
      <div className="community-safety">
        <p><strong>{name}</strong></p>
        {error && <Banner tone="error">{error}</Banner>}
        {notice && <p role="status" tabIndex={-1} ref={noticeRef}>{notice}</p>}
        <p>Al bloquear, se retira vuestra amistad y se cortan las interacciones. Puedes deshacerlo en Ciclistas → Ciclistas bloqueados.</p>
        <button className="btn btn--secondary btn--block" disabled={busy} onClick={() => void block()}>Bloquear a este ciclista</button>
        <hr />
        <form onSubmit={report}>
          <label className="field"><span className="field-label">Motivo de la denuncia</span><textarea className="input" required minLength={5} maxLength={500} rows={3} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} placeholder="Cuéntanos qué ha ocurrido, sin incluir datos personales." /></label>
          <p>La denuncia es privada y se revisa manualmente.</p>
          <button className="btn btn--secondary btn--block" type="submit" disabled={busy || reason.trim().length < 5}>Enviar denuncia</button>
        </form>
      </div>
    </Sheet>
  </>;
}
