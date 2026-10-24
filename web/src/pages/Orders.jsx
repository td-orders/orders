import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, isOps } from '../auth.jsx';
import { useApi, Field, Loading, Empty, StatusBadge, Badge, Icon } from '../components/ui.jsx';
import { qs } from '../api.js';
import { itDateTime, KIND, ORIGIN, STATUS } from '../format.js';
import { PhaseBanner } from '../components/phase.jsx';

export default function Orders({ verify = false }) {
  const { user } = useAuth();
  const ops = isOps(user);
  const nav = useNavigate();
  const [f, setF] = useState({ status: verify ? 'INVIATO' : '', kind: '', struttura_id: '' });
  const strutture = useApi(ops ? '/strutture' : null);
  const { data } = useApi(`/orders${qs(verify ? { status: 'INVIATO,BOZZA' } : f)}`, [verify]);
  const rows = (data || []).filter((o) => !verify || o.status === 'INVIATO' || (o.status === 'BOZZA' && o.origin === 'OPERATIONS'));
  return (
    <div className="page">
      {verify && <PhaseBanner n="2" title="Verifica delle richieste" desc="Toscana Diagnostica riceve la richiesta e la lavora: le quantità sono confrontate con la produzione StudioLab della struttura (esami accettati, correlati ai materiali). L'Area Operations corregge ciò che è difforme e approva." next="Fase 3: trasmissione al magazzino" />}
      <div className="page-head">
        <div><h1>{verify ? 'Richieste da verificare' : ops ? 'Archivio ordini' : 'I miei ordini'}</h1><div className="sub">{verify ? 'Richieste inviate dalle strutture, ordini generati dalle giacenze e bozze del laboratorio da compilare' : 'Tutti gli ordini con stato e fase'}</div></div>
        <div className="row">
          <a className="btn ghost" href="/api/stats/export/orders.xlsx"><Icon name="download" size={16} />Excel</a>
          {(ops || user.struttura_kind === 'CLIENTE') && <button className="btn" onClick={() => nav('/catalogo')}><Icon name="cart" size={16} />Nuovo ordine</button>}
        </div>
      </div>
      {!verify && (
        <div className="filters">
          <Field label="Stato"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Tutti</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          {ops && <Field label="Tipo"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Tutti</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
          {ops && <Field label="Struttura"><select value={f.struttura_id} onChange={(e) => setF({ ...f, struttura_id: e.target.value })}><option value="">Tutte</option>{(strutture.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
        </div>
      )}
      <div className="card">
        {!data ? <Loading /> : !rows.length ? <Empty>{verify ? 'Nessun ordine in attesa di verifica' : 'Nessun ordine'}</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Ordine</th>{ops && <th>Struttura</th>}<th>Origine</th><th>Stato</th><th className="num">Articoli</th><th className="num">Confezioni</th><th className="num">Consegnate</th><th>Segnali</th><th>Aggiornato</th></tr></thead>
            <tbody>{rows.map((o) => (
              <tr key={o.id} className="click" onClick={() => nav(`/ordini/${o.id}`)}>
                <td><span className="mono strong">{o.number}</span>{o.urgent && <> <Badge tone="red">Urgente</Badge></>}</td>
                {ops && <td>{o.struttura_name}<div className="small muted">{KIND[o.kind]}</div></td>}
                <td className="small">{ORIGIN[o.origin]}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="num">{o.lines_count}</td><td className="num">{o.packs_total}</td>
                <td className="num">{['CONSEGNATO', 'IMMAGAZZINATO', 'CHIUSO'].includes(o.status) ? `${o.packs_delivered}` : '–'}</td>
                <td className="small">{o.anomalies > 0 && <Badge tone="mauve">{o.anomalies} scostamenti &gt;50%</Badge>} {o.open_issues > 0 && <Badge tone="red">{o.open_issues} difformità</Badge>}</td>
                <td className="small muted">{itDateTime(o.updated_at)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
