import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Field, Loading, Empty, Badge, Modal, ErrorBox, Card, useToast } from '../components/ui.jsx';
import { KIND, monthLabel } from '../format.js';

const empty = { kind: 'CLIENTE', code: '', name: '', address: '', zip: '', city: '', province: '', phone: '', email: '', pec: '', referente: '', referente_phone: '', studiolab_code: '', delivery_notes: '', delivery_mode: 'GIRO', stock_deadline_day: 15, active: true };

export default function Strutture() {
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const toast = useToast();
  const [kind, setKind] = useState('');
  const { data, reload } = useApi('/strutture');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const rows = (data || []).filter((s) => !kind || s.kind === kind);
  const save = async () => {
    setErr(null);
    const b = { ...edit }; ['id', 'users_count', 'referenti', 'open_orders', 'last_stock_month', 'created_at', 'updated_at'].forEach((k) => delete b[k]);
    if (edit.id) { delete b.kind; delete b.code; }
    try { if (edit.id) await api.put(`/strutture/${edit.id}`, b); else await api.post('/strutture', b); toast('Struttura salvata'); setEdit(null); reload(); } catch (e) { setErr(e); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Strutture</h1><div className="sub">Clienti Service (ordinano dal catalogo), sedi del network (giacenza entro il 15) e laboratorio TD (giacenza entro il 30). I referenti derivano dagli utenti.</div></div>
        <div className="row">
          <Field label="Tipo"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Tutte</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {sup && <button className="btn" onClick={() => setEdit({ ...empty })}>+ Nuova struttura</button>}
        </div>
      </div>
      <ErrorBox error={err} />
      <Card flush>
        {!data ? <Loading /> : !rows.length ? <Empty>Nessuna struttura</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Codice</th><th>Struttura</th><th>Tipo</th><th>Referenti</th><th>Contatti</th><th>StudioLab</th><th className="num">Ordini aperti</th><th>Ultima giacenza</th><th>Stato</th><th /></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td className="mono">{s.code}</td>
                <td><div className="strong">{s.name}</div><div className="small muted">{[s.address, s.city].filter(Boolean).join(', ')}</div></td>
                <td>{KIND[s.kind]}{s.kind !== 'CLIENTE' && <div className="small muted">giacenza entro il {s.stock_deadline_day}</div>}</td>
                <td className="small">{s.referenti || <span className="muted">{s.referente || '–'}</span>}<div className="muted">{s.users_count} utenti</div></td>
                <td className="small">{s.email}<div className="muted">{s.phone}</div></td>
                <td className="mono small">{s.studiolab_code || '–'}</td>
                <td className="num"><Link to={`/ordini?struttura_id=${s.id}`}>{s.open_orders}</Link></td>
                <td className="small">{s.last_stock_month ? monthLabel(s.last_stock_month) : '–'}</td>
                <td>{s.active ? <Badge tone="green">Attiva</Badge> : <Badge tone="red">Disattiva</Badge>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}><Link className="btn sm ghost" to={`/giacenza?struttura_id=${s.id}`}>Giacenza</Link> <button className="btn sm ghost" onClick={() => setEdit({ ...empty, ...s })}>Modifica</button></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      {edit && (
        <Modal title={edit.id ? `Modifica ${edit.name}` : 'Nuova struttura'} onClose={() => setEdit(null)} wide footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={!edit.name || !edit.code} onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="form-grid">
            <Field label="Tipo"><select value={edit.kind} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, kind: e.target.value, stock_deadline_day: e.target.value === 'LAB' ? 30 : 15 })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Codice" help="Maiuscole, numeri, - o _"><input value={edit.code} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Ragione sociale / denominazione" className="span2"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Indirizzo di consegna"><input value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="CAP"><input value={edit.zip || ''} onChange={(e) => setEdit({ ...edit, zip: e.target.value })} /></Field>
            <Field label="Città"><input value={edit.city || ''} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></Field>
            <Field label="Provincia"><input value={edit.province || ''} maxLength={2} onChange={(e) => setEdit({ ...edit, province: e.target.value.toUpperCase() })} /></Field>
            <Field label="Email (comunicazioni e solleciti)"><input type="email" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="PEC"><input type="email" value={edit.pec || ''} onChange={(e) => setEdit({ ...edit, pec: e.target.value })} /></Field>
            <Field label="Telefono"><input value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Referente per le richieste"><input value={edit.referente || ''} onChange={(e) => setEdit({ ...edit, referente: e.target.value })} /></Field>
            <Field label="Telefono referente"><input value={edit.referente_phone || ''} onChange={(e) => setEdit({ ...edit, referente_phone: e.target.value })} /></Field>
            <Field label="Codice cliente StudioLab" help="Collega produzione e credenziali StudioLab"><input value={edit.studiolab_code || ''} onChange={(e) => setEdit({ ...edit, studiolab_code: e.target.value })} /></Field>
            <Field label="Modalità di consegna"><select value={edit.delivery_mode} onChange={(e) => setEdit({ ...edit, delivery_mode: e.target.value })}><option value="GIRO">Giro logistico TD</option><option value="RITIRO">Ritiro presso TD</option></select></Field>
            {edit.kind !== 'CLIENTE' && <Field label="Giacenza mensile entro il giorno"><input type="number" min="1" max="31" value={edit.stock_deadline_day} onChange={(e) => setEdit({ ...edit, stock_deadline_day: e.target.value })} /></Field>}
            <Field label="Note per la consegna" className="span2"><textarea value={edit.delivery_notes || ''} onChange={(e) => setEdit({ ...edit, delivery_notes: e.target.value })} style={{ minHeight: 56 }} /></Field>
          </div>
          {edit.id && sup && <label className="f inline" style={{ marginTop: 12 }}><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Struttura attiva</label>}
        </Modal>
      )}
    </div>
  );
}
