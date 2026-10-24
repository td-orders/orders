// Solleciti automatici: giacenza mensile non inserita (sedi entro il 15, laboratorio entro il 30), ordini trasmessi senza conferma
// di ricezione, ordini inviati in attesa di verifica. Gira una volta al giorno all'ora impostata (Europe/Rome).
import { many, one, q } from '../db.js';
import { sendMail, opsEmails } from './mailer.js';
import { getSetting, itDate, todayRome } from './util.js';

// Strutture (sedi e laboratorio) senza giacenza confermata per il mese
export async function pendingStockCounts(month) {
  return many(`SELECT s.id, s.name, s.code, s.kind, s.email, s.stock_deadline_day, c.status AS count_status, c.id AS count_id
    FROM strutture s LEFT JOIN stock_counts c ON c.struttura_id=s.id AND c.month=$1::date
    WHERE s.active AND s.kind IN ('SEDE','LAB') AND (c.id IS NULL OR c.status <> 'CONFERMATO') ORDER BY s.kind, s.name`, [`${month}-01`]);
}

export async function runDailyAlerts({ force = false } = {}) {
  const enabled = (await getSetting('alerts_enabled', 'true')) === 'true';
  const hour = Number(await getSetting('alert_hour', '9'));
  const today = todayRome();
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()));
  const last = await getSetting('alerts_last_run', '');
  if (!force && (!enabled || nowHour < hour || last === today)) return null;
  const day = Number(today.slice(8, 10));
  const month = today.slice(0, 7);
  const results = { stock: [], receipt: [], verify: [] };

  // 1. Giacenza mensile: promemoria 3 giorni prima della scadenza e sollecito dal giorno dopo
  for (const s of await pendingStockCounts(month)) {
    const dl = s.stock_deadline_day;
    const kind = day === dl - 3 ? 'PROMEMORIA' : day > dl ? 'SOLLECITO' : null;
    if (!kind || !s.email) continue;
    const refKey = `GIACENZA_${kind}:${s.id}:${month}${kind === 'SOLLECITO' ? ':' + today : ''}`;
    if (kind === 'SOLLECITO' && (day - dl) % 3 !== 1) continue; // ogni 3 giorni
    results.stock.push({ struttura: s.name, ...(await sendMail({ kind: `GIACENZA_${kind}`, refKey, to: s.email, strutturaId: s.id,
      subject: `${kind === 'PROMEMORIA' ? 'Promemoria' : 'Sollecito'}: giacenza di ${month} da inserire entro il ${dl}`, title: 'Giacenza mensile del materiale',
      body: kind === 'PROMEMORIA' ? `Entro il giorno ${dl} va inserita e confermata in Orders Management la giacenza del materiale di ${s.name} per il mese ${month}.${s.count_status === 'BOZZA' ? ' La bozza è già aperta: completala e confermala.' : ''}` : `La giacenza di ${month} per ${s.name} non risulta confermata: la scadenza era il giorno ${dl}. Inseritela oggi in Orders Management, altrimenti l'ordine mensile non può partire.` })) });
  }
  // 2. Ordini trasmessi da oltre N giorni senza conferma di ricezione
  const rDays = Number(await getSetting('receipt_reminder_days', '5'));
  for (const o of await many(`SELECT o.id, o.number, o.delivered_at AS transmitted_at, s.name, s.email, s.id AS sid FROM orders o JOIN strutture s ON s.id=o.struttura_id WHERE o.status='CONSEGNATO' AND o.delivered_at < now() - ($1 || ' days')::interval`, [rDays])) {
    if (!o.email) continue;
    results.receipt.push({ order: o.number, ...(await sendMail({ kind: 'SOLLECITO_RICEZIONE', refKey: `RICEZIONE_SOLLECITO:${o.id}:${today}`, to: o.email, strutturaId: o.sid,
      subject: `Ordine ${o.number}: caricare il materiale consegnato nel magazzino interno`, title: 'Carico magazzino mancante',
      body: `L'ordine ${o.number} risulta consegnato il ${itDate(o.transmitted_at)} e non ancora caricato nel magazzino interno. Dalla pagina Carico magazzino leggete i codici a barre delle confezioni e confermate. Se il materiale non è arrivato, segnalatelo con una difformità.` })) });
  }
  // 3. Ordini in attesa di verifica da oltre N giorni: riepilogo all'Area Operations
  const vDays = Number(await getSetting('verify_reminder_days', '2'));
  const waiting = await many(`SELECT o.number, o.urgent, o.submitted_at, s.name FROM orders o JOIN strutture s ON s.id=o.struttura_id WHERE o.status='INVIATO' AND o.submitted_at < now() - ($1 || ' days')::interval ORDER BY o.urgent DESC, o.submitted_at`, [vDays]);
  const to = await opsEmails();
  if (waiting.length && to.length) {
    results.verify.push(await sendMail({ kind: 'RIEPILOGO_OPS', refKey: `RIEPILOGO_OPS:${today}`, to,
      subject: `${waiting.length} ordini in attesa di verifica da oltre ${vDays} giorni`, title: 'Ordini da verificare',
      body: waiting.map((w) => `• ${w.number}${w.urgent ? ' URGENTE' : ''} · ${w.name} · inviato il ${itDate(w.submitted_at)}`).join('\n') }));
  }
  await q("INSERT INTO app_settings (key, value) VALUES ('alerts_last_run', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [today]);
  return { date: today, ...results };
}

export function startScheduler() {
  const tick = () => runDailyAlerts().catch((e) => console.error('[alerts]', e.message));
  setTimeout(tick, 30_000);
  setInterval(tick, 15 * 60 * 1000);
}

export { one };
