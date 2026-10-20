import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, Loading, ErrorBox, Card, Badge, Modal, useToast } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { monthLabel, itDateTime, KIND } from '../format.js';
import { iconFor } from './OrderDetail.jsx';

// Giacenza del mese: colonna 1 ultimo ordine (immodificabile), colonna 2 giacenza da scarichi (immodificabile), colonna 3 giacenza effettiva (numeri)
export default function StockCount() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: c, reload } = useApi(`/stock/counts/${id}`);
  const [vals, setVals] = useState({});
  const [err, setErr] = useState(null);
  const [ask, setAsk] = useState(false);
  const [onlyMoved, setOnlyMoved] = useState(false);
  useEffect(() => { if (c) setVals(Object.fromEntries(c.lines.map((l) => [l.article_id, l.counted_qty]))); }, [c]);
  if (!c) return <div className="page"><Loading /></div>;
  const locked = c.status === 'CONFERMATO';
  const lines = c.lines.filter((l) => !onlyMoved || l.last_order_qty || l.system_qty || Number(vals[l.article_id] || 0));
  const diffs = c.lines.filter((l) => Number(vals[l.article_id] ?? l.counted_qty) !== l.system_qty).length;
  const save = async () => {
    setErr(null);
    try { await api.put(`/stock/counts/${c.id}`, { lines: Object.entries(vals).map(([a, q]) => ({ article_id: Number(a), counted_qty: Number(q) || 0 })) }); toast('Giacenza salvata'); reload(); return true; } catch (e) { setErr(e); return false; }
  };
  const confirm = async () => {
    if (!(await save())) return;
    try { const r = await api.post(`/stock/counts/${c.id}/confirm`); toast(c.kind === 'SEDE' ? `Giacenza confermata: ordine ${r.number} generato con ${r.proposed} confezioni proposte` : `Giacenza confermata: aperta la bozza ${r.number} per l'Area Operations`); nav(`/ordini/${r.orderId}`); } catch (e) { setErr(e); setAsk(false); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="row"><h1>Giacenza di {monthLabel(c.month)}</h1>{locked ? <Badge tone="green">Confermata</Badge> : <Badge tone="mauve">Bozza</Badge>}</div>
          <div className="sub">{c.struttura_name} · {KIND[c.kind]}{locked ? ` · confermata il ${itDateTime(c.confirmed_at)} da ${c.confirmed_by_name}` : ' · inserisci la quantità effettivamente presente, in confezioni'}</div></div>
        <div className="row">
          <label className="f inline small"><input type="checkbox" checked={onlyMoved} onChange={(e) => setOnlyMoved(e.target.checked)} />Solo articoli movimentati</label>
          {c.order_id && <Link className="btn ghost" to={`/ordini/${c.order_id}`}>Ordine {c.order_number}</Link>}
          {!locked && <button className="btn ghost" onClick={save}>Salva</button>}
          {!locked && <button className="btn" onClick={() => setAsk(true)}>Conferma la giacenza</button>}
        </div>
      </div>
      <ErrorBox error={err} />
      {!locked && <div className="alert info" style={{ marginBottom: 14 }}>La terza colonna è precompilata con la giacenza calcolata dagli scarichi: correggi solo le quantità diverse da ciò che vedi in magazzino. Alla conferma le differenze vengono rettificate a sistema e {c.kind === 'SEDE' ? 'il sistema genera l\'ordine potenziale del mese con la formula (produzione mensile − giacenza) × 1,5, arrotondata per eccesso' : 'si apre la bozza d\'ordine che l\'Area Operations compila'}.</div>}
      <Card flush>
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Articolo</th><th className="num">Ultimo ordine</th><th className="num">Giacenza da scarichi</th><th className="num">Giacenza effettiva</th><th className="num">Differenza</th></tr></thead>
          <tbody>{lines.map((l) => { const v = Number(vals[l.article_id] ?? l.counted_qty); const d = v - l.system_qty; return (
            <tr key={l.article_id} className={d !== 0 ? 'warnrow' : ''}>
              <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt icon={iconFor(l.category_code)} color={l.color} size={30} /><div><div className="strong">{l.article_name}</div><div className="small muted">{l.pack_label}</div></div></div></td>
              <td className="num muted">{l.last_order_qty}</td>
              <td className="num muted">{l.system_qty}</td>
              <td className="num">{locked ? <span className="strong">{l.counted_qty}</span> : <input className="qin" inputMode="numeric" value={vals[l.article_id] ?? ''} onChange={(e) => setVals({ ...vals, [l.article_id]: e.target.value.replace(/\D/g, '') })} />}</td>
              <td className="num">{d === 0 ? <span className="muted">–</span> : <Badge tone={d < 0 ? 'red' : 'mauve'}>{d > 0 ? '+' : ''}{d}</Badge>}</td>
            </tr>); })}</tbody>
        </table></div>
      </Card>
      {ask && (
        <Modal title="Confermare la giacenza del mese?" onClose={() => setAsk(false)} footer={<><button className="btn ghost" onClick={() => setAsk(false)}>Indietro</button><button className="btn" onClick={confirm}>Conferma</button></>}>
          <p>{diffs ? `${diffs} articoli con quantità diversa da quella calcolata: la giacenza a sistema viene rettificata.` : 'Nessuna differenza rispetto alla giacenza calcolata.'} Dopo la conferma la giacenza non è più modificabile e {c.kind === 'SEDE' ? 'l\'ordine potenziale va in verifica all\'Area Operations' : 'l\'Area Operations compila l\'ordine del laboratorio'}.</p>
        </Modal>
      )}
    </div>
  );
}
