import React, { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApi, Field, Loading, ErrorBox, Card, Badge, Icon, Modal, useToast } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { PhaseBanner } from '../components/phase.jsx';
import { itDate, itDateTime, dec } from '../format.js';

// Fase 0 · Magazzino Silva: giacenze del fornitore (lotti, scadenze, quantità) e visibilità degli articoli
export default function Warehouse() {
  const toast = useToast();
  const { data, reload } = useApi('/warehouse');
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('STOCK');
  const [detail, setDetail] = useState(null);
  const [sel, setSel] = useState(new Set());
  const rows = useMemo(() => (data?.rows || []).filter((r) => (filter === 'STOCK' ? Number(r.qty) > 0 : filter === 'HIDDEN' ? !(r.visible_all || r.visible_sedi || r.visible_service) : filter === 'NEW' ? r.source === 'SILVA' : true) && (!search || `${r.code} ${r.silva_code || ''} ${r.name}`.toLowerCase().includes(search.toLowerCase()))), [data, filter, search]);
  const setVis = async (r, k, v) => { setErr(null); try { await api.put(`/warehouse/articles/${r.article_id}/visibility`, { [k]: v }); reload(); } catch (e) { setErr(e); } };
  const bulk = async (k, v) => { if (!sel.size) return; setErr(null); try { await api.put('/warehouse/visibility', { ids: [...sel], [k]: v }); toast(`${sel.size} articoli aggiornati`); setSel(new Set()); reload(); } catch (e) { setErr(e); } };
  const importFile = async (f) => { setErr(null); const fd = new FormData(); fd.append('file', f); try { const r = await api.upload('/warehouse/import', fd); toast(`Feed importato: ${r.items} righe, ${r.newArticles} articoli nuovi${r.errors.length ? `, ${r.errors.length} righe scartate` : ''}`); reload(); } catch (e) { setErr(e); } };
  const Chk = ({ r, k }) => <input type="checkbox" checked={!!r[k]} onChange={(e) => setVis(r, k, e.target.checked)} title={k === 'visible_all' ? 'Tutti' : k === 'visible_sedi' ? 'Punti prelievo e laboratorio' : 'Clienti Service'} />;
  return (
    <div className="page">
      <PhaseBanner n="0" title="Magazzino Silva: materiale a disposizione" desc="Il gestore del magazzino aggiorna le giacenze (articoli, lotti, scadenze, quantità). Qui l'Area Operations decide a chi rendere visibile ogni articolo nel catalogo: le strutture vedono solo l'articolo, mai quantità, lotti o scadenze." next="Fase 1: le strutture ordinano dal catalogo" />
      <div className="page-head">
        <div><h1>Giacenze del magazzino</h1><div className="sub">{data?.last_feed_at ? `Ultimo aggiornamento dal fornitore: ${itDateTime(data.last_feed_at)}` : 'Nessun feed ricevuto: in attesa della chiamata del fornitore (o importa il file)'}{data?.last_poll_at ? ` · ultima lettura ordini: ${itDateTime(data.last_poll_at)}` : ''}</div></div>
        <div className="row">
          <Field label="Cerca"><input placeholder="Codice o descrizione" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <Field label="Mostra"><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="STOCK">Con giacenza</option><option value="ALL">Tutti gli articoli</option><option value="NEW">Creati dal feed</option><option value="HIDDEN">Non visibili a nessuno</option></select></Field>
          <a className="btn ghost" href="/api/warehouse/import/template.xlsx"><Icon name="download" size={16} />Modello</a>
          <label className="btn ghost"><Icon name="upload" size={16} />Importa feed<input type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} /></label>
        </div>
      </div>
      <ErrorBox error={err} />
      {sel.size > 0 && <div className="alert info" style={{ marginBottom: 12 }}><div className="row"><b>{sel.size} selezionati:</b><button className="btn sm ghost" onClick={() => bulk('visible_all', true)}>Visibili a tutti</button><button className="btn sm ghost" onClick={() => bulk('visible_sedi', true)}>Visibili ai punti prelievo</button><button className="btn sm ghost" onClick={() => bulk('visible_service', true)}>Visibili ai Service</button><button className="btn sm danger" onClick={async () => { await bulk('visible_all', false); }}>Togli "tutti"</button><button className="btn sm link" onClick={() => setSel(new Set())}>Annulla selezione</button></div></div>}
      <Card flush>
        {!data ? <Loading /> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th><input type="checkbox" checked={rows.length > 0 && rows.every((r) => sel.has(r.article_id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.article_id)) : new Set())} /></th><th>Articolo</th><th>Codice Silva</th><th className="num">Giacenza magazzino</th><th className="num">Lotti</th><th>Prima scadenza</th><th title="Visibile a tutti">Tutti</th><th title="Punti prelievo e laboratorio">Punti prelievo</th><th title="Clienti Service">Service</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.article_id} className={!(r.visible_all || r.visible_sedi || r.visible_service) ? 'warnrow' : ''}>
                <td><input type="checkbox" checked={sel.has(r.article_id)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(r.article_id) : s.delete(r.article_id); setSel(s); }} /></td>
                <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><ProductArt icon={r.icon} color={r.color} size={30} /><div><div className="strong">{r.name}{r.source === 'SILVA' && <> <Badge tone="mauve">dal feed</Badge></>}</div><div className="small muted">{r.pack_label} · <span className="mono">{r.code}</span></div></div></div></td>
                <td className="mono small">{r.silva_code || <span className="muted">–</span>}</td>
                <td className="num strong">{dec(r.qty, 0)} <span className="small muted">{r.unit}</span></td>
                <td className="num">{r.lots}</td>
                <td className="small">{r.next_expiry ? itDate(r.next_expiry) : '–'}</td>
                <td><Chk r={r} k="visible_all" /></td><td><Chk r={r} k="visible_sedi" /></td><td><Chk r={r} k="visible_service" /></td>
                <td className="num"><button className="btn sm ghost" onClick={() => setDetail(r)}>Lotti</button></td>
              </tr>))}</tbody>
          </table>{!rows.length && <div className="empty">Nessun articolo per questo filtro</div>}</div>
        )}
      </Card>
      {data?.feeds?.length > 0 && (
        <Card title="Aggiornamenti ricevuti" className="mt" flush>
          <table className="t"><thead><tr><th>Quando</th><th>Origine</th><th className="num">Righe</th><th className="num">Articoli nuovi</th><th>Righe scartate</th></tr></thead>
            <tbody>{data.feeds.map((f) => <tr key={f.id}><td className="small">{itDateTime(f.received_at)}</td><td className="small">{f.source}</td><td className="num">{f.items}</td><td className="num">{f.new_articles}</td><td className="small red">{f.errors ? f.errors.slice(0, 3).join('; ') + (f.errors.length > 3 ? '…' : '') : ''}</td></tr>)}</tbody></table>
        </Card>
      )}
      {detail && (
        <Modal title={`${detail.name} · lotti in magazzino`} onClose={() => setDetail(null)}>
          {!detail.lot_detail?.length ? <div className="empty">Nessun lotto</div> : (
            <table className="t"><thead><tr><th>Lotto</th><th>Scadenza</th><th className="num">Quantità</th><th>Codice a barre</th></tr></thead>
              <tbody>{detail.lot_detail.map((l, i) => <tr key={i}><td className="mono">{l.lot || '–'}</td><td>{itDate(l.expiry) || '–'}</td><td className="num">{dec(l.qty, 0)}</td><td className="mono small">{l.barcode || '–'}</td></tr>)}</tbody></table>
          )}
        </Modal>
      )}
    </div>
  );
}
