import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Field, Loading, ErrorBox, Badge, Modal, Card, useToast } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';

// Catalogo articoli: elenco chiuso del MOD252 (48 voci). Il confezionamento è un'ipotesi da validare: si modifica qui.
export default function Articles() {
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const toast = useToast();
  const { data, reload } = useApi('/articles?all=1');
  const categories = useApi('/categories');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    const b = { name: edit.name, unit: edit.unit, pack_size: Number(edit.pack_size), pack_label: edit.pack_label, color: edit.color || null, gtin: edit.gtin || null, silva_code: edit.silva_code || null, coverage_factor: Number(edit.coverage_factor), min_stock_packs: Number(edit.min_stock_packs || 0), lab_only: !!edit.lab_only, active: !!edit.active, category_code: edit.category_code, visible_all: !!edit.visible_all, visible_sedi: !!edit.visible_sedi, visible_service: !!edit.visible_service };
    try { if (edit.id) await api.put(`/articles/${edit.id}`, b); else await api.post('/articles', { code: edit.code, ...b }); toast('Articolo salvato'); setEdit(null); reload(); } catch (e) { setErr(e); }
  };
  let lastCat = null;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Catalogo articoli</h1><div className="sub">Elenco chiuso del modulo TD-SGI-MOD252 sezione B: 48 articoli in 9 categorie. Confezionamento, codice a barre, fattore di copertura e soglia di scorta si gestiscono qui.</div></div>
        {sup && <button className="btn" onClick={() => setEdit({ code: '', category_code: 'PROVETTE', name: '', unit: 'n.', pack_size: 1, pack_label: '', color: '#71B1BD', gtin: '', silva_code: '', coverage_factor: 1.5, min_stock_packs: 0, lab_only: false, active: true, visible_all: true })}>+ Nuovo articolo</button>}
      </div>
      <div className="alert warn" style={{ marginBottom: 14 }}>Le quantità per confezione sono un'ipotesi iniziale (provette 100, aghi 50, tamponi 50, Transbag 100, kit singoli): vanno validate con i dati del magazzino. Il codice articolo Silva collega l'articolo al feed del magazzino; il GTIN permette la lettura in carico e scarico. La visibilità si gestisce anche dalla pagina Magazzino Silva (fase 0).</div>
      <ErrorBox error={err} />
      <Card flush>
        {!data ? <Loading /> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th /><th>Codice</th><th>Articolo</th><th>Unità del modulo</th><th className="num">Unità/conf.</th><th>Confezione</th><th>GTIN</th><th>Visibile a</th><th className="num">Fattore</th><th className="num">Soglia</th><th className="num">Correlazioni</th><th>Stato</th><th /></tr></thead>
            <tbody>{data.map((a) => { const catRow = a.category_code !== lastCat ? (lastCat = a.category_code, true) : false; return [
              catRow && <tr key={`c${a.category_code}`}><td colSpan={13} style={{ background: 'var(--teal-050)', color: 'var(--teal)', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>{a.category_name}</td></tr>,
              <tr key={a.id}>
                <td><ProductArt icon={a.icon} color={a.color} size={34} /></td>
                <td className="mono">{a.code}</td><td className="strong">{a.name}{a.source === 'SILVA' && <> <Badge tone="mauve">dal feed Silva</Badge></>}</td><td className="small">{a.unit}</td>
                <td className="num">{a.pack_size}</td><td className="small">{a.pack_label}</td><td className="mono small">{a.gtin || '–'}</td>
                <td className="small">{a.visible_all ? 'tutti' : [a.visible_sedi && 'punti prelievo', a.visible_service && 'Service'].filter(Boolean).join(', ') || <Badge tone="red">nessuno</Badge>}</td>
                <td className="num">{Number(a.coverage_factor).toLocaleString('it-IT')}</td><td className="num">{a.min_stock_packs || '–'}</td><td className="num">{a.mappings_count}</td>
                <td>{a.active ? <Badge tone="green">Attivo</Badge> : <Badge tone="red">Disattivo</Badge>}</td>
                <td className="num"><button className="btn sm ghost" onClick={() => setEdit({ ...a, gtin: a.gtin || '', color: a.color || '' })}>Modifica</button></td>
              </tr>]; })}</tbody>
          </table></div>
        )}
      </Card>
      {edit && (
        <Modal title={edit.id ? `Modifica ${edit.name}` : 'Nuovo articolo'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={!edit.name || !edit.pack_label || !(edit.id || edit.code)} onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="row" style={{ marginBottom: 12 }}><ProductArt icon={(categories.data || []).find((c) => c.code === edit.category_code)?.icon} color={edit.color} size={72} /><div className="small muted">Anteprima della grafica nel catalogo</div></div>
          <div className="form-grid">
            {!edit.id && <Field label="Codice"><input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></Field>}
            <Field label="Categoria"><select value={edit.category_code} onChange={(e) => setEdit({ ...edit, category_code: e.target.value })}>{(categories.data || []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
            <Field label="Nome" className="span2"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Unità del modulo" help="es. n. provette"><input value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} /></Field>
            <Field label="Unità per confezione"><input type="number" min="1" value={edit.pack_size} onChange={(e) => setEdit({ ...edit, pack_size: e.target.value })} /></Field>
            <Field label="Descrizione confezione" help="es. confezione da 100 provette"><input value={edit.pack_label} onChange={(e) => setEdit({ ...edit, pack_label: e.target.value })} /></Field>
            <Field label="Codice a barre GTIN"><input value={edit.gtin} onChange={(e) => setEdit({ ...edit, gtin: e.target.value.replace(/\s/g, '') })} /></Field>
            <Field label="Codice articolo Silva" help="Come compare nel feed del magazzino"><input value={edit.silva_code || ''} onChange={(e) => setEdit({ ...edit, silva_code: e.target.value })} /></Field>
            <Field label="Colore"><input type="color" value={edit.color || '#71B1BD'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} style={{ height: 38, padding: 2 }} /></Field>
            <Field label="Fattore di copertura" help="Moltiplicatore della formula di riordino"><input type="number" step="0.1" min="0" value={edit.coverage_factor} onChange={(e) => setEdit({ ...edit, coverage_factor: e.target.value })} /></Field>
            <Field label="Soglia di scorta (conf.)" help="Sotto questa giacenza compare l'avviso"><input type="number" min="0" value={edit.min_stock_packs} onChange={(e) => setEdit({ ...edit, min_stock_packs: e.target.value })} /></Field>
          </div>
          <div className="small strong muted" style={{ marginTop: 12 }}>Visibilità nel catalogo (fase 0)</div>
          <div className="row"><label className="f inline"><input type="checkbox" checked={!!edit.visible_all} onChange={(e) => setEdit({ ...edit, visible_all: e.target.checked })} />Tutti</label><label className="f inline"><input type="checkbox" checked={!!edit.visible_sedi} onChange={(e) => setEdit({ ...edit, visible_sedi: e.target.checked })} />Punti prelievo e laboratorio</label><label className="f inline"><input type="checkbox" checked={!!edit.visible_service} onChange={(e) => setEdit({ ...edit, visible_service: e.target.checked })} />Clienti Service</label></div>
          <label className="f inline" style={{ marginTop: 6 }}><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Articolo attivo</label>
        </Modal>
      )}
    </div>
  );
}
