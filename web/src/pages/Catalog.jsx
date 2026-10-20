import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, isOps } from '../auth.jsx';
import { useApi, Field, Loading, ErrorBox, Icon, useToast, Modal } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { num } from '../format.js';

// Catalogo a carrello (modello e-commerce): elenco chiuso del MOD252, grafica dell'oggetto, confezionamento, aggiunta al carrello.
export default function Catalog() {
  const { user } = useAuth();
  const ops = isOps(user);
  const nav = useNavigate();
  const toast = useToast();
  const [strutturaId, setStrutturaId] = useState('');
  const strutture = useApi(ops ? '/strutture' : null);
  const articles = useApi('/articles');
  const categories = useApi('/categories');
  const stock = useApi(ops ? (strutturaId ? `/stock?struttura_id=${strutturaId}` : null) : '/stock', [strutturaId]);
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState({});
  const [head, setHead] = useState({ notes: '', urgent: false, urgent_reason: '', client_ref: '' });
  const [err, setErr] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const stockMap = useMemo(() => new Map((stock.data?.rows || []).map((r) => [r.article_id, r])), [stock.data]);

  const list = (articles.data || []).filter((a) => (!cat || a.category_code === cat) && (!search || `${a.name} ${a.code}`.toLowerCase().includes(search.toLowerCase())));
  const items = Object.entries(cart).filter(([, q]) => q > 0).map(([id, q]) => ({ a: articles.data.find((x) => x.id === Number(id)), q }));
  const packs = items.reduce((s, x) => s + x.q, 0);
  const setQty = (id, q) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(999, Number(q) || 0)) }));

  const send = async (submit) => {
    setErr(null);
    try {
      const r = await api.post('/orders', { struttura_id: ops ? Number(strutturaId) : undefined, lines: items.map((x) => ({ article_id: x.a.id, qty: x.q })), submit, ...head });
      toast(submit ? 'Ordine inviato a Toscana Diagnostica' : 'Bozza salvata');
      nav(`/ordini/${r.id}`);
    } catch (e) { setErr(e); setConfirm(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Nuovo ordine</h1><div className="sub">Elenco chiuso del modulo TD-SGI-MOD252: aggiungi al carrello le confezioni che servono</div></div>
        {ops && <Field label="Ordine per conto della struttura"><select value={strutturaId} onChange={(e) => setStrutturaId(e.target.value)} style={{ minWidth: 280 }}><option value="">Scegli la struttura…</option>{(strutture.data || []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select></Field>}
      </div>
      <ErrorBox error={err} />
      <div className="catalog">
        <div>
          <div className="filters">
            <Field label="Cerca"><input placeholder="Nome o codice articolo" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
            <div className="chips">
              <button className={`chipbtn ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>Tutti</button>
              {(categories.data || []).map((c) => <button key={c.code} className={`chipbtn ${cat === c.code ? 'on' : ''}`} onClick={() => setCat(c.code)}>{c.name}</button>)}
            </div>
          </div>
          {!articles.data ? <Loading /> : (
            <div className="products">
              {list.map((a) => {
                const q = cart[a.id] || 0; const st = stockMap.get(a.id);
                return (
                  <div key={a.id} className={`product ${q ? 'in' : ''}`}>
                    <ProductArt icon={a.icon} color={a.color} size={84} />
                    <div className="pinfo">
                      <div className="pname">{a.name}</div>
                      <div className="pmeta">{a.pack_label} · {a.unit}</div>
                      <div className="pmeta mono">{a.code}{st && <span className="muted"> · in giacenza {num(st.packs)} conf.{st.prod_packs_avg ? ` · consumo ${st.prod_packs_avg.toLocaleString('it-IT', { maximumFractionDigits: 1 })}/mese` : ''}</span>}</div>
                    </div>
                    <div className="pqty">
                      {q ? <>
                        <button className="qbtn" onClick={() => setQty(a.id, q - 1)} aria-label="Meno">−</button>
                        <input inputMode="numeric" value={q} onChange={(e) => setQty(a.id, e.target.value)} />
                        <button className="qbtn" onClick={() => setQty(a.id, q + 1)} aria-label="Più">+</button>
                      </> : <button className="btn sm" onClick={() => setQty(a.id, 1)}><Icon name="cart" size={15} />Aggiungi</button>}
                    </div>
                  </div>
                );
              })}
              {!list.length && <div className="empty">Nessun articolo per questo filtro</div>}
            </div>
          )}
        </div>
        <aside className="cart side-col">
          <div className="card">
            <div className="hd"><h2>Carrello</h2><div className="spacer" /><span className="badge b-teal">{packs} conf.</span></div>
            <div className="bd">
              {!items.length ? <div className="empty">Il carrello è vuoto</div> : (
                <table className="t cartt"><tbody>
                  {items.map((x) => <tr key={x.a.id}><td><ProductArt icon={x.a.icon} color={x.a.color} size={30} /></td><td><div className="strong small">{x.a.name}</div><div className="small muted">{x.a.pack_label}</div></td><td className="num">{x.q}</td><td><button className="iconbtn" onClick={() => setQty(x.a.id, 0)} aria-label="Rimuovi"><Icon name="trash" size={15} /></button></td></tr>)}
                </tbody></table>
              )}
              <div className="form-grid" style={{ marginTop: 14, gridTemplateColumns: '1fr' }}>
                <Field label="Riferimento interno (facoltativo)"><input value={head.client_ref} onChange={(e) => setHead({ ...head, client_ref: e.target.value })} /></Field>
                <Field label="Note per la consegna"><textarea value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} style={{ minHeight: 60 }} /></Field>
                <label className="f inline"><input type="checkbox" checked={head.urgent} onChange={(e) => setHead({ ...head, urgent: e.target.checked })} />Richiesta urgente</label>
                {head.urgent && <Field label="Motivazione dell'urgenza (obbligatoria)"><input value={head.urgent_reason} onChange={(e) => setHead({ ...head, urgent_reason: e.target.value })} /></Field>}
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn ghost" disabled={!items.length || (ops && !strutturaId)} onClick={() => send(false)}>Salva bozza</button>
                <button className="btn" disabled={!items.length || (ops && !strutturaId) || (head.urgent && !head.urgent_reason)} onClick={() => setConfirm(true)}>Approva e invia</button>
              </div>
              <div className="small muted" style={{ marginTop: 10 }}>Le richieste ordinarie sono evase con il primo giro logistico utile, di norma entro 5 giorni lavorativi. Alla consegna va confermata la ricezione confezione per confezione.</div>
            </div>
          </div>
        </aside>
      </div>
      {confirm && (
        <Modal title="Approvi e invii l'ordine a Toscana Diagnostica?" onClose={() => setConfirm(false)} footer={<><button className="btn ghost" onClick={() => setConfirm(false)}>Annulla</button><button className="btn" onClick={() => send(true)}>Approva e invia</button></>}>
          <p>{packs} confezioni in {items.length} articoli{head.urgent ? ', con richiesta di urgenza' : ''}. L'Area Operations verifica le quantità rispetto alla tua produzione e trasmette l'ordine al magazzino.</p>
          <ul className="small">{items.map((x) => <li key={x.a.id}>{x.q} × {x.a.name} ({x.a.pack_label})</li>)}</ul>
        </Modal>
      )}
    </div>
  );
}
