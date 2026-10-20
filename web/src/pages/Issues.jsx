import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth, isOps } from '../auth.jsx';
import { useApi, Loading, Empty, Card, Badge, PromptModal, useToast } from '../components/ui.jsx';
import { itDateTime, ISSUE_KIND } from '../format.js';

export default function Issues() {
  const { user } = useAuth();
  const ops = isOps(user);
  const toast = useToast();
  const [status, setStatus] = useState('APERTA');
  const [closing, setClosing] = useState(null);
  const { data, reload } = useApi(`/stock/issues${qs({ status })}`, [status]);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Difformità</h1><div className="sub">Mancanze, danni ed errori segnalati alla ricezione del materiale, con la risposta dell'Area Operations</div></div></div>
      <div className="tabs"><button className={status === 'APERTA' ? 'on' : ''} onClick={() => setStatus('APERTA')}>Aperte</button><button className={status === 'CHIUSA' ? 'on' : ''} onClick={() => setStatus('CHIUSA')}>Gestite</button></div>
      <Card flush>
        {!data ? <Loading /> : !data.length ? <Empty>Nessuna difformità {status === 'APERTA' ? 'aperta' : 'gestita'}</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Quando</th>{ops && <th>Struttura</th>}<th>Ordine</th><th>Tipo</th><th>Descrizione</th>{status === 'CHIUSA' && <th>Risposta</th>}{ops && status === 'APERTA' && <th />}</tr></thead>
            <tbody>{data.map((i) => (
              <tr key={i.id}>
                <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{itDateTime(i.opened_at)}<div>{i.opened_by_name}</div></td>
                {ops && <td>{i.struttura_name}</td>}
                <td>{i.order_id ? <Link to={`/ordini/${i.order_id}`} className="mono">{i.order_number}</Link> : '–'}</td>
                <td><Badge tone={i.kind === 'MANCANTE' ? 'red' : 'mauve'}>{ISSUE_KIND[i.kind]}</Badge></td>
                <td>{i.description}</td>
                {status === 'CHIUSA' && <td className="small">{i.response}</td>}
                {ops && status === 'APERTA' && <td className="num"><button className="btn sm" onClick={() => setClosing(i)}>Gestisci</button></td>}
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      {closing && <PromptModal title={`Difformità su ${closing.order_number || closing.struttura_name}`} label="Risposta alla struttura (inviata via email)" confirmText="Chiudi difformità" onClose={() => setClosing(null)} onConfirm={async (response) => { await api.post(`/stock/issues/${closing.id}/close`, { response }); toast('Difformità chiusa'); reload(); }} />}
    </div>
  );
}
