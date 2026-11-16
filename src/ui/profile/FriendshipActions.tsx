import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { blockCyclist } from '../../social/community';
import { acceptFriendship, removeFriendship, requestFriendship, type FriendRow } from '../../social/friends';
import { Sheet } from '../components/Sheet';
import { Check, Swords, UserPlus } from '../icons';

/** Ejecuta la acción, refresca la relación y dice si salió bien (los errores los muestra quien la llama). */
type Act = (run: () => Promise<void>, success: string) => Promise<boolean>;

/**
 * Botón principal según la relación (Añadir amigo, Solicitud enviada, Responder solicitud o Amigos)
 * y Retar al lado. Lo que no es la acción principal (cancelar, rechazar, eliminar, bloquear) va en una hoja.
 */
export function FriendshipActions({ client, targetId, name, friendship: f, busy, act, onBlocked }: {
  client: SupabaseClient; targetId: string; name: string; friendship: FriendRow | null; busy: boolean; act: Act; onBlocked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const run = (fn: () => Promise<void>, success: string) => { setOpen(false); void act(fn, success); };
  const block = () => { setOpen(false); void act(() => blockCyclist(client, targetId, true), '').then(ok => { if (ok) onBlocked(); }); };
  const primary = !f
    ? <button className="btn btn--primary" disabled={busy} onClick={() => void act(() => requestFriendship(client, targetId), 'Solicitud de amistad enviada.')}><UserPlus className="ic" aria-hidden="true" />Añadir amigo</button>
    : f.status === 'accepted'
      ? <button className="btn btn--secondary" disabled={busy} aria-haspopup="dialog" onClick={() => setOpen(true)}><Check className="ic" aria-hidden="true" />Amigos</button>
      : f.direction === 'received'
        ? <button className="btn btn--primary" disabled={busy} aria-haspopup="dialog" onClick={() => setOpen(true)}>Responder solicitud</button>
        : <button className="btn btn--secondary" disabled={busy} aria-haspopup="dialog" onClick={() => setOpen(true)}>Solicitud enviada</button>;
  return <>
    <div className="btn-row profile-relation">
      {primary}
      <Link className="btn btn--secondary" to={`/retos/nuevo?ciclista=${encodeURIComponent(targetId)}`} aria-label={`Retar a ${name}`}><Swords className="ic" aria-hidden="true" />Retar</Link>
    </div>
    <Sheet open={open} onClose={() => setOpen(false)} title={name}
      sub={f?.status === 'accepted' ? 'Sois amigos.' : f?.direction === 'received' ? 'Te ha enviado una solicitud de amistad.' : 'Solicitud de amistad pendiente.'}>
      {f ? <div className="profile-relation-menu">
        {f.status === 'accepted' ? <>
          <button className="btn btn--secondary btn--block" disabled={busy} onClick={() => run(() => removeFriendship(client, f.friendship_id), 'Amistad retirada.')}>Eliminar de amigos</button>
          <button className="btn btn--ghost btn--block" disabled={busy} onClick={block} aria-label={`Bloquear a ${name}`}>Bloquear</button>
          <p className="help">Al bloquear, se retira vuestra amistad y se cortan las interacciones. Puedes deshacerlo en Ciclistas.</p>
        </> : f.direction === 'received' ? <>
          <button className="btn btn--primary btn--block" disabled={busy} onClick={() => run(() => acceptFriendship(client, f.friendship_id), 'Solicitud aceptada.')}>Aceptar solicitud</button>
          <button className="btn btn--secondary btn--block" disabled={busy} onClick={() => run(() => removeFriendship(client, f.friendship_id), 'Solicitud rechazada.')}>Rechazar solicitud</button>
        </> : <button className="btn btn--secondary btn--block" disabled={busy} onClick={() => run(() => removeFriendship(client, f.friendship_id), 'Solicitud cancelada.')}>Cancelar solicitud</button>}
      </div> : null}
    </Sheet>
  </>;
}
