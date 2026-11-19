import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AccountContext } from '../src/auth/AccountBoundary';
import { CommunityRetos } from '../src/ui/pages/CommunityRetos';
import { COMMUNITY_CHANGED_EVENT } from '../src/social/communityBadge';
import type { CommunityChallenge, CommunityMember, CommunityNotification } from '../src/social/communityChallenges';
import type { FriendRow } from '../src/social/friends';

const DAY = 86_400_000;
const member = (id: string, name: string, status: CommunityMember['status'], score: number | null = null): CommunityMember => ({ id, username: id, display_name: name, status, accepted_at: null, score, updated_at: null });
const challenge = (id: string, title: string, creator: string, members: CommunityMember[], over: Partial<CommunityChallenge> = {}): CommunityChallenge => ({
  id, title, kind: 'distance', created_at: new Date(Date.now() - DAY).toISOString(), deadline: new Date(Date.now() + 6 * DAY).toISOString(), creator_id: creator,
  target_value: null, distance_m: null, segment_key: null, status: 'active', members, winner_ids: [], ...over,
});

const INVITATION = challenge('c1', 'Vuelta del embalse', 'p2', [member('p2', 'Marta', 'accepted'), member('u1', 'Tú', 'pending')]);
const SENT = challenge('c2', 'Puerto de la Morcuera', 'u1', [member('u1', 'Tú', 'accepted'), member('p3', 'Jordi', 'pending')]);
const ACTIVE = challenge('c3', 'Collado de las Encinas', 'p4', [member('p4', 'Ana', 'accepted', 9000), member('u1', 'Tú', 'accepted', 8000)]);
const DONE = challenge('c4', 'Noviembre en llano', 'u1', [member('u1', 'Tú', 'accepted', 9000), member('p5', 'Pablo', 'accepted', 8000)], { status: 'finished', winner_ids: ['u1'] });

function setup({ challenges = [INVITATION, SENT, ACTIVE, DONE], notifications = [] as CommunityNotification[], friends = [] as FriendRow[], path = '/retos', respond, listGate }: { challenges?: CommunityChallenge[]; notifications?: CommunityNotification[]; friends?: FriendRow[]; path?: string; respond?: () => Promise<{ data: null; error: { message: string } | null }>; listGate?: Promise<unknown> } = {}) {
  let rows = challenges;
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'list_community_challenges') { if (listGate) await listGate; return { data: args?.page_offset ? [] : rows, error: null }; }
    if (fn === 'list_community_notifications') return { data: args?.page_offset ? [] : notifications, error: null };
    if (fn === 'list_friends') return { data: friends, error: null };
    if (fn === 'list_cyclists') return { data: [{ id: 'p6', username: 'luis', display_name: 'Luis Llano', bio: '', riding_style: 'grupo', avatar_version: 0, locality: null, distance_km: null, last_active_at: null }], error: null };
    if (fn === 'respond_community_challenge') {
      if (respond) return respond();
      rows = rows.map(c => c.id !== args?.challenge_id ? c : { ...c, members: c.members.map(m => m.id === 'u1' ? { ...m, status: args?.accept ? 'accepted' : 'declined' } : m) });
    }
    return { data: null, error: null };
  });
  const from = vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { display_name: 'Fran', avatar_version: 0 }, error: null }) })) })) }));
  render(
    <AccountContext.Provider value={{ client: { rpc, from } as unknown as SupabaseClient, user: { id: 'u1' } as User }}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CommunityRetos /></MemoryRouter>
    </AccountContext.Provider>,
  );
  return { rpc };
}

describe('Retos como pestaña', () => {
  it('es pantalla raíz de «Gente»: sin volver y con tu foto; buscar rival vive en «¿A quién retas?»', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Gente', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Volver/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Tú: perfil, importar y ajustes' })).toHaveAttribute('href', '/perfil');
    // La lupa de la cabecera repetía «Buscar» de la fila de rivales y la pestaña Ciclistas.
    expect(screen.queryByRole('link', { name: 'Buscar ciclistas' })).not.toBeInTheDocument();
    const row = await screen.findByRole('region', { name: '¿A quién retas?' });
    expect(within(row).getByRole('link', { name: 'Buscar rival' })).toHaveAttribute('href', '/ciclistas');
  });

  it('la fila «¿A quién retas?» enseña cada rival con su estado en texto', async () => {
    setup();
    const row = await screen.findByRole('region', { name: '¿A quién retas?' });
    expect(within(row).getByRole('link', { name: 'Buscar rival' })).toHaveAttribute('href', '/ciclistas');
    expect(await within(row).findByRole('link', { name: 'Marta: te reta' })).toHaveAttribute('href', '/retos/comunidad/c1');
    expect(within(row).getByRole('link', { name: 'Jordi: enviado' })).toHaveAttribute('href', '/retos/comunidad/c2');
    expect(within(row).getByRole('link', { name: 'Ana: en juego' })).toHaveAttribute('href', '/retos/comunidad/c3');
    expect(within(row).getByRole('link', { name: 'Pablo: revancha' })).toHaveAttribute('href', '/retos/nuevo?ciclista=p5');
  });

  it('acepta una invitación desde la tarjeta y avisa a la barra', async () => {
    const { rpc } = setup();
    const changed = vi.fn();
    window.addEventListener(COMMUNITY_CHANGED_EVENT, changed);
    const user = userEvent.setup();
    const card = await screen.findByRole('article', { name: 'Marta te reta: Vuelta del embalse' });
    await user.click(within(card).getByRole('button', { name: 'Aceptar reto «Vuelta del embalse»' }));
    expect(rpc).toHaveBeenCalledWith('respond_community_challenge', { challenge_id: 'c1', accept: true });
    expect(await screen.findByRole('status')).toHaveTextContent('Reto aceptado');
    expect(screen.queryByRole('article', { name: 'Marta te reta: Vuelta del embalse' })).not.toBeInTheDocument();
    expect(changed).toHaveBeenCalled();
    window.removeEventListener(COMMUNITY_CHANGED_EVENT, changed);
  });

  it('rechaza con «Ahora no»', async () => {
    const { rpc } = setup();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ahora no: «Vuelta del embalse»' }));
    expect(rpc).toHaveBeenCalledWith('respond_community_challenge', { challenge_id: 'c1', accept: false });
  });

  it('filtros En juego · Avisos · Historial, pequeños y bajo «¿A quién retas?»', async () => {
    setup({ notifications: [{ id: 'n1', kind: 'invitation', challenge_id: 'c1', actor_id: 'p2', created_at: new Date().toISOString(), read_at: null }] });
    const user = userEvent.setup();
    const views = await screen.findByRole('group', { name: 'Vistas de retos' });
    const rivals = await screen.findByRole('region', { name: '¿A quién retas?' });
    // Dos segmentados iguales seguidos (partes de Gente y vistas) no: las vistas son filtros.
    expect(views).not.toHaveClass('seg');
    expect(views).toHaveClass('view-filters');
    expect(rivals.compareDocumentPosition(views) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(views).getAllByRole('button').map(b => b.textContent)).toEqual(['En juego', 'Avisos (1)', 'Historial']);
    expect(within(views).getByRole('button', { name: 'En juego' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Collado de las Encinas')).toBeInTheDocument();
    expect(screen.queryByText('Noviembre en llano')).not.toBeInTheDocument();
    await user.click(within(views).getByRole('button', { name: 'Historial' }));
    expect(within(views).getByRole('button', { name: 'Historial' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(views).getByRole('button', { name: 'En juego' })).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByText('Noviembre en llano')).toBeInTheDocument();
    await user.click(within(views).getByRole('button', { name: 'Avisos (1)' }));
    expect(screen.getByText('Te han invitado a un reto')).toBeInTheDocument();
  });

  it('los filtros se usan con el teclado', async () => {
    setup();
    const user = userEvent.setup();
    const views = await screen.findByRole('group', { name: 'Vistas de retos' });
    within(views).getByRole('button', { name: 'En juego' }).focus();
    await user.tab();
    await user.tab();
    expect(within(views).getByRole('button', { name: 'Historial' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('region', { name: 'Historial de retos' })).toBeInTheDocument();
    expect(within(views).getByRole('button', { name: 'Historial' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('abre el historial desde la dirección', async () => {
    setup({ path: '/retos?vista=historial' });
    expect(await screen.findByText('Noviembre en llano')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Vistas de retos' })).getByRole('button', { name: 'Historial' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('abre los avisos desde la dirección', async () => {
    setup({ path: '/retos?vista=avisos' });
    expect(await screen.findByRole('region', { name: 'Notificaciones de retos' })).toBeInTheDocument();
  });

  it('sin retos, sugiere a quién retar y una plantilla rápida', async () => {
    const bea = { id: 'p3', username: 'bea', display_name: 'Bea Puerto', locality: null, distance_km: null };
    setup({ challenges: [], friends: [{ friendship_id: 'f1', status: 'accepted', direction: 'sent', profile: bea }] });
    expect(await screen.findByRole('heading', { name: 'Aún no tienes retos en juego' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Retar a Bea Puerto' })).toHaveAttribute('href', '/retos/nuevo?ciclista=p3');
    expect(await screen.findByRole('link', { name: 'Retar a Luis Llano' })).toHaveAttribute('href', '/retos/nuevo?ciclista=p6');
    expect(screen.getByRole('link', { name: /\+100 km esta semana/ })).toHaveAttribute('href', '/retos/nuevo?plantilla=100km');
  });

  it('en cada reto en juego dice cuánto queda y quién va por delante', async () => {
    setup();
    const card = (await screen.findByText('Collado de las Encinas')).closest('a') as HTMLElement;
    expect(within(card).getByText('Quedan 5 días')).toBeInTheDocument();
    expect(within(card).getByText('Ana te saca 1 km')).toBeInTheDocument();
  });

  it('mientras carga muestra un esqueleto ocupado, no un salto de contenido', () => {
    setup({ listGate: new Promise(() => {}) });
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText(/Cargando tus retos/)).toBeInTheDocument();
  });

  it('aceptar es instantáneo: la invitación sale antes de que responda el servidor', async () => {
    let finish: (v: { data: null; error: null }) => void = () => {};
    setup({ respond: () => new Promise(resolve => { finish = resolve; }) });
    const user = userEvent.setup();
    const card = await screen.findByRole('article', { name: 'Marta te reta: Vuelta del embalse' });
    await user.click(within(card).getByRole('button', { name: 'Aceptar reto «Vuelta del embalse»' }));
    expect(screen.queryByRole('article', { name: 'Marta te reta: Vuelta del embalse' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reto aceptado');
    finish({ data: null, error: null });
  });

  it('si el servidor falla, la invitación vuelve y se explica el error', async () => {
    setup({ respond: async () => ({ data: null, error: { message: 'Reto cerrado' } }) });
    const user = userEvent.setup();
    const card = await screen.findByRole('article', { name: 'Marta te reta: Vuelta del embalse' });
    await user.click(within(card).getByRole('button', { name: 'Aceptar reto «Vuelta del embalse»' }));
    expect(await screen.findByText(/plazo del reto ha terminado/)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Marta te reta: Vuelta del embalse' })).toBeInTheDocument();
    expect(screen.queryByText(/Reto aceptado/)).not.toBeInTheDocument();
  });
});
