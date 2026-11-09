import { useId } from 'react';

const BODY = 'M1.5 33V13A11.5 11.5 0 0 1 24.5 13V33Z';

/** Logotipo: hito kilométrico con la banda superior y la «F». Va en el menú y, en el móvil, en el hero. */
export function HitoLogo() {
  const clip = `hito-clip${useId().replace(/:/g, '')}`;
  return (
    <svg className="hito-logo" viewBox="0 0 26 34" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <path d={BODY} />
        </clipPath>
      </defs>
      <path className="body" d={BODY} />
      <rect className="band" x="0" y="0" width="26" height="11" clipPath={`url(#${clip})`} />
      <text x="13" y="28" textAnchor="middle">
        F
      </text>
    </svg>
  );
}
