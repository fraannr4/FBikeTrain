import type { ReactNode } from 'react';
import type { Difficulty } from '../../metrics/reference';
import { Check, type LucideIcon } from '../icons';

/** «Suave», «Media» o «Dura»: los mismos valores que `Difficulty` de las métricas. */
export type DifficultyLevel = Difficulty;

type ChipTone = 'easy' | 'mid' | 'hard' | 'new' | 'ia' | 'done';

type ChipProps = { tone?: ChipTone; icon?: LucideIcon; children: ReactNode; className?: string };

/** Etiqueta informativa (no se pulsa). 28 px de alto. */
export function Chip({ tone, icon: Icon, children, className }: ChipProps) {
  const cls = ['chip', tone ? `chip--${tone}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      {Icon ? <Icon className="ic" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const LEVEL: Record<DifficultyLevel, { n: 1 | 2 | 3; tone: 'easy' | 'mid' | 'hard' }> = {
  Suave: { n: 1, tone: 'easy' },
  Media: { n: 2, tone: 'mid' },
  Dura: { n: 3, tone: 'hard' },
};

/** Tres barras crecientes con 1, 2 o 3 llenas. Decorativas: el texto dice la dificultad. */
export function DifficultyBars({ level }: { level: DifficultyLevel }) {
  const n = LEVEL[level].n;
  return (
    <svg className="ic bars" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <rect x="1" y="7" width="2.4" height="4" rx=".6" fill="currentColor" stroke="none" />
      <rect x="4.8" y="4" width="2.4" height="7" rx=".6" fill="currentColor" stroke="none" opacity={n >= 2 ? 1 : 0.3} />
      <rect x="8.6" y="1" width="2.4" height="10" rx=".6" fill="currentColor" stroke="none" opacity={n >= 3 ? 1 : 0.3} />
    </svg>
  );
}

/**
 * Dificultad para ti en pastilla: barras y texto, nunca solo color. «Suave para ti», «Media para ti»,
 * «Dura para ti»; con `short`, solo «Suave».
 */
export function DifficultyChip({ level, short = false }: { level: DifficultyLevel; short?: boolean }) {
  return (
    <span className={`chip chip--${LEVEL[level].tone}`}>
      <DifficultyBars level={level} />
      {short ? level : `${level} para ti`}
    </span>
  );
}

/** La dificultad como texto con barras, sin pastilla: para filas compactas. */
export function DifficultyText({ level, short = false }: { level: DifficultyLevel; short?: boolean }) {
  return (
    <span className={`dif dif--${LEVEL[level].tone}`}>
      <DifficultyBars level={level} />
      {short ? level : `${level} para ti`}
    </span>
  );
}

type FilterChipProps = { pressed: boolean; onClick: () => void; children: ReactNode };

/** Filtro que se activa o desactiva. La pastilla mide 36 px, pero el toque, 44. */
export function FilterChip({ pressed, onClick, children }: FilterChipProps) {
  return (
    <button type="button" className="fchip" aria-pressed={pressed} onClick={onClick}>
      <span>
        <Check className="ic ic-check" aria-hidden="true" />
        {children}
      </span>
    </button>
  );
}
