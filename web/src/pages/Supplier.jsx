import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, Loading, Empty, Card, Badge, StatusBadge, PromptModal, Icon, useToast, ErrorBox } from '../components/ui.jsx';
import { PhaseBanner } from '../components/phase.jsx';
import { itDateTime, KIND } from '../format.js';

// Fase 3 · Trasmissione al magazzino: ordini approvati che il fornitore legge dalle API ogni 5 minuti, presa in carico, spedizione
export default function Supplier() {
  const nav = useNavigate();
  const toast = useToast();
  const { data, reload } = useApi('/orders?status=APPROVATO,PRESO_IN_CARICO');
  const settings = useApi('/settings');
  const [ask, setAsk] = useState(null);
  const [err, setErr] = useState(null);
  const act = async (o, path, body, msg) => { setErr(null); try { const r = await api.post(`/orders/${o.id}/${path}`, body || {}); toast(msg || 'Fatto'); if (r.error) toast(r.error, 'err'); reload(); } catch (e) { setErr(e); } };
  const waiting = (data || []).filter((o) => o.status === 'APPROVATO'); const picked = (data || []).filter((o) => o.status === 'PRESO_IN_CARICO');
  const s = settings.data?.silva;
  const Row = ({ o }) => (
    <tr key={o.id}>
      <td><span className="mono strong" style={{ cursor: 'pointer' }} onClick={() => nav(`/ordini/${o.id}`)}>{o.number}</span>{o.urgent && <> <Badge tone="red">Urgente</Badge></>}<div className="small muted">{KIND[o.kind]}</div></td>
      <td>{o.struttura_name}<div className="small muted">{o.struttura_city}</div></td>
      <td className="num">{o.lines_count}</td><td className="num">{o.packs_total}</td>
      <td className="small muted">{itDateTime(o.approved_at)}</td>
      <td className="small">{o.polled_at ? <>letto dal fornitore<div className="muted">{itDateTime(o.polled_at)}</div></> : <Badge tone="mauve">non ancora letto</Badge>}{o.silva_reference && <div className="mono small">rif. {o.silva_reference}</div>}</td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>
        {o.status === 'APPROVATO' && <><button className="btn sm ghost" onClick={() => setAsk({ o, kind: 'picked' })}>Preso in carico</button>{' '}<button className="btn sm ghost" title="Invia il PDF alla casella ordini del fornitore" onClick={() => act(o, 'email-supplier', {}, 'Email inviata al magazzino')}><Icon name="mail" size={14} /></button>{' '}</>}
        <button className="btn sm" onClick={() => setAsk({ o, kind: 'shipped' })}>Spedito</button>
      </td>
    </tr>
  );
  return (
    <div className="page">
      <PhaseBanner n="3" title="Trasmissione al magazzino (Silva Group)" desc="Gli ordini approvati sono esposti sulle API che il fornitore interroga ogni 5 minuti: contenuto, sede di consegna, urgenza. Il fornitore comunica presa in carico, spedizione e consegna dalle stesse API; qui si registrano a mano se non lo fa." next="Fase 4: consegna alla struttura" />
      <div className="page-head">
        <div><h1>Ordini al magazzino</h1><div className="sub">{s ? (s.inboundConfigured ? `Chiave API del fornitore attiva · ultima lettura degli ordini: ${s.last_poll_at ? itDateTime(s.last_poll_at) : 'mai'}` : 'Chiave API del fornitore non impostata (SILVA_INBOUND_KEY): gli ordini non sono leggibili dal fornitore') : ''}</div></div>
        <div className="row"><a className="btn ghost" href="/api/stats/export/orders.xlsx"><Icon name="download" size={16} />Excel</a></div>
      </div>
      <ErrorBox error={err} />
      <Card title={`In attesa del magazzino (${waiting.length})`} flush className="mb">
        {!data ? <Loading /> : !waiting.length ? <Empty>Nessun ordine in attesa</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th>Destinazione</th><th className="num">Articoli</th><th className="num">Confezioni</th><th>Approvato</th><th>Fornitore</th><th /></tr></thead><tbody>{waiting.map((o) => <Row key={o.id} o={o} />)}</tbody></table></div>
        )}
      </Card>
      <Card title={`In preparazione presso il magazzino (${picked.length})`} flush>
        {!data ? <Loading /> : !picked.length ? <Empty>Nessun ordine in preparazione</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th>Destinazione</th><th className="num">Articoli</th><th className="num">Confezioni</th><th>Approvato</th><th>Fornitore</th><th /></tr></thead><tbody>{picked.map((o) => <Row key={o.id} o={o} />)}</tbody></table></div>
        )}
      </Card>
      <div className="small muted mt">Contratto API per il fornitore: GET /api/integrations/silva/orders (ordini da preparare), POST …/orders/&lt;numero&gt;/presa-in-carico, …/spedito, …/consegnato con DDT, righe, lotti e codici a barre. Dettagli nel README.</div>
      {ask && ask.kind === 'picked' && <PromptModal title={`Presa in carico di ${ask.o.number}`} label="Riferimento del fornitore (facoltativo)" minLength={0} confirmText="Registra" onClose={() => setAsk(null)} onConfirm={async (reference) => { await act(ask.o, 'picked', { reference }, 'Presa in carico registrata'); }} />}
      {ask && ask.kind === 'shipped' && <PromptModal title={`Spedizione di ${ask.o.number}`} label="Numero DDT (facoltativo)" minLength={0} confirmText="Registra spedizione" onClose={() => setAsk(null)} onConfirm={async (ddt) => { await act(ask.o, 'shipped', { ddt }, 'Spedizione registrata: l\'ordine passa alla fase 4'); }} />}
    </div>
  );
}
