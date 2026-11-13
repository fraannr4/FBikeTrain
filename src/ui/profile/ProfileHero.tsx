import type { ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Camera } from '../icons';
import { ProfileAvatar } from './ProfileAvatar';
import { RIDING_STYLES, ridingStyle } from './profileStyle';
export type ProfileIdentity = { id: string; username: string; display_name: string; bio?: string; riding_style?: string; avatar_version?: number };

/** Paisaje inventado de marca: nunca la geometría ni el mapa de una salida. */
export function ProfileHero({ client, profile, own = false, onPhoto, photoBusy = false, children }: {
  client: SupabaseClient; profile: ProfileIdentity; own?: boolean; onPhoto?: () => void; photoBusy?: boolean; children?: ReactNode;
}) {
  const mode = ridingStyle(profile.riding_style);
  const style = RIDING_STYLES[mode]; const Icon = style.icon;
  return <section className="profile-hero" data-riding={mode} data-own={own ? 'true' : undefined} aria-label={own ? 'Tu identidad pública' : 'Identidad del ciclista'}>
    <div className="profile-cover">
      <svg className="profile-landscape" viewBox="0 0 1000 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path className="profile-contour" d="M-50 60Q150-30 340 60T730 55T1100 40M-50 84Q150-6 340 84T730 79T1100 64M-50 108Q150 18 340 108T730 103T1100 88" />
        <path className="profile-far" d="M0 215 140 120 230 162 390 52 550 170 650 112 790 180 920 82 1000 140V240H0Z" />
        <path className="profile-near" d="M0 240 200 195 370 222 545 142 685 205 840 155 1000 220V240Z" />
        <path className="profile-signature" d="M565 240C510 217 577 208 589 191S536 179 569 164 628 170 646 143" />
        <circle className="profile-summit" cx="646" cy="143" r="5" /><circle className="profile-sun" cx="817" cy="62" r="22" />
      </svg>
      <span className="profile-cover-label">CUADERNO DE RUTA <span>FB / 01</span></span>
      <p className="profile-cover-copy">Cada ciclista,<br /><em>una manera de rodar.</em></p>
    </div>
    <div className="profile-intro">
      <div className="profile-portrait"><ProfileAvatar client={client} userId={profile.id} name={profile.display_name} version={profile.avatar_version ?? 0} size="large" />
        {onPhoto && <button className="profile-camera" type="button" disabled={photoBusy} onClick={onPhoto} aria-label="Cambiar foto de perfil"><Camera className="ic" aria-hidden="true" /></button>}
      </div>
      <div className="profile-name-row"><div className="profile-name"><h2>{profile.display_name}</h2><p>@{profile.username}</p></div><span className="profile-style"><Icon className="ic" aria-hidden="true" />{style.label}</span></div>
      {profile.bio?.trim() ? <p className="profile-bio">{profile.bio}</p> : own ? <p className="profile-bio profile-bio--empty">Una bici, muchas historias. Cuenta la tuya.</p> : null}
      {photoBusy && <p className="help" role="status">Preparando tu foto…</p>}
      {children && <div className="profile-actions">{children}</div>}
    </div>
    <div className="profile-signoff"><Icon className="ic" aria-hidden="true" /><span>{style.line}</span><span className="profile-signoff-mark" aria-hidden="true">↗</span></div>
  </section>;
}
