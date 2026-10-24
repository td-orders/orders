import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useApi, Loading, Empty, Card, Icon, useToast, ErrorBox, Modal, Field } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { ScanButton } from '../components/scan.jsx';
import { PhaseBanner } from '../components/phase.jsx';
import { itDate, itDateTime } from '../format.js';

// Fase 6 · Scarico: ad ogni utilizzo si legge il codice a barre della confezione prelevata; la giacenza scende
export default function Unload() {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const [last, setLast] = useState(null);
  const [pick, setPick] = useState(false);
  const log = useApi('/stock/unloads');
  const stock = useApi('/stock');
  const inputRef = useRef(null);
  const use = async (body, label) => {
    setErr(null);
    try { const r = await api.post('/stock/use', body); const u = r.used[0]; setLast({ ...u, label: label || stock.data?.rows.find((x) => x.article_id === u.article_id)?.article_name, remaining: r.remaining }); toast(`Scaricata: restano ${r.remaining} confezioni`); setCode(''); log.reload(); stock.reload(); inputRef.current?.focus(); } catch (e) { setErr(e); setCode(''); inputRef.current?.focus(); }
  };
  const undo = async (id) => { setErr(null); try { await api.post('/stock/unuse', { package_id: id }); toast('Scarico annullato'); log.reload(); stock.reload(); } catch (e) { setErr(e); } };
  return (
    <div className="page">
      <PhaseBanner n="6" title="Scarico del materiale" desc="Ogni volta che prelevi una confezione dal magazzino interno per metterla in uso, leggi il suo codice a barre: esce dalla giacenza, che resta sempre aggiornata. Esce prima la confezione con la scadenza più vicina." next="Fase 7: giacenza reale entro il 15 del mese" />
      <div className="scanbox mb">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) use({ code: code.trim() }); }}>
          <input ref={inputRef} className="mono" placeholder="Leggi il codice a barre della confezione prelevata" value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1, minWidth: 280 }} autoFocus />
          <button className="btn lg"><Icon name="barcode" size={18} />Scarica</button>
          <ScanButton onCode={(c) => use({ code: c })} />
          <button type="button" className="btn ghost lg" onClick={() => setPick(true)}>Senza codice: scegli l'articolo</button>
        </form>
        {last && <div className="alert ok" style={{ marginTop: 12 }}><Icon name="check" size={18} /><div><b>{last.label}</b> scaricata{last.lot ? `, lotto ${last.lot}` : ''}{last.expiry ? `, scadenza ${itDate(last.expiry)}` : ''}. Restano {last.remaining} confezioni in giacenza.</div></div>}
      </div>
      <ErrorBox error={err} />
      <Card title="Scarichi degli ultimi 7 giorni" flush>
        {!log.data ? <Loading /> : !log.data.length ? <Empty>Nessuno scarico registrato</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Quando</th><th>Articolo</th><th>Lotto</th><th>Scadenza</th><th className="num">Restano</th><th>Chi</th><th /></tr></thead>
            <tbody>{log.data.map((p) => <tr key={p.id}><td className="small muted">{itDateTime(p.used_at)}</td><td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt color={p.color} size={26} /><div>{p.article_name}<div className="small muted">{p.pack_label}</div></div></div></td><td className="mono small">{p.lot || '–'}</td><td className="small">{itDate(p.expiry) || '–'}</td><td className="num">{p.remaining}</td><td className="small">{p.used_by_name}</td><td className="num">{Date.now() - new Date(p.used_at) < 86400000 && <button className="btn sm ghost" onClick={() => undo(p.id)}>Annulla</button>}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      {pick && (
        <Modal title="Scarico senza lettura del codice" onClose={() => setPick(false)}>
          <div className="small muted" style={{ marginBottom: 10 }}>Scegli l'articolo: esce la confezione con la scadenza più vicina.</div>
          {!stock.data ? <Loading /> : (
            <table className="t"><tbody>{stock.data.rows.filter((r) => r.packs > 0).map((r) => <tr key={r.article_id}><td>{r.article_name}<div className="small muted">{r.pack_label}</div></td><td className="num">{r.packs} in giacenza</td><td className="num"><button className="btn sm" onClick={() => { setPick(false); use({ article_id: r.article_id }, r.article_name); }}>Scarica 1</button></td></tr>)}</tbody></table>
          )}
        </Modal>
      )}
    </div>
  );
}

export { Field };
