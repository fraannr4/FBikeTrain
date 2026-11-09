import type { ReactNode } from 'react';

/**
 * La acción principal fija sobre la barra inferior, donde llega el pulgar («Exportar GPX»).
 * Con `narrow`, solo en el teléfono vertical: en ancho, cada tarjeta lleva su botón.
 */
export function Dock({ children, narrow, hidden }: { children: ReactNode; narrow?: boolean; hidden?: boolean }) {
  return (
    <div className={narrow ? 'dock dock--narrow' : 'dock'} hidden={hidden}>
      {children}
    </div>
  );
}
