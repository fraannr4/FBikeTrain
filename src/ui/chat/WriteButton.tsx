import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { openDirect } from '../../social/chat';
import { useToast } from '../components/Toast';
import { MessageCircle } from '../icons';

/** «Escribir» a un amigo: abre vuestra conversación (o la crea) y la enseña. */
export function WriteButton({ client, userId, name, icon = false }: { client: SupabaseClient; userId: string; name: string; icon?: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      navigate(`/chat/${encodeURIComponent(await openDirect(client, userId))}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se ha podido abrir la conversación.', { tone: 'error' });
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn btn--secondary" aria-label={`Escribir a ${name}`} disabled={busy} onClick={() => void open()}>
      {icon ? <MessageCircle className="ic" aria-hidden="true" /> : null}
      Escribir
    </button>
  );
}
