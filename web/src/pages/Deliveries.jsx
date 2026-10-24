import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, Loading, Empty, Card, Badge, Modal, Field, Icon, useToast, ErrorBox } from '../components/ui.jsx';
import { PhaseBanner } from '../components/phase.jsx';
import { itDateTime, KIND } from '../format.js';

// Fase 4 · Consegne: ordini spediti (da registrare come consegnati) e ordini consegnati alle strutture TD in attesa del carico interno
export default function Deliveries() {
  const nav = useNavigate();
  const toast = useToast();
  const { data, reload } = useApi('/orders?status=SPEDITO,CONSEGNATO,IMMAGAZZINATO');
  const [deliver, setDeliver] = useState(null);
  const [err, setErr] = useState(null);
  const shipped = (data || []).filter((o) => o.status === 'SPEDITO'); const delivered = (data || []).filter((o) => o.status === 'CONSEGNATO'); const stored = (data || []).filter((o) => o.status === 'IMMAGAZZINATO');
  const close = async (o) => { setErr(null); try { await api.post(`/orders/${o.id}/close`); toast('Processo concluso'); reload(); } catch (e) { setErr(e); } };
  return (
    <div className="page">
      <PhaseBanner n="4" title="Consegna" desc="Il magazzino consegna il materiale. Cliente Service: alla consegna il processo è concluso. Struttura TD: il processo continua con il carico nel magazzino interno (fase 5), che fa la struttura leggendo i codici a barre." next="Fase 5: carico nel magazzino interno (solo strutture TD)" />
      <div className="page-head"><div><h1>Consegne</h1><div className="sub">Stato delle spedizioni e dei carichi interni</div></div></div>
      <ErrorBox error={err} />
      <Card title={`Spediti, in consegna (${shipped.length})`} flush className="mb">
        {!data ? <Loading /> : !shipped.length ? <Empty>Nessuna spedizione in corso</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th>Destinazione</th><th className="num">Confezioni</th><th>DDT</th><th>Spedito</th><th /></tr></thead>
            <tbody>{shipped.map((o) => <tr key={o.id}><td><span className="mono strong" style={{ cursor: 'pointer' }} onClick={() => nav(`/ordini/${o.id}`)}>{o.number}</span><div className="small muted">{KIND[o.kind]}</div></td><td>{o.struttura_name}</td><td className="num">{o.packs_total}</td><td className="mono small">{o.ddt_number || '–'}</td><td className="small muted">{itDateTime(o.shipped_at)}</td><td className="num"><button className="btn sm" onClick={() => setDeliver(o)}>Consegnato</button></td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title={`Consegnati alle strutture TD, in attesa del carico interno (${delivered.length})`} flush className="mb">
        {!data ? <Loading /> : !delivered.length ? <Empty>Nessun carico in attesa</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th>Struttura</th><th className="num">Confezioni consegnate</th><th className="num">Caricate</th><th>Consegnato</th></tr></thead>
            <tbody>{delivered.map((o) => <tr key={o.id} className="click" onClick={() => nav(`/ordini/${o.id}`)}><td className="mono strong">{o.number}</td><td>{o.struttura_name}<div className="small muted">{KIND[o.kind]}</div></td><td className="num">{o.packs_delivered}</td><td className="num">{o.packs_received}/{o.packs_delivered}</td><td className="small muted">{itDateTime(o.delivered_at)}{Date.now() - new Date(o.delivered_at) > 5 * 86400000 && <> <Badge tone="red">in ritardo</Badge></>}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title={`Caricati, da concludere (${stored.length})`} flush>
        {!data ? <Loading /> : !stored.length ? <Empty>Nessun ordine da concludere</Empty> : (
          <div className="table-wrap"><table className="t"><thead><tr><th>Ordine</th><th>Struttura</th><th className="num">Caricate</th><th>Caricato il</th><th>Difformità</th><th /></tr></thead>
            <tbody>{stored.map((o) => <tr key={o.id}><td><span className="mono strong" style={{ cursor: 'pointer' }} onClick={() => nav(`/ordini/${o.id}`)}>{o.number}</span></td><td>{o.struttura_name}</td><td className="num">{o.packs_received}/{o.packs_delivered}</td><td className="small muted">{itDateTime(o.stored_at)}</td><td>{o.open_issues ? <Badge tone="red">{o.open_issues} aperte</Badge> : <span className="muted small">nessuna</span>}</td><td className="num"><button className="btn sm" disabled={o.open_issues > 0} title={o.open_issues ? 'Chiudi prima le difformità' : ''} onClick={() => close(o)}><Icon name="check" size={14} />Concludi</button></td></tr>)}</tbody></table></div>
        )}
      </Card>
      {deliver && <DeliverModal o={deliver} onClose={() => setDeliver(null)} onDone={() => { setDeliver(null); reload(); }} />}
    </div>
  );
}

// Registrazione manuale della consegna (quando il fornitore non chiama l'API): DDT e, facoltativi, lotti per articolo
function DeliverModal({ o, onClose, onDone }) {
  const toast = useToast();
  const det = useApi(`/orders/${o.id}`);
  const [ddt, setDdt] = useState(o.ddt_number || '');
  const [lots, setLots] = useState({});
  const [err, setErr] = useState(null);
  const lines = (det.data?.lines || []).filter((l) => (l.qty_approved || 0) > 0);
  const save = async () => {
    setErr(null);
    try {
      const body = { ddt, lines: lines.map((l) => ({ article_code: l.article_code, packs: Number(lots[l.id]?.packs ?? l.qty_approved), lot: lots[l.id]?.lot || null, expiry: lots[l.id]?.expiry || null })) };
      const r = await api.post(`/orders/${o.id}/delivered`, body);
      toast(r.status === 'CHIUSO' ? 'Consegnato al cliente Service: processo concluso' : 'Consegna registrata: la struttura deve caricare il materiale (fase 5)'); onDone();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title={`Consegna di ${o.number} a ${o.struttura_name}`} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Registra consegna</button></>}>
      <ErrorBox error={err} />
      <Field label="Numero DDT"><input value={ddt} onChange={(e) => setDdt(e.target.value)} style={{ maxWidth: 240 }} /></Field>
      <div className="small muted" style={{ margin: '10px 0' }}>Confezioni consegnate per articolo, con lotto e scadenza se noti: per ogni confezione nasce una riga da caricare in fase 5. Se il fornitore chiama l'API, questi dati arrivano da soli.</div>
      {!det.data ? <Loading /> : (
        <table className="t"><thead><tr><th>Articolo</th><th className="num">Approvate</th><th className="num">Consegnate</th><th>Lotto</th><th>Scadenza</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td>{l.article_name}<div className="small muted">{l.pack_label}</div></td><td className="num">{l.qty_approved}</td>
            <td className="num"><input className="qin" inputMode="numeric" value={lots[l.id]?.packs ?? l.qty_approved} onChange={(e) => setLots({ ...lots, [l.id]: { ...(lots[l.id] || {}), packs: e.target.value.replace(/\D/g, '') } })} /></td>
            <td><input placeholder="lotto" value={lots[l.id]?.lot || ''} onChange={(e) => setLots({ ...lots, [l.id]: { ...(lots[l.id] || {}), lot: e.target.value } })} style={{ width: 130 }} /></td>
            <td><input type="date" value={lots[l.id]?.expiry || ''} onChange={(e) => setLots({ ...lots, [l.id]: { ...(lots[l.id] || {}), expiry: e.target.value } })} style={{ width: 160 }} /></td></tr>)}</tbody></table>
      )}
    </Modal>
  );
}
