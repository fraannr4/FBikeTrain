/** Trazado: carretera ascendente y destino. La forma es común a toda la aplicación. */
export function BrandMark() {
  const road = 'M10 54C16 42 48 50 48 36C48 23 16 35 16 22C16 12 44 18 53 9';
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <path className="brand-mark-relief" d={road} transform="translate(0 3)" strokeWidth="8" strokeLinecap="round" />
      <path className="brand-mark-road" d={road} strokeWidth="7" strokeLinecap="round" />
      <circle className="brand-mark-destination" cx="53" cy="9" r="5" strokeWidth="2.5" />
    </svg>
  );
}
