import React, { useMemo, useState } from 'react';
import { api, qs } from '../api.js';
import { useAuth, isOps } from '../auth.jsx';
import { useApi, Field, Loading, Empty, Card, ErrorBox, Modal, Icon, Badge, useToast } from '../components/ui.jsx';
import { monthLabel, currentMonth, dec, itDateTime } from '../format.js';

// Produzione mensile per struttura (StudioLab): esami x mesi, correlata ai materiali consumati
export default function Production() {
  const { user } = useAuth();
  const ops = isOps(user);
  const toast = useToast();
  const [sid, setSid] = useState('');
  const [err, setErr] = useState(null);
  const [manual, setManual] = useState(null);
  const strutture = useApi(ops ? '/strutture' : null);
  const settings = useApi(ops ? '/settings' : null);
  const target = ops ? sid : user.struttura_id;
  const { data, reload } = useApi(target ? `/production${qs({ struttura_id: ops ? sid : undefined, months: 6 })}` : null, [sid]);
  const cons = useApi(target ? `/stock/consumption${qs({ struttura_id: ops ? sid : undefined })}` : null, [sid, data]);
  const months = useMemo(() => [...new Set((data || []).map((r) => r.month.slice(0, 7)))].sort().reverse(), [data]);
  const exams = useMemo(() => { const m = new Map(); for (const r of data || []) { const e = m.get(r.exam_code) || { code: r.exam_code, name: r.exam_name, materials: r.materials, by: {} }; e.by[r.month.slice(0, 7)] = r; m.set(r.exam_code, e); } return [...m.values()].sort((a, b) => a.code.localeCompare(b.code)); }, [data]);
  const importFile = async (f) => {
    setErr(null);
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api.upload('/production/import', fd); toast(`Importate ${r.rows} righe su ${r.months} mesi`); reload(); } catch (e) { setErr(e); }
  };
  const testSl = async () => { setErr(null); try { const r = await api.get('/production/studiolab/test'); toast(`ServiceNET risponde: ${JSON.stringify(r.whoami).slice(0, 120)}`); } catch (e) { setErr(e); } };
  const syncExams = async () => { setErr(null); try { const r = await api.post('/production/studiolab/sync-exams'); toast(`Catalogo esami sincronizzato: ${r.exams} esami`); } catch (e) { setErr(e); } };
  const sl = settings.data?.studiolab;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Produzione{ops ? ' StudioLab' : ''}</h1><div className="sub">Esami refertati per mese, correlati ai materiali di consumo attraverso la tabella esame → articolo</div></div>
        <div className="row">
          {ops && <Field label="Struttura"><select value={sid} onChange={(e) => setSid(e.target.value)} style={{ minWidth: 260 }}><option value="">Scegli…</option>{(strutture.data || []).filter((s) => s.kind !== 'LAB').map((s) => <option key={s.id} value={s.id}>{s.name}{s.studiolab_code ? ` · ${s.studiolab_code}` : ''}</option>)}</select></Field>}
          {ops && <a className="btn ghost" href="/api/production/import/template.xlsx"><Icon name="download" size={16} />Modello</a>}
          {ops && <label className="btn ghost"><Icon name="upload" size={16} />Importa file<input type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} /></label>}
          {ops && sid && <button className="btn ghost" onClick={() => setManual({ month: currentMonth(), items: [{ examCode: '', examName: '', qty: '' }] })}><Icon name="plus" size={16} />Inserisci mese</button>}
          {ops && <button className="btn ghost" disabled={!sl?.configured} title={!sl?.configured ? 'STUDIOLAB_API_KEY non impostata' : ''} onClick={testSl}><Icon name="link" size={16} />Prova ServiceNET</button>}
          {ops && <button className="btn ghost" disabled={!sl?.configured} onClick={syncExams}><Icon name="link" size={16} />Sincronizza catalogo esami</button>}
        </div>
      </div>
      <ErrorBox error={err} />
      {ops && sl && <div className="alert info" style={{ marginBottom: 14 }}>La produzione arriva in tempo reale dai messaggi HL7 che StudioLab invia a Orders Management (ultimo: {sl.last_hl7_at ? itDateTime(sl.last_hl7_at) : 'nessuno ancora'}); in alternativa dal file esportato dal gestionale o a mano. Le API REST di ServiceNET servono per il catalogo esami, non per la produzione.</div>}
      {!target ? <Card><Empty>Scegli una struttura</Empty></Card> : !data ? <Loading /> : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
          <Card title="Esami per mese" flush>
            {!exams.length ? <Empty>Nessuna produzione registrata</Empty> : (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Esame</th><th>Materiale correlato</th>{months.map((m) => <th key={m} className="num">{monthLabel(m)}</th>)}</tr></thead>
                <tbody>{exams.map((e) => <tr key={e.code}><td><span className="mono">{e.code}</span> {e.name}</td><td className="small">{e.materials ? e.materials.map((m) => `${m.article}${Number(m.qty_per_exam) !== 1 ? ` ×${m.qty_per_exam}` : ''}`).join(', ') : <Badge tone="red">non correlato</Badge>}</td>{months.map((m) => <td key={m} className="num">{e.by[m]?.qty ?? <span className="muted">–</span>}</td>)}</tr>)}</tbody>
              </table></div>
            )}
          </Card>
          <Card title={`Consumo medio mensile (${cons.data?.months || 0} mesi)`} flush>
            {!cons.data?.items?.length ? <Empty>Nessun consumo calcolabile: servono produzione e correlazioni</Empty> : (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Articolo</th><th className="num">Unità/mese</th><th className="num">Confezioni/mese</th></tr></thead>
                <tbody>{cons.data.items.map((it) => { const art = (it.detail || [])[0]; return <tr key={it.article_id}><td><ArticleName id={it.article_id} /></td><td className="num">{dec(it.units, 0)}</td><td className="num strong">{dec(it.packs, 1)}</td></tr>; })}</tbody>
              </table></div>
            )}
          </Card>
        </div>
      )}
      {manual && (
        <Modal title="Inserimento manuale della produzione" onClose={() => setManual(null)} wide footer={<><button className="btn ghost" onClick={() => setManual(null)}>Annulla</button><button className="btn" onClick={async () => { setErr(null); try { await api.post('/production', { struttura_id: Number(sid), month: manual.month, items: manual.items.filter((i) => i.examCode).map((i) => ({ ...i, qty: Number(i.qty) || 0 })) }); toast('Produzione salvata'); setManual(null); reload(); } catch (e) { setErr(e); } }}>Salva</button></>}>
          <Field label="Mese"><input type="month" value={manual.month} onChange={(e) => setManual({ ...manual, month: e.target.value })} style={{ width: 200 }} /></Field>
          <div style={{ marginTop: 10 }}>{manual.items.map((it, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <input placeholder="codice esame" value={it.examCode} onChange={(e) => setManual({ ...manual, items: manual.items.map((x, j) => (j === i ? { ...x, examCode: e.target.value } : x)) })} style={{ width: 140 }} />
              <input placeholder="descrizione" value={it.examName} onChange={(e) => setManual({ ...manual, items: manual.items.map((x, j) => (j === i ? { ...x, examName: e.target.value } : x)) })} style={{ flex: 1 }} />
              <input type="number" min="0" placeholder="n." value={it.qty} onChange={(e) => setManual({ ...manual, items: manual.items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} style={{ width: 100 }} />
            </div>))}
            <button className="btn sm ghost" onClick={() => setManual({ ...manual, items: [...manual.items, { examCode: '', examName: '', qty: '' }] })}>+ Esame</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ArticleName({ id }) {
  const { data } = useApi('/articles');
  const a = (data || []).find((x) => x.id === id);
  return a ? <>{a.name}<div className="small muted">{a.pack_label}</div></> : <span className="muted">#{id}</span>;
}
