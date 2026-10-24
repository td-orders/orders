import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, isOps } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Card, StatusBadge, Badge, Modal, PromptModal, Field, Icon, useToast } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { itDate, itDateTime, dec, pct, KIND, ORIGIN, PHASES, phaseOf, STATUS_LONG, PKG_STATUS, ISSUE_KIND } from '../format.js';

const deltaTone = (d) => (d == null ? 'grey' : Math.abs(d) > 50 ? 'red' : Math.abs(d) > 20 ? 'mauve' : 'green');

export default function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const ops = isOps(user);
  const nav = useNavigate();
  const toast = useToast();
  const { data: o, reload } = useApi(`/orders/${id}`);
  const [err, setErr] = useState(null);
  const [edit, setEdit] = useState({});
  const [opsNotes, setOpsNotes] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [issue, setIssue] = useState(null);
  const [approveAsk, setApproveAsk] = useState(false);
  useEffect(() => { if (o) { setEdit({}); setOpsNotes(o.ops_notes || ''); } }, [o]);
  if (!o) return <div className="page"><Loading /></div>;

  const mine = o.struttura_id === user.struttura_id;
  const canVerify = ops && ['INVIATO', 'BOZZA'].includes(o.status);
  const canEditDraft = o.status === 'BOZZA' && (mine || ops);
  const isSystem = o.origin !== 'CLIENTE';
  const lines = o.lines.filter((l) => showAll || l.qty_requested > 0 || (l.qty_approved || 0) > 0 || (l.qty_proposed || 0) > 0 || (canEditDraft && (l.stock_packs || 0) > 0));
  const ph = phaseOf(o.status); const steps = PHASES.filter((p) => !p.tdOnly || o.kind !== 'CLIENTE');
  const stepIdx = steps.findIndex((p) => p === ph);
  const val = (l, k) => (edit[l.id]?.[k] !== undefined ? edit[l.id][k] : (l[k] ?? ''));
  const setVal = (l, k, v) => setEdit((e) => ({ ...e, [l.id]: { ...(e[l.id] || {}), [k]: v } }));
  const totalApproved = lines.reduce((s, l) => s + Number(val(l, 'qty_approved') || 0), 0);

  const saveVerify = async (approve) => {
    setErr(null);
    try {
      const body = { lines: o.lines.map((l) => ({ id: l.id, qty_approved: Number(val(l, 'qty_approved') || 0), note_ops: val(l, 'note_ops') || null })), ops_notes: opsNotes, approve };
      const r = await api.post(`/orders/${o.id}/verify`, body);
      if (approve) toast('Approvato: in attesa del magazzino (fase 3)'); else toast('Verifica salvata');
      setApproveAsk(false); reload();
    } catch (e) { setErr(e); setApproveAsk(false); }
  };
  const saveDraft = async (submit) => {
    setErr(null);
    try {
      await api.put(`/orders/${o.id}`, { lines: o.lines.map((l) => ({ article_id: l.article_id, qty: Number(val(l, 'qty_requested') || 0) })), notes: o.notes, urgent: o.urgent, urgent_reason: o.urgent_reason, client_ref: o.client_ref });
      if (submit) { await api.post(`/orders/${o.id}/submit`); toast('Ordine inviato a Toscana Diagnostica'); } else toast('Bozza salvata');
      reload();
    } catch (e) { setErr(e); }
  };
  const act = async (path, body, msg) => { setErr(null); try { const r = await api.post(`/orders/${o.id}/${path}`, body); toast(msg || 'Fatto'); reload(); return r; } catch (e) { setErr(e); } };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row"><h1>Ordine {o.number}</h1><StatusBadge status={o.status} />{o.urgent && <Badge tone="red">Urgente</Badge>}</div>
          <div className="sub">{o.struttura_name} · {KIND[o.kind]} · {ORIGIN[o.origin]}{o.requested_by_name ? ` · ${o.requested_by_name}` : ''} · {STATUS_LONG[o.status]}</div>
        </div>
        <div className="row">
          <a className="btn ghost" href={`/api/orders/${o.id}/pdf`} target="_blank" rel="noreferrer"><Icon name="print" size={16} />PDF</a>
          {ops && ['APPROVATO', 'PRESO_IN_CARICO'].includes(o.status) && <Link className="btn" to="/fornitore"><Icon name="truck" size={16} />Fase 3: magazzino</Link>}
          {ops && o.status === 'SPEDITO' && <Link className="btn" to="/consegne"><Icon name="truck" size={16} />Fase 4: registra consegna</Link>}
          {mine && o.kind !== 'CLIENTE' && o.status === 'CONSEGNATO' && <Link className="btn" to={`/carico/${o.id}`}><Icon name="barcode" size={16} />Fase 5: carica nel magazzino</Link>}
          {ops && o.status === 'IMMAGAZZINATO' && <button className="btn" disabled={o.open_issues > 0} title={o.open_issues ? 'Chiudi prima le difformità' : ''} onClick={() => act('close', {}, 'Processo concluso')}><Icon name="check" size={16} />Concludi il processo</button>}
          {((ops && ['BOZZA', 'INVIATO', 'APPROVATO', 'PRESO_IN_CARICO'].includes(o.status)) || (mine && ['BOZZA', 'INVIATO'].includes(o.status))) && <button className="btn danger" onClick={() => setCancel(true)}>Annulla ordine</button>}
        </div>
      </div>
      <ErrorBox error={err} />
      {o.status !== 'ANNULLATO' && (
        <div className="steps">{steps.map((p, i) => <div key={p.key} className={`s ${i < stepIdx ? 'done' : i === stepIdx ? 'now' : ''}`}><i>{i < stepIdx ? '✓' : p.n === 9 ? '✓' : p.n}</i>{p.label}</div>)}</div>
      )}
      {o.status === 'ANNULLATO' && <div className="alert err" style={{ marginBottom: 16 }}>Annullato il {itDateTime(o.cancelled_at)}: {o.cancel_reason}</div>}
      {(o.notes || o.urgent_reason || o.client_ref) && <div className="alert info" style={{ marginBottom: 16 }}>{o.urgent_reason && <span><b>Urgenza:</b> {o.urgent_reason}. </span>}{o.notes && <span><b>Note:</b> {o.notes}. </span>}{o.client_ref && <span><b>Rif. cliente:</b> {o.client_ref}</span>}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
        <div>
          <Card title={canVerify ? 'Verifica delle quantità' : 'Righe dell\'ordine'} flush actions={<label className="f inline small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Mostra tutti gli articoli</label>}>
            <div className="table-wrap"><table className="t lines">
              <thead><tr>
                <th>Articolo</th>
                <th className="num">{isSystem ? 'Proposto' : 'Richiesto'}</th>
                {o.kind !== 'LAB' && <th className="num" title="Consumo medio mensile in confezioni, dalla produzione StudioLab correlata">Produzione media</th>}
                {o.kind !== 'LAB' && <th className="num">Distanza</th>}
                <th className="num">Giacenza</th>
                <th className="num">Ultimo ordine</th>
                <th className="num">Approvato TD</th>
                {(canVerify || o.lines.some((l) => l.note_ops)) && <th>Note Operations</th>}
                {['CONSEGNATO', 'IMMAGAZZINATO', 'CHIUSO'].includes(o.status) && <th className="num">Consegnato / caricato</th>}
              </tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.id}>
                  <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt icon={iconFor(l.category_code)} color={l.color} size={34} /><div><div className="strong">{l.article_name}</div><div className="small muted">{l.pack_label} · {l.unit}{l.note_client ? ` · ${l.note_client}` : ''}</div></div></div></td>
                  <td className="num">{canEditDraft ? <input className="qin" inputMode="numeric" value={val(l, 'qty_requested')} onChange={(e) => setVal(l, 'qty_requested', e.target.value.replace(/\D/g, ''))} /> : <span className="strong">{isSystem ? (l.qty_proposed ?? l.qty_requested) : l.qty_requested}</span>}</td>
                  {o.kind !== 'LAB' && <td className="num" title={l.prod_units_avg != null ? `${dec(l.prod_units_avg, 0)} ${l.unit} al mese` : 'Nessuna produzione correlata'}>{l.prod_packs_avg != null ? <>{dec(l.prod_packs_avg, 1)}<div className="small muted">{dec(l.prod_units_avg, 0)} {l.unit.replace('n. ', '')}/mese</div></> : <span className="muted">–</span>}</td>}
                  {o.kind !== 'LAB' && <td className="num">{l.delta_pct != null ? <Badge tone={deltaTone(l.delta_pct)}>{pct(l.delta_pct)}</Badge> : <span className="muted">–</span>}</td>}
                  <td className="num">{l.stock_packs ?? '–'}</td>
                  <td className="num">{l.last_order_qty ?? '–'}</td>
                  <td className="num">{canVerify ? <input className={`qin ${Number(val(l, 'qty_approved')) !== l.qty_requested ? 'changed' : ''}`} inputMode="numeric" value={val(l, 'qty_approved')} onChange={(e) => setVal(l, 'qty_approved', e.target.value.replace(/\D/g, ''))} /> : <span className="strong">{l.qty_approved ?? '–'}</span>}</td>
                  {(canVerify || o.lines.some((x) => x.note_ops)) && <td>{canVerify ? <input value={val(l, 'note_ops')} placeholder="motivo della modifica" onChange={(e) => setVal(l, 'note_ops', e.target.value)} style={{ minWidth: 150 }} /> : <span className="small">{l.note_ops}</span>}</td>}
                  {['CONSEGNATO', 'IMMAGAZZINATO', 'CHIUSO'].includes(o.status) && <td className="num">{l.qty_delivered ?? 0} / {l.packs_received}{l.packs_missing > 0 && <div className="small red">{l.packs_missing} mancanti</div>}</td>}
                </tr>))}</tbody>
              <tfoot><tr><td>Totale confezioni</td><td className="num">{lines.reduce((s, l) => s + Number(canEditDraft ? val(l, 'qty_requested') || 0 : (isSystem ? l.qty_proposed ?? l.qty_requested : l.qty_requested)), 0)}</td>{o.kind !== 'LAB' && <td colSpan={2} />}<td colSpan={2} /><td className="num">{canVerify ? totalApproved : lines.reduce((s, l) => s + (l.qty_approved || 0), 0)}</td><td colSpan={3} /></tr></tfoot>
            </table></div>
            {canVerify && (
              <div className="bd" style={{ borderTop: '1px solid var(--line)' }}>
                <div className="small muted" style={{ marginBottom: 8 }}>La colonna Approvato è precompilata con la quantità {isSystem ? 'proposta dal sistema' : 'richiesta'}: modifica solo ciò che consideri difforme. Distanza = scostamento tra richiesta e produzione media mensile ({o.events.find((e) => e.data?.production_months)?.data?.production_months || ''} mesi di StudioLab).</div>
                <Field label="Note dell'Area Operations"><textarea value={opsNotes} onChange={(e) => setOpsNotes(e.target.value)} style={{ minHeight: 56 }} /></Field>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn ghost" onClick={() => act('refresh-production', {}, 'Produzione e giacenze ricalcolate')}>Ricalcola produzione</button>
                  <button className="btn ghost" onClick={() => saveVerify(false)}>Salva verifica</button>
                  <button className="btn" disabled={!totalApproved} onClick={() => setApproveAsk(true)}><Icon name="check" size={16} />Approva: passa al magazzino</button>
                </div>
              </div>
            )}
            {canEditDraft && !canVerify && (
              <div className="bd row" style={{ borderTop: '1px solid var(--line)' }}>
                <button className="btn ghost" onClick={() => saveDraft(false)}>Salva bozza</button>
                <button className="btn" onClick={() => saveDraft(true)}>Approva e invia a Toscana Diagnostica</button>
              </div>
            )}
          </Card>

          {ops && o.status === 'CONSEGNATO' && o.kind !== 'CLIENTE' && <div className="alert info mt">Consegnato il {itDateTime(o.delivered_at)}{o.ddt_number ? ` (DDT ${o.ddt_number})` : ''}: in attesa che {o.struttura_name} carichi il materiale nel magazzino interno (fase 5), {o.packs_received} confezioni su {o.packs_delivered} già lette.</div>}
          {o.packages.length > 0 && (
            <Card title={`Confezioni consegnate (${o.packages.length})`} flush className="mt">
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Articolo</th><th>#</th><th>Stato</th><th>Codice letto</th><th>Lotto</th><th>Scadenza</th><th>Ricevuta il</th></tr></thead>
                <tbody>{o.packages.map((p) => <tr key={p.id}><td>{p.article_name}</td><td className="muted">{p.seq}</td><td><Badge tone={PKG_STATUS[p.status]?.tone}>{PKG_STATUS[p.status]?.label}</Badge></td><td className="mono small">{p.barcode}</td><td className="mono small">{p.lot}</td><td className="small">{itDate(p.expiry)}</td><td className="small muted">{itDateTime(p.received_at)}</td></tr>)}</tbody>
              </table></div>
            </Card>
          )}
        </div>
        <div>
          <Card title="Cronologia">
            <ul className="timeline">{o.events.map((e) => <li key={e.id}><div className="ev">{e.event}</div><div className="small muted">{itDateTime(e.at)}{e.full_name ? ` · ${e.full_name}` : ''}{e.data?.reference ? ` · rif. ${e.data.reference}` : ''}{e.data?.error ? ` · ${e.data.error}` : ''}</div></li>)}</ul>
            {o.silva_reference && <div className="small" style={{ marginTop: 8 }}>Riferimento magazzino: <span className="mono">{o.silva_reference}</span></div>}
            {o.ddt_number && <div className="small">DDT: <span className="mono">{o.ddt_number}</span></div>}
          </Card>
          <Card title="Difformità" className="mt" actions={(mine || ops) && ['SPEDITO', 'CONSEGNATO', 'IMMAGAZZINATO', 'CHIUSO'].includes(o.status) && <button className="btn sm ghost" onClick={() => setIssue({ kind: 'MANCANTE', description: '' })}>Segnala</button>}>
            {!o.issues.length ? <div className="muted small">Nessuna difformità</div> : o.issues.map((i) => (
              <div key={i.id} className={`msg ${i.status === 'CHIUSA' ? 'CHIUSURA' : ''}`} style={{ marginBottom: 8 }}>
                <div className="who">{ISSUE_KIND[i.kind]} · {i.opened_by_name} · {itDateTime(i.opened_at)} · <Badge tone={i.status === 'APERTA' ? 'red' : 'green'}>{i.status === 'APERTA' ? 'Aperta' : 'Gestita'}</Badge></div>
                <div className="body">{i.description}</div>
                {i.response && <div className="small" style={{ marginTop: 6 }}><b>Risposta:</b> {i.response}</div>}
                {ops && i.status === 'APERTA' && <CloseIssue id={i.id} onDone={reload} />}
              </div>))}
          </Card>
          {o.struttura && (
            <Card title="Punto di consegna" className="mt">
              <div className="strong">{o.struttura.name}</div>
              <div className="small">{[o.struttura.address, [o.struttura.zip, o.struttura.city, o.struttura.province].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>
              <div className="small muted">{o.struttura.referente}{o.struttura.referente_phone ? ` · ${o.struttura.referente_phone}` : ''}{o.struttura.email ? ` · ${o.struttura.email}` : ''}</div>
              {o.struttura.delivery_notes && <div className="small" style={{ marginTop: 6 }}>{o.struttura.delivery_notes}</div>}
              <div className="small muted" style={{ marginTop: 6 }}>{o.struttura.delivery_mode === 'RITIRO' ? 'Ritiro presso TD' : 'Giro logistico TD'}{ops && <> · <Link to={`/giacenza?struttura_id=${o.struttura_id}`}>giacenza della struttura</Link></>}</div>
            </Card>
          )}
        </div>
      </div>

      {cancel && <PromptModal title={`Annullare l'ordine ${o.number}?`} label="Motivazione" confirmText="Annulla ordine" danger onClose={() => setCancel(false)} onConfirm={async (reason) => { await api.post(`/orders/${o.id}/cancel`, { reason }); toast('Ordine annullato'); reload(); }} />}
      {approveAsk && (
        <Modal title="Approvare e trasmettere al fornitore?" onClose={() => setApproveAsk(false)} footer={<><button className="btn ghost" onClick={() => setApproveAsk(false)}>Indietro</button><button className="btn" onClick={() => saveVerify(true)}>Approva</button></>}>
          <p>{totalApproved} confezioni approvate in {lines.filter((l) => Number(val(l, 'qty_approved') || 0) > 0).length} articoli. L'ordine passa alla fase 3: viene esposto sulle API che il magazzino Silva legge ogni 5 minuti; la struttura riceve il PDF per email.</p>
        </Modal>
      )}
      {issue && (
        <Modal title="Segnala una difformità" onClose={() => setIssue(null)} footer={<><button className="btn ghost" onClick={() => setIssue(null)}>Annulla</button><button className="btn" disabled={issue.description.length < 3} onClick={async () => { await act('issues', issue, 'Difformità segnalata'); setIssue(null); }}>Invia</button></>}>
          <div className="form-grid">
            <Field label="Tipo"><select value={issue.kind} onChange={(e) => setIssue({ ...issue, kind: e.target.value })}>{Object.entries(ISSUE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <Field label="Descrizione" className="mt"><textarea value={issue.description} onChange={(e) => setIssue({ ...issue, description: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

function CloseIssue({ id, onDone }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>Gestisci e chiudi</button>
    {open && <PromptModal title="Risposta alla difformità" label="Cosa è stato fatto (la struttura riceve la risposta via email)" confirmText="Chiudi difformità" onClose={() => setOpen(false)} onConfirm={async (response) => { await api.post(`/stock/issues/${id}/close`, { response }); onDone(); }} />}
  </>;
}

const ICON_BY_PREFIX = { PRE: 'needle', PRV: 'tube', CNT: 'jar', TMP: 'swab', TRB: 'bag', KIT: 'kit', CIT: 'slide', IST: 'bottle', LOG: 'doc' };
const ICON_BY_CAT = { PRELIEVO: 'needle', PROVETTE: 'tube', CONTENITORI: 'jar', TAMPONI: 'swab', TRANSBAG: 'bag', KIT: 'kit', CITOLOGIA: 'slide', ISTOLOGIA: 'bottle', LOGISTICA: 'doc' };
export const iconFor = (k) => ICON_BY_CAT[k] || ICON_BY_PREFIX[String(k || '').slice(0, 3)] || 'kit';
