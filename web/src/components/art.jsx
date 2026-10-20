import React from 'react';

// Grafica dell'oggetto per il catalogo: un disegno vettoriale per categoria, colorato con il colore dell'articolo
// (tappo della provetta, Transbag, kit...). Niente immagini esterne: tutto inline e leggero.
const Tube = (c) => <>
  <rect x="26" y="14" width="28" height="12" rx="3" fill={c} stroke="#01212C" strokeWidth="1.2" />
  <path d="M30 26h20v34a10 10 0 0 1-20 0z" fill="#fff" stroke="#01212C" strokeWidth="1.2" />
  <path d="M33 40h14v20a7 7 0 0 1-14 0z" fill={c} opacity=".28" />
  <rect x="34" y="31" width="10" height="2" rx="1" fill="#01212C" opacity=".25" />
</>;
const Needle = (c) => <>
  <path d="M20 44 L44 20" stroke="#8a949a" strokeWidth="2.4" strokeLinecap="round" />
  <path d="M44 20l10-10" stroke="#5B6B70" strokeWidth="1.4" strokeLinecap="round" />
  <path d="M26 56l-10 2 2-10 6-6 8 8z" fill={c} stroke="#01212C" strokeWidth="1.2" />
  <path d="M36 46l8-8 6 4-10 10z" fill="#fff" stroke="#01212C" strokeWidth="1.2" />
  <path d="M26 62c6-2 10 2 16 0" stroke={c} strokeWidth="2" fill="none" strokeLinecap="round" />
</>;
const Jar = (c) => <>
  <rect x="22" y="16" width="36" height="12" rx="3" fill={c} stroke="#01212C" strokeWidth="1.2" />
  <path d="M25 28h30v30a4 4 0 0 1-4 4H29a4 4 0 0 1-4-4z" fill="#fff" stroke="#01212C" strokeWidth="1.2" />
  <rect x="30" y="38" width="20" height="14" rx="2" fill={c} opacity=".25" />
  <path d="M31 22h18" stroke="#fff" strokeWidth="1.5" opacity=".7" />
</>;
const Swab = (c) => <>
  <rect x="24" y="12" width="32" height="54" rx="6" fill="#fff" stroke="#01212C" strokeWidth="1.2" />
  <rect x="31" y="12" width="18" height="10" rx="3" fill={c} stroke="#01212C" strokeWidth="1.2" />
  <path d="M40 22v34" stroke="#8a949a" strokeWidth="1.6" />
  <ellipse cx="40" cy="58" rx="4" ry="5" fill={c} opacity=".8" />
</>;
const Bag = (c) => <>
  <path d="M20 16h40v48a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4z" fill={c} opacity=".9" stroke="#01212C" strokeWidth="1.2" />
  <rect x="20" y="16" width="40" height="8" fill="#01212C" opacity=".25" />
  <rect x="27" y="32" width="26" height="20" rx="2" fill="#fff" opacity=".85" />
  <path d="M31 38h18M31 43h12" stroke="#01212C" strokeWidth="1.3" opacity=".5" />
</>;
const Kit = (c) => <>
  <path d="M16 28l24-10 24 10v26L40 64 16 54z" fill="#fff" stroke="#01212C" strokeWidth="1.2" />
  <path d="M16 28l24 10 24-10M40 38v26" stroke="#01212C" strokeWidth="1.2" fill="none" />
  <path d="M16 28l24 10v26L16 54z" fill={c} opacity=".35" />
  <path d="M28 23l24 10" stroke={c} strokeWidth="3" />
</>;
const Slide = (c) => <>
  <rect x="14" y="26" width="52" height="28" rx="2" fill="#eaf3f6" stroke="#01212C" strokeWidth="1.2" />
  <rect x="14" y="26" width="14" height="28" fill={c} opacity=".7" />
  <circle cx="44" cy="40" r="6" fill={c} opacity=".35" />
</>;
const Bottle = (c) => <>
  <rect x="33" y="12" width="14" height="8" rx="2" fill="#01212C" opacity=".6" />
  <path d="M30 20h20v8c4 3 6 7 6 12v22a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4V40c0-5 2-9 6-12z" fill="#fff" stroke="#01212C" strokeWidth="1.2" />
  <rect x="28" y="44" width="24" height="16" fill={c} opacity=".5" />
  <rect x="30" y="36" width="20" height="6" rx="1" fill="#fff" stroke="#01212C" strokeWidth=".8" />
</>;
const Doc = (c) => <>
  <path d="M22 12h26l12 12v42a2 2 0 0 1-2 2H22a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2z" fill="#fff" stroke="#01212C" strokeWidth="1.2" />
  <path d="M48 12v12h12" fill={c} stroke="#01212C" strokeWidth="1.2" />
  <path d="M28 34h24M28 42h24M28 50h16" stroke={c === '#FFFAE3' ? '#1C505E' : c} strokeWidth="2.2" strokeLinecap="round" />
</>;
const ART = { tube: Tube, needle: Needle, jar: Jar, swab: Swab, bag: Bag, kit: Kit, slide: Slide, bottle: Bottle, doc: Doc };

export function ProductArt({ icon = 'kit', color = '#71B1BD', size = 72, className = '' }) {
  const draw = ART[icon] || Kit;
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} className={`art ${className}`} aria-hidden="true">
      <rect x="4" y="4" width="72" height="72" rx="16" fill="#f3f6f6" />
      {draw(color || '#71B1BD')}
    </svg>
  );
}
