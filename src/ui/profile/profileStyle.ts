import type { RidingStyle } from '../../social/journal';
import { Compass, Mountain, Route, Users } from '../icons';
export const RIDING_STYLES = {
  explorar: { label: 'Explorar', line: 'Siempre queda un desvío por descubrir.', icon: Compass },
  subir: { label: 'Subir', line: 'La mejor vista se gana pedalada a pedalada.', icon: Mountain },
  fondo: { label: 'Fondo', line: 'Lejos, a mi ritmo.', icon: Route },
  grupo: { label: 'Grupeta', line: 'Los kilómetros saben mejor en compañía.', icon: Users },
} satisfies Record<RidingStyle, { label: string; line: string; icon: typeof Compass }>;
export const ridingStyle = (value: string | undefined): RidingStyle => value && value in RIDING_STYLES ? value as RidingStyle : 'explorar';
