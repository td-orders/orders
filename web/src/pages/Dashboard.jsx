import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAuth, isOps } from '../auth.jsx';
import { useApi, Loading, Card, Kpi, StatusBadge, Badge, Icon } from '../components/ui.jsx';
import { itDateTime, monthLabel, STATUS, KIND, today } from '../format.js';

export default function Dashboard() {
  const { user } = useAuth();
  const ops = isOps(user);
  const nav = useNavigate();
  const { data: d } = useApi('/stats/dashboard');
  if (!d) return <div className="page"><Loading /></div>;
  const n = (s) => d.byStatus.find((x) => x.status === s)?.n || 0;
  const urgent = d.byStatus.reduce((s, x) => s + x.urgent, 0);
  const day = Number(today().slice(8, 10));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Cruscotto</h1><div className="sub">{ops ? 'Filiera degli ordini: verifiche, consegne, giacenze della rete' : `${user.struttura_name}: ordini, materiale e scadenze`}</div></div>
        <div className="row">
          {(ops || user.struttura_kind === 'CLIENTE') && <button className="btn" onClick={() => nav('/catalogo')}><Icon name="cart" size={16} />Nuovo ordine</button>}
          {!ops && user.struttura_kind !== 'CLIENTE' && <button className="btn" onClick={() => nav('/giacenze')}><Icon name="check" size={16} />Giacenza mensile</button>}
        </div>
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        {ops ? <>
          <Kpi label="Da verificare" value={n('INVIATO')} foot={urgent ? `${urgent} urgenti` : 'ordini inviati dalle strutture'} accent />
          <Kpi label="In consegna" value={n('TRASMESSO') + n('APPROVATO')} foot="trasmessi al magazzino" />
          <Kpi label="Ricevuti da chiudere" value={n('CONSEGNATO')} foot="ricezione confermata" />
          <Kpi label="Difformità aperte" value={d.openIssues} foot={`${d.pendingCounts?.length || 0} giacenze mensili mancanti`} />
        </> : <>
          <Kpi label="Confezioni in giacenza" value={d.stock.packs} foot={d.stock.expiring ? `${d.stock.expiring} in scadenza entro 60 giorni` : 'nessuna in scadenza a 60 giorni'} accent />
          <Kpi label="In arrivo" value={d.stock.incoming} foot={`${d.toReceive.length} ordini da ricevere`} />
          <Kpi label="In uso questo mese" value={d.stock.used_month} foot="confezioni messe in uso" />
          {d.stockCount ? <Kpi label={`Giacenza di ${monthLabel(d.stockCount.month)}`} value={d.stockCount.status === 'CONFERMATO' ? 'Confermata' : d.stockCount.status === 'BOZZA' ? 'Bozza' : 'Da inserire'} foot={d.stockCount.status === 'CONFERMATO' ? 'ordine del mese generato' : day > d.stockCount.deadline ? `scadenza del ${d.stockCount.deadline} superata` : `entro il giorno ${d.stockCount.deadline}`} /> : <Kpi label="Ordini aperti" value={d.byStatus.reduce((s, x) => s + x.n, 0)} foot={`${d.openIssues} difformità aperte`} />}
        </>}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <div>
          {!ops && d.toReceive.length > 0 && (
            <div className="alert warn" style={{ marginBottom: 16 }}><Icon name="truck" size={18} /><div>Materiale in consegna: {d.toReceive.map((o) => <Link key={o.id} to={`/ordini/${o.id}`} style={{ marginRight: 8 }}>{o.number}</Link>)}. Alla consegna conferma la ricezione confezione per confezione.</div></div>
          )}
          {!ops && d.stockCount && d.stockCount.status !== 'CONFERMATO' && day > d.stockCount.deadline - 4 && (
            <div className="alert err" style={{ marginBottom: 16 }}><Icon name="alert" size={18} /><div>Giacenza di {monthLabel(d.stockCount.month)} da {d.stockCount.status === 'BOZZA' ? 'completare e confermare' : 'inserire'} entro il giorno {d.stockCount.deadline}. <Link to="/giacenze">Apri la giacenza</Link></div></div>
          )}
          <Card title="Ultimi movimenti" flush>
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Ordine</th>{ops && <th>Struttura</th>}<th>Stato</th><th className="num">Confezioni</th><th>Aggiornato</th></tr></thead>
              <tbody>{d.recent.map((o) => <tr key={o.id} className="click" onClick={() => nav(`/ordini/${o.id}`)}><td><span className="mono strong">{o.number}</span>{o.urgent && <> <Badge tone="red">Urgente</Badge></>}{o.anomalies > 0 && <> <Badge tone="mauve">{o.anomalies} scostamenti</Badge></>}</td>{ops && <td>{o.struttura_name}<div className="small muted">{KIND[o.kind]}</div></td>}<td><StatusBadge status={o.status} /></td><td className="num">{o.packs_total}</td><td className="small muted">{itDateTime(o.updated_at)}</td></tr>)}</tbody>
            </table></div>
            {!d.recent.length && <div className="empty">Nessun ordine ancora</div>}
          </Card>
          {ops && d.pendingCounts?.length > 0 && (
            <Card title={`Giacenze di ${monthLabel(d.month)} non confermate`} className="mt">
              <div className="row">{d.pendingCounts.map((p) => <span key={p.id} className="chip" title={`entro il ${p.stock_deadline_day}`}>{p.name}{day > p.stock_deadline_day ? ' · in ritardo' : ''}{p.count_status === 'BOZZA' ? ' · bozza' : ''}</span>)}</div>
            </Card>
          )}
          {ops && d.lowStock?.length > 0 && (
            <Card title="Scorte sotto soglia nella rete" className="mt" flush>
              <div className="table-wrap"><table className="t"><thead><tr><th>Struttura</th><th>Articolo</th><th className="num">In giacenza</th><th className="num">Soglia</th></tr></thead>
                <tbody>{d.lowStock.map((x, i) => <tr key={i} className="click" onClick={() => nav(`/giacenza?struttura_id=${x.struttura_id}`)}><td>{x.struttura_name}</td><td>{x.article_name}</td><td className="num red strong">{x.packs}</td><td className="num muted">{x.min_stock_packs}</td></tr>)}</tbody></table></div>
            </Card>
          )}
        </div>
        <div>
          <Card title="Ordini per stato">
            <div className="row" style={{ gap: 8 }}>{Object.entries(STATUS).filter(([k]) => !['CHIUSO', 'ANNULLATO'].includes(k)).map(([k, v]) => <div key={k} className="statbox"><div className="small muted">{v.label}</div><div className="strong" style={{ fontSize: 20 }}>{n(k)}</div></div>)}</div>
          </Card>
          <Card title="Confezioni ordinate per mese" className="mt">
            {d.monthly.length ? (
              <div style={{ height: 200 }}>
                <ResponsiveContainer><BarChart data={d.monthly.map((m) => ({ ...m, label: m.m.slice(5) + '/' + m.m.slice(2, 4) }))}>
                  <CartesianGrid vertical={false} stroke="#e3ebec" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={34} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v, k) => [v, k === 'packs' ? 'Confezioni' : 'Ordini']} /><Bar dataKey="packs" fill="#1C505E" radius={[4, 4, 0, 0]} />
                </BarChart></ResponsiveContainer>
              </div>
            ) : <div className="empty">Nessun dato</div>}
          </Card>
          {ops && d.topArticles?.length > 0 && (
            <Card title="Articoli più ordinati (3 mesi)" className="mt" flush>
              <table className="t"><tbody>{d.topArticles.map((a) => <tr key={a.code}><td>{a.name}</td><td className="num strong">{a.packs}</td></tr>)}</tbody></table>
            </Card>
          )}
          {ops && d.strutture && <Card title="Rete" className="mt"><div className="row"><div className="statbox"><div className="small muted">Clienti Service</div><div className="strong" style={{ fontSize: 20 }}>{d.strutture.clienti}</div></div><div className="statbox"><div className="small muted">Sedi</div><div className="strong" style={{ fontSize: 20 }}>{d.strutture.sedi}</div></div><div className="statbox"><div className="small muted">Laboratorio</div><div className="strong" style={{ fontSize: 20 }}>{d.strutture.lab}</div></div></div></Card>}
        </div>
      </div>
    </div>
  );
}
