import React from 'react';

// Intestazione di fase: numero, titolo, cosa succede qui e qual è il passo successivo
export function PhaseBanner({ n, title, desc, next }) {
  return (
    <div className="phase-banner">
      <div className="num">{n}</div>
      <div><div className="t">{title}</div><div className="d">{desc}</div></div>
      {next && <div className="next">Passo successivo<br /><b style={{ color: '#fff' }}>{next}</b></div>}
    </div>
  );
}
