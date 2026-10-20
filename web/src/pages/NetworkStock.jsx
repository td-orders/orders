import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, Loading, Empty, Card, Field, Icon } from '../components/ui.jsx';
import { KIND } from '../format.js';

// Scorte di tutta la rete (sedi e laboratorio): matrice struttura x articolo in confezioni
export default function NetworkStock() {
  const nav = useNavigate();
  const { data } = useApi('/stats/network-stock');
  const [cat, setCat] = useState('');
  const categories = useApi('/categories');
  const { cols, rows } = useMemo(() => {
    const arts = new Map(); const strs = new Map();
    for (const r of data || []) {
      if (cat && r.category_code !== cat) continue;
      arts.set(r.article_id, { id: r.article_id, name: r.article_name, code: r.article_code });
      const s = strs.get(r.struttura_id) || { id: r.struttura_id, name: r.struttura_name, kind: r.kind, cells: {}, total: 0 };
      s.cells[r.article_id] = r; s.total += r.packs; strs.set(r.struttura_id, s);
    }
    return { cols: [...arts.values()], rows: [...strs.values()] };
  }, [data, cat]);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Scorte della rete</h1><div className="sub">Confezioni in giacenza per struttura e articolo (tra parentesi quelle in arrivo). Clic sulla struttura per il dettaglio.</div></div>
        <div className="row"><Field label="Categoria"><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Tutte</option>{(categories.data || []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field><a className="btn ghost" href="/api/stats/export/stock.xlsx"><Icon name="download" size={16} />Excel</a></div>
      </div>
      <Card flush>
        {!data ? <Loading /> : !rows.length ? <Empty>Nessuna confezione in giacenza nella rete</Empty> : (
          <div className="table-wrap"><table className="t matrix">
            <thead><tr><th>Struttura</th><th className="num">Totale</th>{cols.map((c) => <th key={c.id} className="num" title={c.name}><div className="vert">{c.name}</div></th>)}</tr></thead>
            <tbody>{rows.map((s) => <tr key={s.id} className="click" onClick={() => nav(`/giacenza?struttura_id=${s.id}`)}><td><div className="strong">{s.name}</div><div className="small muted">{KIND[s.kind]}</div></td><td className="num strong">{s.total}</td>{cols.map((c) => { const x = s.cells[c.id]; return <td key={c.id} className={`num ${x?.packs === 0 ? 'muted' : ''}`}>{x ? <>{x.packs}{x.incoming ? <span className="small muted"> ({x.incoming})</span> : null}</> : <span className="muted">·</span>}</td>; })}</tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
