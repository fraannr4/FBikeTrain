import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { CommunityReto } from '../src/ui/pages/CommunityReto';
import type { CommunityChallenge, CommunityMember } from '../src/social/communityChallenges';

const DAY = 86_400_000;
const member = (id: string, name: string, score: number | null): CommunityMember => ({ id, username: id, display_name: name, status: 'accepted', accepted_at: null, score, updated_at: null });
const DUEL: CommunityChallenge = {
  id: 'c3', title: 'Collado de las Encinas', kind: 'distance', created_at: new Date(Date.now() - DAY).toISOString(), deadline: new Date(Date.now() + 2.5 * DAY).toISOString(),
  creator_id: 'p4', target_value: null, distance_m: null, segment_key: null, status: 'active', winner_ids: [], members: [member('p4', 'Ana', 9000), member('u1', 'Tú', 12_500)],
};

function setup(gate?: Promise<unknown>) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'get_community_challenge') { if (gate) await gate; return { data: DUEL, error: null }; }
    return { data: null, error: null };
  });
  const from = vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { display_name: 'Fran', avatar_version: 0 }, error: null }) })) })) }));
  render(
    <AccountContext.Provider value={{ client: { rpc, from } as unknown as SupabaseClient, user: { id: 'u1' } as User }}>
      <MemoryRouter initialEntries={['/retos/comunidad/c3']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/retos/comunidad/:id" element={<CommunityReto />} /></Routes>
      </MemoryRouter>
    </AccountContext.Provider>,
  );
}

describe('Detalle del reto', () => {
  it('dice cuánto queda y quién va por delante', async () => {
    setup();
    expect(await screen.findByText(/Quedan 2 días/)).toBeInTheDocument();
    expect(screen.getByText('Vas por delante: +3,5 km')).toBeInTheDocument();
  });

  it('mientras carga muestra un esqueleto ocupado', () => {
    setup(new Promise(() => {}));
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText(/Preparando el marcador/)).toBeInTheDocument();
  });
});
