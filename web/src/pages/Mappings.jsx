import React, { useState } from 'react';
import { api } from '../api.js';
import { useApi, Field, Loading, Empty, ErrorBox, Card, Icon, useToast } from '../components/ui.jsx';

// Correlazione esame StudioLab -> materiale consumato (es. 0014 Emocromo -> Tappo Viola, 1 provetta per esame)
export default function Mappings() {
  const toast = useToast();
  const { data, reload } = useApi('/mappings');
  const articles = useApi('/articles');
  const [f, setF] = useState({ exam_code: '', exam_name: '', article_id: '', qty_per_exam: 1 });
  const [err, setErr] = useState(null);
  const add = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api.post('/mappings', { ...f, article_id: Number(f.article_id), qty_per_exam: Number(f.qty_per_exam) || 1 }); toast('Correlazione salvata'); setF({ ...f, exam_code: '', exam_name: '' }); reload(); } catch (e2) { setErr(e2); }
  };
  const del = async (m) => { if (!window.confirm(`Eliminare la correlazione ${m.exam_code} → ${m.article_name}?`)) return; await api.del(`/mappings/${m.id}`); reload(); };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Correlazione esami e materiali</h1><div className="sub">Ogni codice esame di StudioLab consuma uno o più articoli: con questa tabella la produzione mensile diventa consumo di materiale e sostiene la verifica degli ordini e l'ordine automatico delle sedi.</div></div></div>
      <ErrorBox error={err} />
      <Card title="Nuova correlazione" className="mb">
        <form className="row" onSubmit={add}>
          <Field label="Codice esame StudioLab"><input value={f.exam_code} onChange={(e) => setF({ ...f, exam_code: e.target.value })} required style={{ width: 150 }} /></Field>
          <Field label="Descrizione"><input value={f.exam_name} onChange={(e) => setF({ ...f, exam_name: e.target.value })} style={{ width: 220 }} /></Field>
          <Field label="Materiale"><select value={f.article_id} onChange={(e) => setF({ ...f, article_id: e.target.value })} required style={{ minWidth: 280 }}><option value="">Scegli…</option>{(articles.data || []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.unit})</option>)}</select></Field>
          <Field label="Unità per esame"><input type="number" step="0.01" min="0.01" value={f.qty_per_exam} onChange={(e) => setF({ ...f, qty_per_exam: e.target.value })} style={{ width: 110 }} /></Field>
          <button className="btn" style={{ marginTop: 18 }}><Icon name="plus" size={16} />Aggiungi</button>
        </form>
        <div className="small muted" style={{ marginTop: 8 }}>Esempio: 0014 Emocromo → Tappo Viola, 1 provetta. Un esame può consumare più materiali (una riga per ciascuno).</div>
      </Card>
      <Card flush>
        {!data ? <Loading /> : !data.length ? <Empty>Nessuna correlazione: la verifica con la produzione non è ancora possibile</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Codice esame</th><th>Descrizione</th><th>Materiale</th><th className="num">Unità per esame</th><th /></tr></thead>
            <tbody>{data.map((m) => <tr key={m.id}><td className="mono strong">{m.exam_code}</td><td>{m.exam_name}</td><td>{m.article_name} <span className="muted small">({m.unit})</span></td><td className="num">{Number(m.qty_per_exam).toLocaleString('it-IT')}</td><td className="num"><button className="iconbtn" onClick={() => del(m)} aria-label="Elimina"><Icon name="trash" size={16} /></button></td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
