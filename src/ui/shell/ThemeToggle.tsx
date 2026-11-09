import { SegmentedControl } from '../components/SegmentedControl';
import { Moon, Sun } from '../icons';
import { setTheme, useTheme, type Theme } from '../theme/theme';

const OPTIONS: { value: Theme; label: string; icon: typeof Moon }[] = [
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'light', label: 'Claro', icon: Sun },
];

/** Tema oscuro o claro. Mismo control en el menú, en la hoja «Más» y en Ajustes. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  return <SegmentedControl label="Tema" options={OPTIONS} value={theme} onChange={setTheme} className={className} />;
}
