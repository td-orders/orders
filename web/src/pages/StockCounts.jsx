import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, isOps } from '../auth.jsx';
import { useApi, Field, Loading, Empty, Badge, ErrorBox, Card } from '../components/ui.jsx';
import { itDateTime, monthLabel, currentMonth, KIND } from '../format.js';
import { PhaseBanner } from '../components/phase.jsx';

// Giacenze mensili: la struttura apre quella del mese (sedi entro il 15, laboratorio entro il 30); l'Area Operations vede tutte
export default function StockCounts() {
  const { user } = useAuth();
  const ops = isOps(user);
  const nav = useNavigate();
  const [sid, setSid] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [err, setErr] = useState(null);
  const strutture = useApi(ops ? '/strutture' : null);
  const { data, reload } = useApi(`/stock/counts${qs({ struttura_id: sid || undefined })}`, [sid]);
  const dash = useApi(ops ? '/stats/dashboard' : null);
  const open = async () => {
    setErr(null);
    try { const r = await api.post(`/stock/counts/open${qs({ struttura_id: sid || undefined })}`, { month }); nav(`/giacenze/${r.id}`); } catch (e) { setErr(e); }
  };
  const canOpen = !ops || sid;
  return (
    <div className="page">
      {!ops && <PhaseBanner n="7" title="Giacenza reale del mese" desc={`Entro il giorno ${user.stock_deadline_day} di ogni mese inserisci la giacenza reale, confrontata con quella teorica. Alla conferma il sistema genera l'ordine del mese e il flusso riparte.`} next="Fase 1: ordine del mese" />}
      <div className="page-head">
        <div><h1>{ops ? 'Giacenze mensili delle strutture' : 'Giacenza mensile'}</h1><div className="sub">{ops ? 'Inserimento della giacenza entro il 15 (sedi) e il 30 (laboratorio); dalla conferma nasce l\'ordine del mese' : `Da inserire e confermare entro il giorno ${user.stock_deadline_day} di ogni mese: dalla conferma il sistema genera l'ordine`}</div></div>
        <div className="row">
          {ops && <Field label="Struttura"><select value={sid} onChange={(e) => setSid(e.target.value)} style={{ minWidth: 240 }}><option value="">Tutte</option>{(strutture.data || []).filter((s) => s.kind !== 'CLIENTE').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          <Field label="Mese"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
          <button className="btn" disabled={!canOpen} onClick={open}>Apri la giacenza del mese</button>
        </div>
      </div>
      <ErrorBox error={err} />
      {ops && dash.data?.pendingCounts?.length > 0 && (
        <div className="alert warn" style={{ marginBottom: 16 }}>Giacenza di {monthLabel(dash.data.month)} non ancora confermata: {dash.data.pendingCounts.map((p) => `${p.name} (entro il ${p.stock_deadline_day}${p.count_status === 'BOZZA' ? ', bozza aperta' : ''})`).join(', ')}.</div>
      )}
      <Card flush>
        {!data ? <Loading /> : !data.length ? <Empty>Nessuna giacenza registrata</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Mese</th>{ops && <th>Struttura</th>}<th>Stato</th><th className="num">Articoli con differenze</th><th>Confermata</th><th>Ordine generato</th></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`/giacenze/${c.id}`)}>
                <td className="strong">{monthLabel(c.month)}</td>
                {ops && <td>{c.struttura_name}<div className="small muted">{KIND[c.kind]}</div></td>}
                <td>{c.status === 'CONFERMATO' ? <Badge tone="green">Confermata</Badge> : <Badge tone="mauve">Bozza</Badge>}</td>
                <td className="num">{c.differences}</td>
                <td className="small muted">{c.confirmed_at ? `${itDateTime(c.confirmed_at)} · ${c.confirmed_by_name}` : '–'}</td>
                <td className="mono small">{c.order_number || '–'}{c.order_status && <span className="muted"> · {c.order_status}</span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
