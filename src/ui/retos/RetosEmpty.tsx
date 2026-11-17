import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Account } from '../../auth/AccountBoundary';
import { listCyclists } from '../../social/community';
import { listFriends } from '../../social/friends';
import { ProfileAvatar } from '../profile/ProfileAvatar';

type Candidate = { id: string; name: string; avatar: number; why: string };
const MAX = 4;

/** Sin retos en juego: a quién retar (amigos primero, después ciclistas activos) y plantillas rápidas. */
export function RetosEmpty({ account }: { account: Account }) {
  const [people, setPeople] = useState<Candidate[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.allSettled([listFriends(account.client), listCyclists(account.client)]).then(([friends, cyclists]) => {
      if (!live) return;
      const out = new Map<string, Candidate>();
      if (friends.status === 'fulfilled') {
        for (const f of friends.value) if (f.status === 'accepted') out.set(f.profile.id, { id: f.profile.id, name: f.profile.display_name, avatar: 0, why: 'Amigo' });
      }
      if (cyclists.status === 'fulfilled') {
        for (const c of cyclists.value) {
          if (c.id === account.user.id || out.has(c.id)) continue;
          out.set(c.id, { id: c.id, name: c.display_name, avatar: c.avatar_version, why: c.locality ?? 'Activo hace poco' });
        }
      }
      setPeople([...out.values()].slice(0, MAX));
    });
    return () => { live = false; };
  }, [account.client, account.user.id]);

  return (
    <div className="card community-empty retos-empty">
      <h2>Aún no tienes retos en juego</h2>
      <p>Elige a alguien y medid vuestro esfuerzo durante unos días. Aquí verás el marcador.</p>
      {people && people.length > 0 ? (
        <ul className="retos-suggest" aria-label="A quién retar">
          {people.map((p) => (
            <li key={p.id}>
              <ProfileAvatar client={account.client} userId={p.id} name={p.name} version={p.avatar} />
              <span className="retos-suggest-who"><strong>{p.name}</strong><small>{p.why}</small></span>
              <Link className="btn btn--secondary" to={`/retos/nuevo?ciclista=${encodeURIComponent(p.id)}`} aria-label={`Retar a ${p.name}`}>Retar</Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="retos-templates" role="group" aria-label="Plantillas rápidas">
        <Link className="btn btn--primary btn--block" to="/retos/nuevo?plantilla=100km">+100 km esta semana</Link>
        <Link className="btn btn--secondary btn--block" to="/retos/nuevo">Reto a medida</Link>
      </div>
    </div>
  );
}
