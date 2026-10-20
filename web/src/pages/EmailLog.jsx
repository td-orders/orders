import React from 'react';
import { useApi, Loading, Empty, Card, Badge } from '../components/ui.jsx';
import { itDateTime } from '../format.js';

const TONE = { INVIATA: 'green', FALLITA: 'red', NON_CONFIGURATA: 'mauve', DUPLICATA: 'grey' };
export default function EmailLog() {
  const { data } = useApi('/email-log');
  return (
    <div className="page">
      <div className="page-head"><div><h1>Registro invii</h1><div className="sub">Comunicazioni generate dal sistema: nuovi ordini, approvazioni, solleciti, difformità, ordini al fornitore</div></div></div>
      <Card flush>
        {!data ? <Loading /> : !data.length ? <Empty>Nessun invio</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Quando</th><th>Tipo</th><th>Destinatario</th><th>Oggetto</th><th>Struttura</th><th>Esito</th></tr></thead>
            <tbody>{data.map((e) => <tr key={e.id}><td className="small muted" style={{ whiteSpace: 'nowrap' }}>{itDateTime(e.sent_at)}</td><td className="mono small">{e.kind}</td><td className="small">{e.to_addr}</td><td className="small">{e.subject}{e.attachment_name && <span className="muted"> · {e.attachment_name}</span>}</td><td className="small">{e.struttura_name}</td><td><Badge tone={TONE[e.status] || 'grey'}>{e.status}</Badge>{e.error && <div className="small red">{e.error}</div>}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
