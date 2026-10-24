import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Field, Loading, ErrorBox, Card, Badge, useToast } from '../components/ui.jsx';
import { itDateTime } from '../format.js';

export default function Settings() {
  const toast = useToast();
  const { data, reload } = useApi('/settings');
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [alertsRun, setAlertsRun] = useState(null);
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (!data || !s) return <div className="page"><Loading /></div>;
  const save = async () => { setErr(null); try { await api.put('/settings', s); toast('Impostazioni salvate'); reload(); } catch (e) { setErr(e); } };
  const Mode = ({ ok, label }) => <Badge tone={ok ? 'green' : 'mauve'}>{label}</Badge>;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Impostazioni</h1><div className="sub">Regole di riordino, solleciti automatici, stato delle integrazioni</div></div><button className="btn" onClick={save}>Salva</button></div>
      <ErrorBox error={err} />
      <div className="grid g2">
        <Card title="Ordine automatico delle sedi">
          <Field label="Formula di riordino">
            <select value={s.reorder_formula} onChange={(e) => setS({ ...s, reorder_formula: e.target.value })}>
              <option value="DIFF_X_FACTOR">(Produzione mensile − Giacenza reale) × fattore</option>
              <option value="TARGET_MINUS_STOCK">Produzione mensile × fattore − Giacenza</option>
            </select>
            <span className="help">Scelta di Francesco: la prima. Con giacenza pari alla produzione la prima ordina zero, la seconda ricostituisce la scorta obiettivo. Il fattore (default 1,5) si imposta per articolo nel catalogo. Il risultato è sempre arrotondato per eccesso a confezioni intere e mai negativo.</span>
          </Field>
          <Field label="Mesi di produzione per la media" className="mt"><input type="number" min="1" max="12" value={s.production_months} onChange={(e) => setS({ ...s, production_months: e.target.value })} style={{ width: 120 }} /><span className="help">Ultimo trimestre = 3</span></Field>
        </Card>
        <Card title="Solleciti automatici">
          <label className="f inline"><input type="checkbox" checked={s.alerts_enabled === 'true'} onChange={(e) => setS({ ...s, alerts_enabled: e.target.checked ? 'true' : 'false' })} />Attivi (giacenza mensile, ricezioni non confermate, ordini da verificare)</label>
          <div className="form-grid mt">
            <Field label="Ora del controllo"><input type="number" min="0" max="23" value={s.alert_hour} onChange={(e) => setS({ ...s, alert_hour: e.target.value })} /></Field>
            <Field label="Sollecito ricezione dopo (giorni)"><input type="number" min="1" value={s.receipt_reminder_days} onChange={(e) => setS({ ...s, receipt_reminder_days: e.target.value })} /></Field>
            <Field label="Riepilogo ordini da verificare dopo (giorni)"><input type="number" min="1" value={s.verify_reminder_days} onChange={(e) => setS({ ...s, verify_reminder_days: e.target.value })} /></Field>
          </div>
          <div className="row mt"><button className="btn ghost" onClick={async () => { setAlertsRun(await api.post('/alerts/run')); }}>Esegui ora il controllo</button>{alertsRun && <span className="small muted">Giacenze: {alertsRun.stock?.length || 0} · ricezioni: {alertsRun.receipt?.length || 0} · verifiche: {alertsRun.verify?.length || 0} invii</span>}</div>
        </Card>
        <Card title="Integrazioni">
          <table className="t"><tbody>
            <tr><td>Silva Group: API del magazzino (feed giacenze, ordini in polling, avanzamento)</td><td><Mode ok={data.silva.inboundConfigured} label={data.silva.inboundConfigured ? 'chiave attiva' : 'chiave mancante'} /></td><td className="small muted">{data.silva.inboundConfigured ? `Ultimo feed ${data.silva.last_feed_at ? itDateTime(data.silva.last_feed_at) : 'mai'} · ultima lettura ordini ${data.silva.last_poll_at ? itDateTime(data.silva.last_poll_at) : 'mai'}` : 'Impostare SILVA_INBOUND_KEY su Render e consegnarla al fornitore'}{data.silva.email ? ` · email di ripiego ${data.silva.email}` : ''}</td></tr>
            <tr><td>StudioLab ServiceNET: REST (X-API-KEY)</td><td><Mode ok={data.studiolab.configured} label={data.studiolab.configured ? 'collegato' : 'non configurato'} /></td><td className="small muted">{data.studiolab.configured ? `${data.studiolab.baseUrl} · CodiceCliente ${data.studiolab.clientCode}` : 'Impostare STUDIOLAB_API_KEY su Render'}</td></tr>
            <tr><td>StudioLab: HL7 in ingresso (produzione)</td><td><Mode ok={data.studiolab.inboundConfigured} label={data.studiolab.inboundConfigured ? 'chiave attiva' : 'chiave mancante'} /></td><td className="small muted">{data.studiolab.inboundConfigured ? `Ultimo messaggio ${data.studiolab.last_hl7_at ? itDateTime(data.studiolab.last_hl7_at) : 'mai'}` : 'Impostare STUDIOLAB_INBOUND_KEY e comunicare a CB Sistemi URL e chiave'}</td></tr>
            <tr><td>Microsoft 365: accesso</td><td><Mode ok={data.entra} label={data.entra ? 'attivo' : 'non configurato'} /></td><td className="small muted">Variabili ENTRA_* su Render</td></tr>
            <tr><td>Email</td><td><Mode ok={data.mail.configured} label={data.mail.mode || 'non configurata'} /></td><td className="small muted">{data.mail.from ? `Mittente ${data.mail.from}` : 'Gli invii restano registrati ma non partono'}</td></tr>
          </tbody></table>
          <div className="small muted mt">Endpoint per i fornitori: {data.baseUrl}/api/integrations/silva/… e {data.baseUrl}/api/integrations/studiolab/hl7. Chiavi e contratti nel README.</div>
        </Card>
        <Card title="Email di prova">
          <div className="row"><input type="email" placeholder="destinatario" value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ maxWidth: 320 }} /><button className="btn ghost" disabled={!testTo} onClick={async () => { const r = await api.post('/settings/test-email', { to: testTo }); toast(`Esito: ${r.status}${r.error ? ' · ' + r.error : ''}`, r.status === 'INVIATA' ? 'ok' : 'err'); }}>Invia</button></div>
          <div className="small muted mt">Indirizzo pubblico dell'app: {data.baseUrl}</div>
        </Card>
      </div>
    </div>
  );
}
