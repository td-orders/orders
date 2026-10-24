import React, { useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, isOps } from '../auth.jsx';
import { useApi, Field, Loading, ErrorBox, Card, Badge, Icon, Modal, useToast } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { ScanButton } from '../components/scan.jsx';
import { itDate, itDateTime, dec, PKG_STATUS } from '../format.js';
import { iconFor } from './OrderDetail.jsx';

export default function Stock() {
  const { user } = useAuth();
  const ops = isOps(user);
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const sid = ops ? sp.get('struttura_id') || '' : '';
  const strutture = useApi(ops ? '/strutture' : null);
  const { data, reload } = useApi(ops ? (sid ? `/stock?struttura_id=${sid}` : null) : '/stock', [sid]);
  const [err, setErr] = useState(null);
  const [code, setCode] = useState('');
  const [detail, setDetail] = useState(null);
  const [initial, setInitial] = useState(null);
  const [onlyStock, setOnlyStock] = useState(true);
  const inputRef = useRef(null);
  const q = (extra) => qs({ struttura_id: sid || undefined, ...extra });
  const use = async (body, label) => {
    setErr(null);
    try { const r = await api.post(`/stock/use${q()}`, body); toast(`${label || 'Confezione'} messa in uso. Restano ${r.remaining} in giacenza`); setCode(''); reload(); inputRef.current?.focus(); } catch (e) { setErr(e); }
  };
  const rows = (data?.rows || []).filter((r) => !onlyStock || r.packs > 0 || r.packs_incoming > 0 || r.used_this_month > 0);
  const totals = data ? { packs: data.rows.reduce((s, r) => s + r.packs, 0), incoming: data.rows.reduce((s, r) => s + r.packs_incoming, 0), used: data.rows.reduce((s, r) => s + r.used_this_month, 0), alerts: data.rows.filter((r) => r.alert).length } : null;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{data?.struttura.kind === 'CLIENTE' ? 'Materiale ricevuto' : 'Giacenza attuale'}</h1><div className="sub">{data ? `${data.struttura.name}: confezioni in giacenza per articolo, aggiornata dai carichi (fase 5) e dagli scarichi (fase 6)` : 'Confezioni in giacenza per articolo'}</div></div>
        <div className="row">
          {ops && <Field label="Struttura"><select value={sid} onChange={(e) => setSp(e.target.value ? { struttura_id: e.target.value } : {})} style={{ minWidth: 260 }}><option value="">Scegli…</option>{(strutture.data || []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.kind})</option>)}</select></Field>}
          {data && <a className="btn ghost" href={`/api/stats/export/stock.xlsx`}><Icon name="download" size={16} />Excel</a>}
          {data && <button className="btn ghost" onClick={() => setInitial({ lines: [] })}><Icon name="plus" size={16} />Carico iniziale</button>}
        </div>
      </div>
      <ErrorBox error={err} />
      {!data ? (ops && !sid ? <div className="card"><div className="empty">Scegli una struttura per vedere la giacenza</div></div> : <Loading />) : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="card kpi accent"><div className="lbl">Confezioni in giacenza</div><div className="val">{totals.packs}</div></div>
          <div className="card kpi"><div className="lbl">In arrivo</div><div className="val">{totals.incoming}</div><div className="foot">ordini trasmessi non ancora ricevuti</div></div>
          <div className="card kpi"><div className="lbl">Messe in uso questo mese</div><div className="val">{totals.used}</div></div>
          <div className="card kpi"><div className="lbl">Sotto scorta</div><div className="val" style={{ color: totals.alerts ? 'var(--red)' : undefined }}>{totals.alerts}</div><div className="foot">meno di mezzo mese di consumo o sotto soglia</div></div>
        </div>
        <Card title={data.struttura.kind === 'CLIENTE' ? 'Metti in uso' : 'Scarico rapido'} className="mb">
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) use({ code: code.trim() }); }}>
            <input ref={inputRef} className="mono" placeholder="Leggi il codice a barre della confezione prelevata e premi Invio" value={code} onChange={(e) => setCode(e.target.value)} style={{ maxWidth: 460 }} autoFocus />
            <button className="btn"><Icon name="barcode" size={16} />Metti in uso</button>
            <ScanButton onCode={(c) => use({ code: c })} />
            <label className="f inline small" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} />Solo articoli movimentati</label>
          </form>
          <div className="small muted" style={{ marginTop: 8 }}>{data.struttura.kind === 'CLIENTE' ? 'In alternativa usa il pulsante sulla riga dell\'articolo: esce la confezione con la scadenza più vicina.' : 'La pagina dedicata è Scarico materiale (fase 6), con il registro degli scarichi.'}</div>
        </Card>
        <Card flush>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Articolo</th><th className="num">In giacenza</th><th className="num">In arrivo</th><th className="num">In uso nel mese</th>{data.struttura.kind !== 'LAB' && <th className="num">Consumo medio</th>}{data.struttura.kind !== 'LAB' && <th className="num">Copertura</th>}<th>Prima scadenza</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.article_id} className={r.alert ? 'warnrow' : ''}>
                <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt icon={r.icon} color={r.color} size={32} /><div><div className="strong">{r.article_name}</div><div className="small muted">{r.pack_label}</div></div></div></td>
                <td className="num strong" style={{ fontSize: 16 }}>{r.packs}</td>
                <td className="num muted">{r.packs_incoming || '–'}</td>
                <td className="num">{r.used_this_month || '–'}</td>
                {data.struttura.kind !== 'LAB' && <td className="num">{r.prod_packs_avg != null ? `${dec(r.prod_packs_avg, 1)} conf./mese` : <span className="muted">–</span>}</td>}
                {data.struttura.kind !== 'LAB' && <td className="num">{r.coverage_months != null ? <Badge tone={r.coverage_months < 0.5 ? 'red' : r.coverage_months < 1 ? 'mauve' : 'green'}>{dec(r.coverage_months, 1)} mesi</Badge> : <span className="muted">–</span>}</td>}
                <td className="small">{r.next_expiry ? <span className={new Date(r.next_expiry) < new Date(Date.now() + 60 * 86400000) ? 'red' : ''}>{itDate(r.next_expiry)}</span> : <span className="muted">–</span>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm ghost" onClick={() => setDetail(r)}>Confezioni</button>{' '}
                  <button className="btn sm" disabled={!r.packs} onClick={() => use({ article_id: r.article_id }, r.article_name)}>Metti in uso</button>
                </td>
              </tr>))}</tbody>
          </table></div>
        </Card>
      </>}
      {detail && <Packages r={detail} sid={sid} onClose={() => { setDetail(null); reload(); }} />}
      {initial && <InitialLoad sid={sid} onClose={() => setInitial(null)} onDone={() => { setInitial(null); reload(); }} />}
    </div>
  );
}

function Packages({ r, sid, onClose }) {
  const toast = useToast();
  const [status, setStatus] = useState('RICEVUTO');
  const { data, reload } = useApi(`/stock/packages${qs({ struttura_id: sid || undefined, article_id: r.article_id, status })}`, [status]);
  const act = async (path, body) => { try { await api.post(`/stock/${path}${qs({ struttura_id: sid || undefined })}`, body); toast('Fatto'); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal title={`${r.article_name} · confezioni`} onClose={onClose} wide>
      <div className="tabs">{['RICEVUTO', 'IN_USO', 'ATTESO', 'RETTIFICATO'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{PKG_STATUS[s].label}</button>)}</div>
      {!data ? <Loading /> : !data.length ? <div className="empty">Nessuna confezione</div> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Ordine</th><th>Lotto</th><th>Scadenza</th><th>Ricevuta</th>{status === 'IN_USO' && <th>In uso dal</th>}<th /></tr></thead>
          <tbody>{data.map((p) => <tr key={p.id}><td className="mono small">{p.order_number || p.origin}</td><td className="mono small">{p.lot || '–'}</td><td className="small">{itDate(p.expiry) || '–'}</td><td className="small muted">{itDateTime(p.received_at)}</td>{status === 'IN_USO' && <td className="small muted">{itDateTime(p.used_at)}{p.used_by_name ? ` · ${p.used_by_name}` : ''}</td>}
            <td className="num">{status === 'RICEVUTO' && <button className="btn sm" onClick={() => act('use', { package_id: p.id })}>Metti in uso</button>}{status === 'IN_USO' && <button className="btn sm ghost" onClick={() => act('unuse', { package_id: p.id })}>Annulla (entro 24 h)</button>}</td></tr>)}</tbody>
        </table></div>
      )}
    </Modal>
  );
}

// Prima giacenza o rettifica manuale: confezioni già presenti prima dell'avvio del sistema
function InitialLoad({ sid, onClose, onDone }) {
  const toast = useToast();
  const articles = useApi('/articles');
  const [lines, setLines] = useState([{ article_id: '', qty: 1, lot: '', expiry: '' }]);
  const [note, setNote] = useState('Carico iniziale');
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    try { const r = await api.post(`/stock/initial${qs({ struttura_id: sid || undefined })}`, { lines: lines.filter((l) => l.article_id && l.qty > 0).map((l) => ({ ...l, article_id: Number(l.article_id), qty: Number(l.qty), lot: l.lot || null, expiry: l.expiry || null })), note }); toast(`${r.packages} confezioni caricate`); onDone(); } catch (e) { setErr(e); }
  };
  return (
    <Modal title="Carico iniziale di confezioni in giacenza" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!lines.some((l) => l.article_id && l.qty > 0)} onClick={save}>Carica</button></>}>
      <ErrorBox error={err} />
      <div className="small muted" style={{ marginBottom: 10 }}>Per registrare il materiale già presente prima dell'avvio (o una rettifica fuori dal conteggio mensile). Ogni unità diventa una confezione in giacenza con lotto e scadenza indicati.</div>
      {lines.map((l, i) => (
        <div key={i} className="row" style={{ marginBottom: 8 }}>
          <select value={l.article_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, article_id: e.target.value } : x)))} style={{ flex: 2 }}><option value="">Articolo…</option>{(articles.data || []).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.pack_label}</option>)}</select>
          <input type="number" min="1" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} style={{ width: 90 }} placeholder="conf." />
          <input placeholder="lotto" value={l.lot} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, lot: e.target.value } : x)))} style={{ width: 130 }} />
          <input type="date" value={l.expiry} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, expiry: e.target.value } : x)))} style={{ width: 160 }} />
          <button className="iconbtn" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button>
        </div>))}
      <button className="btn sm ghost" onClick={() => setLines([...lines, { article_id: '', qty: 1, lot: '', expiry: '' }])}>+ Riga</button>
      <Field label="Nota" className="mt"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Modal>
  );
}

export { Link };
