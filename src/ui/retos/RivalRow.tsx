import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommunityChallenge } from '../../social/communityChallenges';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { Plus } from '../icons';

type State = 'invited' | 'sent' | 'active' | 'rematch';
type Rival = { id: string; name: string; state: State; to: string };
const LABEL: Record<State, string> = { invited: 'Te reta', sent: 'Enviado', active: 'En juego', rematch: 'Revancha' };
const RANK: Record<State, number> = { invited: 0, sent: 1, active: 2, rematch: 3 };
const MAX = 12;

/** Con quién tienes algo, por urgencia: te reta, enviado, en juego y, al final, revancha. */
export function rivalsOf(rows: CommunityChallenge[], userId: string, now: number): Rival[] {
  const best = new Map<string, Rival>();
  const offer = (r: Rival) => {
    const prev = best.get(r.id);
    if (!prev || RANK[r.state] < RANK[prev.state]) best.set(r.id, r);
  };
  for (const c of rows) {
    const mine = c.members.find((m) => m.id === userId)?.status;
    const open = c.status === 'active' && Date.parse(c.deadline) > now;
    const to = `/retos/comunidad/${c.id}`;
    for (const m of c.members) {
      if (m.id === userId) continue;
      const rival = { id: m.id, name: m.display_name };
      if (!open) {
        if (mine === 'accepted' && m.status === 'accepted') offer({ ...rival, state: 'rematch', to: `/retos/nuevo?ciclista=${encodeURIComponent(m.id)}` });
      } else if (mine === 'pending') {
        if (m.id === c.creator_id) offer({ ...rival, state: 'invited', to });
      } else if (mine === 'accepted') {
        if (m.status === 'accepted') offer({ ...rival, state: 'active', to });
        else if (m.status === 'pending' && c.creator_id === userId) offer({ ...rival, state: 'sent', to });
      }
    }
  }
  return [...best.values()].sort((a, b) => RANK[a.state] - RANK[b.state]).slice(0, MAX);
}

/** «¿A quién retas?»: Buscar abre Ciclistas; cada rival lleva un anillo de estado y el estado en texto. */
export function RivalRow({ client, rows, userId }: { client: SupabaseClient; rows: CommunityChallenge[]; userId: string }) {
  const rivals = rivalsOf(rows, userId, Date.now());
  return (
    <section className="rival-row" aria-labelledby="rival-row-title">
      <h2 id="rival-row-title" className="rival-row-title">¿A quién retas?</h2>
      <ul className="rival-list">
        <li>
          <Link className="rival" to="/ciclistas" aria-label="Buscar rival">
            <span className="rival-ring rival-ring--add" aria-hidden="true"><Plus className="ic" /></span>
            <span className="rival-name">Buscar</span>
          </Link>
        </li>
        {rivals.map((r) => (
          <li key={r.id}>
            <Link className="rival" to={r.to} aria-label={`${r.name}: ${LABEL[r.state].toLocaleLowerCase('es')}`} data-state={r.state}>
              <span className="rival-ring" aria-hidden="true">
                <ProfileAvatar client={client} userId={r.id} name={r.name} />
              </span>
              <span className="rival-name">{r.name}</span>
              <span className="rival-state">{LABEL[r.state]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
