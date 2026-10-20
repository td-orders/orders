// Adattatore Silva PortaleOrdini (fornitore esterno che gestisce il magazzino di Toscana Diagnostica).
// Tre modalità (SILVA_MODE): SIMULATO (default: nessuna chiamata, riferimento fittizio, flusso collaudabile),
// EMAIL (ordine in PDF su carta intestata inviato alla casella del fornitore SILVA_ORDER_EMAIL),
// API (POST verso SILVA_API_URL con SILVA_API_KEY: contratto IPOTIZZATO, da allineare alla documentazione del portale).
// L'ordine trasmesso viene comunque archiviato con il payload inviato (orders.silva_payload) per la tracciabilità.
import { config } from '../config.js';
import { sendMail } from './mailer.js';
import { itDate } from './util.js';

export const silvaStatus = () => ({
  mode: config.silva.mode,
  configured: config.silva.mode === 'SIMULATO' || (config.silva.mode === 'EMAIL' ? Boolean(config.silva.email) : Boolean(config.silva.baseUrl && config.silva.apiKey)),
  email: config.silva.email || null,
});

// Payload dell'ordine verso il fornitore: una riga per articolo con quantità in confezioni e in unità
export function buildPayload(order, struttura, lines) {
  return {
    customerCode: config.silva.customerCode || 'TOSCANA-DIAGNOSTICA',
    orderNumber: order.number,
    orderDate: new Date(order.approved_at || Date.now()).toISOString().slice(0, 10),
    urgent: Boolean(order.urgent),
    notes: [order.ops_notes, order.urgent ? `URGENTE: ${order.urgent_reason || ''}` : null].filter(Boolean).join(' · ') || null,
    deliverTo: {
      code: struttura.code, name: struttura.name, address: struttura.address, zip: struttura.zip, city: struttura.city, province: struttura.province,
      contact: struttura.referente, phone: struttura.referente_phone || struttura.phone, email: struttura.email, notes: struttura.delivery_notes,
      mode: struttura.delivery_mode,
    },
    lines: lines.filter((l) => (l.qty_approved || 0) > 0).map((l) => ({
      articleCode: l.article_code, description: l.article_name, packs: l.qty_approved, packLabel: l.pack_label, units: l.qty_approved * l.pack_size, unit: l.unit, gtin: l.gtin || null,
    })),
  };
}

/** Trasmette l'ordine. Ritorna { mode, reference, status, error }. Non lancia: l'esito si registra sull'ordine. */
export async function transmit({ order, struttura, lines, pdf }) {
  const payload = buildPayload(order, struttura, lines);
  const mode = config.silva.mode;
  if (mode === 'SIMULATO') {
    return { mode, reference: `SIM-${order.number}`, status: 'OK', payload };
  }
  if (mode === 'EMAIL') {
    if (!config.silva.email) return { mode, status: 'ERRORE', error: 'SILVA_ORDER_EMAIL non impostata', payload };
    const r = await sendMail({
      kind: 'ORDINE_FORNITORE', refKey: `SILVA:${order.id}:${Date.now()}`, to: config.silva.email, strutturaId: struttura.id,
      subject: `Ordine ${order.number}${order.urgent ? ' URGENTE' : ''} · consegna a ${struttura.name}`,
      title: `Ordine di materiale ${order.number}`,
      body: `In allegato l'ordine ${order.number} del ${itDate(payload.orderDate)} da consegnare a ${struttura.name}, ${[struttura.address, struttura.zip, struttura.city].filter(Boolean).join(' ')}.\n\nRighe: ${payload.lines.length}. ${order.urgent ? 'Ordine urgente: ' + (order.urgent_reason || '') : 'Consegna con il primo giro utile.'}`,
      attachment: pdf ? { filename: `${order.number}.pdf`, content: pdf } : null,
    });
    return r.status === 'INVIATA' ? { mode, reference: `EMAIL-${r.id}`, status: 'OK', payload } : { mode, status: 'ERRORE', error: r.error || r.status, payload };
  }
  // API: contratto ipotizzato
  try {
    const res = await fetch(`${config.silva.baseUrl.replace(/\/$/, '')}/api/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.silva.apiKey}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { mode, status: 'ERRORE', error: `Silva ${res.status}: ${j.message || j.error || 'errore'}`, payload };
    return { mode, reference: String(j.orderId || j.reference || j.id || ''), status: 'OK', payload };
  } catch (e) { return { mode, status: 'ERRORE', error: e.message, payload }; }
}
