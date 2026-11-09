/** Forma del trazo B Trazado: de abajo (salida) arriba (destino). La comparten la marca y la bienvenida. */
export const BRAND_ROAD = 'M10 54C16 42 48 50 48 36C48 23 16 35 16 22C16 12 44 18 53 9';
export const BRAND_DESTINATION = { cx: 53, cy: 9 } as const;

/** Trazado: carretera ascendente y destino. La forma es común a toda la aplicación. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className ? `brand-mark ${className}` : 'brand-mark'} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <path className="brand-mark-relief" d={BRAND_ROAD} transform="translate(0 3)" strokeWidth="8" strokeLinecap="round" />
      <path className="brand-mark-road" d={BRAND_ROAD} pathLength={1} strokeWidth="7" strokeLinecap="round" />
      <circle className="brand-mark-destination" cx={BRAND_DESTINATION.cx} cy={BRAND_DESTINATION.cy} r="5" strokeWidth="2.5" />
    </svg>
  );
}
