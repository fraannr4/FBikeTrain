import type { Challenge, ChallengeStatus } from '../../social/challenges';

/** Estado del reto como lo lee el usuario. `expired` lo calcula el servidor a partir del plazo. */
export const STATUS_LABEL: Record<ChallengeStatus, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  declined: 'Rechazado',
  finished: 'Terminado',
  expired: 'Caducado',
};

const DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' });

/** «1 de diciembre», en Madrid. */
export const formatDay = (iso: string | number) => DAY.format(new Date(iso));

/** «Retas a Ana» o «Te reta Ana». */
export const rivalLine = (c: Challenge) => (c.iAmChallenger ? `Retas a ${c.rival.display_name}` : `Te reta ${c.rival.display_name}`);

/** Solo los retos abiertos tienen un plazo que mirar. */
export const isOpen = (c: Challenge) => c.status === 'pending' || c.status === 'accepted';
