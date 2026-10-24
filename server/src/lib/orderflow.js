// Avanzamento dell'ordine nelle fasi 3, 4 e 5: usato sia dalle pagine dell'Area Operations sia dalle API del fornitore.
//   APPROVATO (in attesa del magazzino) -> PRESO_IN_CARICO -> SPEDITO -> CONSEGNATO -> [cliente Service: CHIUSO]
//   [struttura TD: CONSEGNATO -> carico nel magazzino interno -> IMMAGAZZINATO -> CHIUSO]
import { one, many, q, tx } from '../db.js';
import { bad, notFound } from './util.js';
import { sendMail, opsEmails } from './mailer.js';

export const ORDER_COLS = `o.*, s.name AS struttura_name, s.code AS struttura_code, s.kind AS struttura_kind, s.city AS struttura_city, s.email AS struttura_email,
  ru.full_name AS requested_by_name, au.full_name AS approved_by_name, cu.full_name AS received_by_name, ku.full_name AS closed_by_name, su.full_name AS stored_by_name,
  (SELECT count(*)::int FROM order_lines l WHERE l.order_id=o.id AND coalesce(l.qty_approved, l.qty_requested) > 0) AS lines_count,
  (SELECT coalesce(sum(coalesce(l.qty_approved, l.qty_requested)),0)::int FROM order_lines l WHERE l.order_id=o.id) AS packs_total,
  (SELECT count(*)::int FROM packages p WHERE p.order_id=o.id) AS packs_delivered,
  (SELECT count(*)::int FROM packages p WHERE p.order_id=o.id AND p.status IN ('RICEVUTO','IN_USO')) AS packs_received,
  (SELECT count(*)::int FROM packages p WHERE p.order_id=o.id AND p.status='ATTESO') AS packs_pending,
  (SELECT count(*)::int FROM issues i WHERE i.order_id=o.id AND i.status='APERTA') AS open_issues,
  (SELECT count(*)::int FROM order_lines l WHERE l.order_id=o.id AND l.delta_pct IS NOT NULL AND abs(l.delta_pct) > 50) AS anomalies`;
export const ORDER_JOINS = `FROM orders o JOIN strutture s ON s.id=o.struttura_id LEFT JOIN users ru ON ru.id=o.requested_by LEFT JOIN users au ON au.id=o.approved_by
  LEFT JOIN users cu ON cu.id=o.received_by LEFT JOIN users ku ON ku.id=o.closed_by LEFT JOIN users su ON su.id=o.stored_by`;

export async function event(orderId, userId, ev, data) {
  await q('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,$2,$3,$4)', [orderId, userId || null, ev, data ? JSON.stringify(data) : null]);
}
export async function byNumber(number) {
  const o = await one(`SELECT ${ORDER_COLS} ${ORDER_JOINS} WHERE o.number=$1`, [number]);
  if (!o) throw notFound(`Ordine ${number} non trovato`);
  return o;
}
export function assertStatus(order, ...allowed) {
  if (!allowed.includes(order.status)) throw bad(`Operazione non consentita nello stato "${order.status}"`);
}

/** Fase 3: il magazzino ha preso in carico l'ordine. */
export async function markPicked(order, { reference, userId, actor = 'Silva' } = {}) {
  assertStatus(order, 'APPROVATO');
  await q("UPDATE orders SET status='PRESO_IN_CARICO', picked_at=now(), silva_reference=coalesce($2, silva_reference), updated_at=now() WHERE id=$1", [order.id, reference || null]);
  await event(order.id, userId, `Preso in carico dal magazzino (${actor})`, { reference });
  return { status: 'PRESO_IN_CARICO' };
}

/** Fase 4: spedito. */
export async function markShipped(order, { ddt, userId, actor = 'Silva' } = {}) {
  assertStatus(order, 'APPROVATO', 'PRESO_IN_CARICO');
  await q("UPDATE orders SET status='SPEDITO', shipped_at=now(), picked_at=coalesce(picked_at, now()), ddt_number=coalesce($2, ddt_number), updated_at=now() WHERE id=$1", [order.id, ddt || null]);
  await event(order.id, userId, `Spedito dal magazzino (${actor})`, { ddt });
  return { status: 'SPEDITO' };
}

/**
 * Fase 4: consegnato. Crea una riga per ogni confezione consegnata: dalle righe comunicate dal fornitore (con lotto, scadenza,
 * codici a barre) oppure, in mancanza, dalle quantità approvate. Cliente Service: processo concluso (CHIUSO).
 * Struttura TD: resta CONSEGNATO fino al carico nel magazzino interno (fase 5).
 */
export async function markDelivered(order, { ddt, lines, userId, actor = 'Silva' } = {}) {
  assertStatus(order, 'APPROVATO', 'PRESO_IN_CARICO', 'SPEDITO');
  const olines = await many(`SELECT l.id, l.article_id, l.qty_approved, a.code AS article_code, a.silva_code, a.gtin FROM order_lines l JOIN articles a ON a.id=l.article_id WHERE l.order_id=$1`, [order.id]);
  const unknown = [];
  await tx(async (c) => {
    await c.query("DELETE FROM packages WHERE order_id=$1 AND status='ATTESO'", [order.id]);
    let n = 0;
    if (Array.isArray(lines) && lines.length) {
      for (const dl of lines) {
        const code = String(dl.codiceArticolo || dl.codice || dl.article_code || '').trim();
        const ol = olines.find((x) => x.article_code === code || (x.silva_code && x.silva_code === code) || (x.gtin && x.gtin === String(dl.gtin || '')));
        if (!ol) { unknown.push(code); continue; }
        const packs = Math.max(0, Math.round(Number(dl.confezioni ?? dl.packs ?? dl.quantita ?? 0)));
        const barcodes = Array.isArray(dl.barcodes) ? dl.barcodes : Array.isArray(dl.codiciBarre) ? dl.codiciBarre : [];
        const expiry = dl.scadenza || dl.expiry || null;
        for (let i = 1; i <= packs; i++) {
          await c.query(`INSERT INTO packages (struttura_id, article_id, order_id, line_id, seq, status, origin, lot, expiry, barcode) VALUES ($1,$2,$3,$4,$5,'ATTESO','ORDINE',$6,$7,$8)`,
            [order.struttura_id, ol.article_id, order.id, ol.id, i, dl.lotto || dl.lot || null, expiry ? String(expiry).slice(0, 10) : null, barcodes[i - 1] || null]);
          n++;
        }
        await c.query('UPDATE order_lines SET qty_delivered = coalesce(qty_delivered, 0) + $2 WHERE id=$1', [ol.id, packs]);
      }
    } else {
      for (const ol of olines) {
        for (let i = 1; i <= (ol.qty_approved || 0); i++) {
          await c.query(`INSERT INTO packages (struttura_id, article_id, order_id, line_id, seq, status, origin) VALUES ($1,$2,$3,$4,$5,'ATTESO','ORDINE')`, [order.struttura_id, ol.article_id, order.id, ol.id, i]);
          n++;
        }
        await c.query('UPDATE order_lines SET qty_delivered=$2 WHERE id=$1', [ol.id, ol.qty_approved || 0]);
      }
    }
    const isService = order.kind === 'CLIENTE';
    await c.query(`UPDATE orders SET status=$2, delivered_at=now(), shipped_at=coalesce(shipped_at, now()), picked_at=coalesce(picked_at, now()), ddt_number=coalesce($3, ddt_number),
      closed_at = CASE WHEN $2='CHIUSO' THEN now() ELSE closed_at END, updated_at=now() WHERE id=$1`, [order.id, isService ? 'CHIUSO' : 'CONSEGNATO', ddt || null]);
    if (isService) {
      // per il cliente Service il materiale consegnato è considerato in carico: le confezioni passano direttamente in giacenza
      await c.query("UPDATE packages SET status='RICEVUTO', received_at=now() WHERE order_id=$1 AND status='ATTESO'", [order.id]);
      await c.query(`UPDATE order_lines l SET qty_received = (SELECT count(*) FROM packages p WHERE p.line_id=l.id AND p.status IN ('RICEVUTO','IN_USO')) WHERE l.order_id=$1`, [order.id]);
    }
    await c.query('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,$2,$3,$4)', [order.id, userId || null, isService ? `Consegnato al cliente (${actor}): processo concluso` : `Consegnato alla struttura (${actor}): da caricare nel magazzino interno`, JSON.stringify({ ddt, packages: n, unknown })]);
  });
  if (order.struttura_email) {
    await sendMail({ kind: 'CONSEGNA', refKey: `CONSEGNA:${order.id}`, to: order.struttura_email, strutturaId: order.struttura_id, subject: `Ordine ${order.number} consegnato`, title: `Ordine ${order.number} consegnato`,
      body: order.kind === 'CLIENTE' ? `Il materiale dell'ordine ${order.number} risulta consegnato${ddt ? ` (DDT ${ddt})` : ''}. Eventuali difformità vanno segnalate in Orders Management entro 3 giorni lavorativi.` : `Il materiale dell'ordine ${order.number} risulta consegnato${ddt ? ` (DDT ${ddt})` : ''}. Caricatelo nel magazzino interno dalla pagina "Carico magazzino" leggendo i codici a barre delle confezioni.` });
  }
  return { status: order.kind === 'CLIENTE' ? 'CHIUSO' : 'CONSEGNATO', unknown };
}

/** Fase 5: carico nel magazzino interno completato dalla struttura TD. Le confezioni non lette diventano non ricevute e aprono una difformità. */
export async function markStored(order, { userId, note } = {}) {
  assertStatus(order, 'CONSEGNATO');
  const missing = await many(`SELECT p.id, a.name FROM packages p JOIN articles a ON a.id=p.article_id WHERE p.order_id=$1 AND p.status='ATTESO'`, [order.id]);
  const received = await one("SELECT count(*)::int AS n FROM packages WHERE order_id=$1 AND status='RICEVUTO'", [order.id]);
  if (!received.n && missing.length) throw bad('Nessuna confezione caricata: segnala la mancata consegna con una difformità invece di confermare');
  await tx(async (c) => {
    await c.query("UPDATE packages SET status='NON_RICEVUTO' WHERE order_id=$1 AND status='ATTESO'", [order.id]);
    await c.query(`UPDATE order_lines l SET qty_received = (SELECT count(*) FROM packages p WHERE p.line_id=l.id AND p.status IN ('RICEVUTO','IN_USO')) WHERE l.order_id=$1`, [order.id]);
    await c.query("UPDATE orders SET status='IMMAGAZZINATO', stored_at=now(), stored_by=$2, received_at=now(), received_by=$2, updated_at=now() WHERE id=$1", [order.id, userId || null]);
    if (missing.length) {
      const byName = {};
      for (const m of missing) byName[m.name] = (byName[m.name] || 0) + 1;
      await c.query("INSERT INTO issues (order_id, struttura_id, kind, description, opened_by) VALUES ($1,$2,'MANCANTE',$3,$4)", [order.id, order.struttura_id, `Confezioni non ricevute: ${Object.entries(byName).map(([n, k]) => `${n} x${k}`).join(', ')}.${note ? ' ' + note : ''}`, userId || null]);
    }
  });
  await event(order.id, userId, missing.length ? `Carico completato con ${missing.length} confezioni mancanti` : 'Carico nel magazzino interno completato', { missing: missing.length, note });
  const to = await opsEmails();
  if (to.length) await sendMail({ kind: 'CARICO', refKey: `CARICO:${order.id}`, to, strutturaId: order.struttura_id, subject: `Ordine ${order.number} caricato da ${order.struttura_name}${missing.length ? ` · ${missing.length} confezioni mancanti` : ''}`, title: `Carico magazzino ${order.number}`,
    body: missing.length ? `${order.struttura_name} ha caricato l'ordine ${order.number} segnalando ${missing.length} confezioni mancanti: è aperta una difformità.` : `${order.struttura_name} ha caricato per intero l'ordine ${order.number}. Puoi concludere il processo.` });
  return { status: 'IMMAGAZZINATO', missing: missing.length };
}
