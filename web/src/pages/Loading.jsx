import React, { useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, Loading, Empty, Card, Badge, PromptModal, Icon, useToast, ErrorBox } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { ScanButton } from '../components/scan.jsx';
import { PhaseBanner } from '../components/phase.jsx';
import { itDate, itDateTime, PKG_STATUS } from '../format.js';
import { iconFor } from './OrderDetail.jsx';

// Fase 5 · Carico nel magazzino interno (strutture TD): si leggono i codici a barre di tutte le confezioni consegnate
export default function LoadingPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, reload } = useApi('/orders?status=CONSEGNATO');
  return (
    <div className="page">
      <PhaseBanner n="5" title="Carico nel magazzino interno" desc="Per ogni ordine consegnato, leggi il codice a barre di ogni confezione (o spuntala): entra in giacenza con lotto e scadenza. Alla conferma le confezioni non lette vengono segnalate come mancanti all'Area Operations." next="Fase 6: scarico ad ogni utilizzo" />
      {id ? <LoadOrder id={id} onDone={() => { reload(); nav('/carico'); }} /> : (
        <Card title="Consegne da caricare" flush>
          {!data ? <Loading /> : !data.length ? <Empty>Nessuna consegna in attesa di carico</Empty> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th className="num">Confezioni</th><th className="num">Già lette</th><th>DDT</th><th>Consegnato</th><th /></tr></thead>
              <tbody>{data.map((o) => <tr key={o.id} className="click" onClick={() => nav(`/carico/${o.id}`)}><td className="mono strong">{o.number}</td><td className="num">{o.packs_delivered}</td><td className="num">{o.packs_received}</td><td className="mono small">{o.ddt_number || '–'}</td><td className="small muted">{itDateTime(o.delivered_at)}</td><td className="num"><button className="btn sm"><Icon name="barcode" size={14} />Carica</button></td></tr>)}</tbody></table></div>
          )}
        </Card>
      )}
    </div>
  );
}

function LoadOrder({ id, onDone }) {
  const toast = useToast();
  const { data: o, reload } = useApi(`/orders/${id}`);
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState({});
  const [confirm, setConfirm] = useState(false);
  const inputRef = useRef(null);
  const groups = useMemo(() => { const g = new Map(); for (const p of o?.packages || []) g.set(p.article_id, [...(g.get(p.article_id) || []), p]); return [...g.values()]; }, [o]);
  if (!o) return <Loading />;
  if (o.status !== 'CONSEGNATO') return <div className="alert info">Ordine {o.number}: {o.status === 'IMMAGAZZINATO' ? 'carico già completato.' : 'non è in attesa di carico.'}</div>;
  const received = o.packages.filter((p) => p.status === 'RICEVUTO').length;
  const scan = async (c) => {
    const v = (c || code).trim(); if (!v) return;
    setErr(null);
    try { const r = await api.post(`/orders/${o.id}/load-scan`, { code: v }); toast(`${o.packages.find((p) => p.id === r.id)?.article_name || 'Confezione'} caricata${r.lot ? ` · lotto ${r.lot}` : ''}`); setCode(''); reload(); inputRef.current?.focus(); } catch (e) { setErr(e); setCode(''); inputRef.current?.focus(); }
  };
  const toggle = async (p, on) => { setErr(null); try { await api.post(`/orders/${o.id}/load`, { packages: [{ id: p.id, received: on, lot: draft[p.id]?.lot, expiry: draft[p.id]?.expiry }] }); reload(); } catch (e) { setErr(e); } };
  const all = async () => { setErr(null); try { await api.post(`/orders/${o.id}/load`, { all: true }); toast('Tutte le confezioni spuntate'); reload(); } catch (e) { setErr(e); } };
  const saveLots = async () => { const packages = Object.entries(draft).map(([pid, d]) => ({ id: Number(pid), received: true, lot: d.lot, expiry: d.expiry })); if (!packages.length) return; try { await api.post(`/orders/${o.id}/load`, { packages }); toast('Lotti salvati'); setDraft({}); reload(); } catch (e) { setErr(e); } };
  return (
    <>
      <div className="page-head"><div><h1>Carico ordine {o.number}</h1><div className="sub">{o.ddt_number ? `DDT ${o.ddt_number} · ` : ''}consegnato il {itDateTime(o.delivered_at)} · {o.packages.length} confezioni</div></div><Badge tone={received === o.packages.length ? 'green' : 'blue'}>{received} / {o.packages.length} caricate</Badge></div>
      <ErrorBox error={err} />
      <div className="scanbox mb">
        <form className="row" onSubmit={(e) => { e.preventDefault(); scan(); }}>
          <input ref={inputRef} className="mono" placeholder="Leggi il codice a barre della confezione e premi Invio" value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1, minWidth: 280 }} autoFocus />
          <button className="btn lg"><Icon name="barcode" size={18} />Carica</button>
          <ScanButton onCode={scan} />
          <button type="button" className="btn ghost lg" onClick={all} disabled={received === o.packages.length}><Icon name="check" size={16} />Seleziona tutto</button>
          <button type="button" className="btn ghost lg" onClick={saveLots} disabled={!Object.keys(draft).length}>Salva lotti</button>
          <button type="button" className="btn dark lg" onClick={() => setConfirm(true)} disabled={!received}>Conferma carico</button>
        </form>
        <div className="small muted" style={{ marginTop: 8 }}>Il codice può essere quello della singola confezione (se il fornitore lo ha comunicato), il GTIN del produttore (anche GS1-128 con lotto e scadenza) o il codice articolo. Lotto e scadenza si possono anche scrivere a mano.</div>
      </div>
      <Card flush>
        <div className="table-wrap"><table className="t">
          <thead><tr><th style={{ width: 34 }} /><th>Articolo</th><th>#</th><th>Lotto</th><th>Scadenza</th><th>Codice</th><th>Stato</th></tr></thead>
          <tbody>{groups.map((g) => g.map((p, i) => (
            <tr key={p.id} className={p.status === 'RICEVUTO' ? 'rx' : ''}>
              <td><input type="checkbox" checked={p.status === 'RICEVUTO'} onChange={(e) => toggle(p, e.target.checked)} /></td>
              <td>{i === 0 ? <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt icon={iconFor(p.article_code)} color={p.color} size={30} /><div><div className="strong">{p.article_name}</div><div className="small muted">{p.pack_label} · {g.length} confezioni</div></div></div> : <span className="muted small">idem</span>}</td>
              <td className="muted">{p.seq}</td>
              <td><input placeholder="lotto" value={draft[p.id]?.lot ?? p.lot ?? ''} onChange={(e) => setDraft({ ...draft, [p.id]: { ...(draft[p.id] || {}), lot: e.target.value } })} style={{ minHeight: 30, padding: '3px 8px', width: 120 }} /></td>
              <td><input type="date" value={draft[p.id]?.expiry ?? p.expiry ?? ''} onChange={(e) => setDraft({ ...draft, [p.id]: { ...(draft[p.id] || {}), expiry: e.target.value } })} style={{ minHeight: 30, padding: '3px 8px', width: 150 }} /></td>
              <td className="mono small">{p.barcode}</td>
              <td><Badge tone={PKG_STATUS[p.status]?.tone}>{PKG_STATUS[p.status]?.label}</Badge></td>
            </tr>)))}</tbody>
        </table></div>
      </Card>
      {confirm && <PromptModal title="Confermare il carico?" label={`${received} confezioni caricate su ${o.packages.length}. ${o.packages.length - received ? `Le ${o.packages.length - received} non lette saranno segnalate come non ricevute.` : 'Tutto il materiale entra in giacenza.'} Note (facoltative)`} minLength={0} confirmText="Conferma carico" onClose={() => setConfirm(false)} onConfirm={async (note) => { const r = await api.post(`/orders/${o.id}/load-confirm`, { note }); toast(r.missing ? `Carico confermato con ${r.missing} confezioni mancanti` : 'Materiale caricato in giacenza'); onDone(); }} />}
    </>
  );
}

export { itDate };
