// Integrazione con Silva Group (gestore del magazzino di Toscana Diagnostica).
// Modello "il fornitore interroga noi" ogni 5 minuti con la chiave SILVA_INBOUND_KEY (header X-API-KEY):
//   POST /api/integrations/silva/stock                     feed delle giacenze di magazzino (articoli, lotti, scadenze, quantità)
//   GET  /api/integrations/silva/orders                    ordini approvati da preparare (contenuto, destinazione, urgenza)
//   POST /api/integrations/silva/orders/:numero/presa-in-carico | spedito | consegnato   avanzamento dell'ordine
// In subordine, l'Area Operations può inviare l'ordine in PDF alla casella SILVA_ORDER_EMAIL e registrare a mano gli avanzamenti.
import { config } from '../config.js';
import { sendMail } from './mailer.js';
import { itDate } from './util.js';

export const silvaStatus = () => ({ inboundConfigured: Boolean(config.silva.inboundKey), email: config.silva.email || null, customerCode: config.silva.customerCode });

// Ordine come lo legge il fornitore: una riga per articolo, quantità in confezioni e in unità, destinazione e urgenza
export function orderPayload(order, struttura, lines) {
  return {
    numero: order.number,
    cliente: config.silva.customerCode,
    dataApprovazione: order.approved_at ? new Date(order.approved_at).toISOString() : null,
    stato: order.status,
    urgenza: order.urgent ? 'URGENTE' : 'ORDINARIA',
    motivoUrgenza: order.urgent ? order.urgent_reason || null : null,
    tipoDestinatario: order.kind === 'CLIENTE' ? 'CLIENTE_SERVICE' : order.kind === 'SEDE' ? 'SEDE_TD' : 'LABORATORIO_TD',
    note: order.ops_notes || null,
    destinazione: {
      codice: struttura.code, nome: struttura.name, indirizzo: struttura.address, cap: struttura.zip, citta: struttura.city, provincia: struttura.province,
      referente: struttura.referente, telefono: struttura.referente_phone || struttura.phone, email: struttura.email, noteConsegna: struttura.delivery_notes,
      modalita: struttura.delivery_mode === 'RITIRO' ? 'RITIRO_PRESSO_TD' : 'CONSEGNA',
    },
    righe: lines.filter((l) => (l.qty_approved || 0) > 0).map((l) => ({
      codiceArticolo: l.article_code, codiceSilva: l.silva_code || null, gtin: l.gtin || null, descrizione: l.article_name,
      confezioni: l.qty_approved, confezione: l.pack_label, unitaPerConfezione: l.pack_size, unitaTotali: l.qty_approved * l.pack_size, unita: l.unit,
      noteOperations: l.note_ops || null,
    })),
  };
}

/** Ripiego: ordine PDF via email alla casella del fornitore. Ritorna l'esito del registro invii. */
export async function emailOrder({ order, struttura, lines, pdf }) {
  if (!config.silva.email) return { status: 'FALLITA', error: 'SILVA_ORDER_EMAIL non impostata' };
  const payload = orderPayload(order, struttura, lines);
  return sendMail({
    kind: 'ORDINE_FORNITORE', refKey: `SILVA:${order.id}:${Date.now()}`, to: config.silva.email, strutturaId: struttura.id,
    subject: `Ordine ${order.number}${order.urgent ? ' URGENTE' : ''} · consegna a ${struttura.name}`, title: `Ordine di materiale ${order.number}`,
    body: `In allegato l'ordine ${order.number} del ${itDate(payload.dataApprovazione)} da consegnare a ${struttura.name}, ${[struttura.address, struttura.zip, struttura.city].filter(Boolean).join(' ')}.\n\nRighe: ${payload.righe.length}. ${order.urgent ? 'Ordine urgente: ' + (order.urgent_reason || '') : 'Consegna con il primo giro utile.'}\n\nL'avanzamento (presa in carico, spedizione, consegna) va comunicato tramite le API di Orders Management.`,
    attachment: pdf ? { filename: `${order.number}.pdf`, content: pdf } : null,
  });
}
