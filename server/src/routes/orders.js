import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse, itDate } from '../lib/util.js';
import { requireRole, isOps, Params, assertStruttura, OPS_ROLES } from '../lib/access.js';
import { nextOrderNumber, orderLines, enrichLines, assertStatus, ARTICLE_COLS } from '../lib/orders.js';
import { emailOrder } from '../lib/silva.js';
import { ORDER_COLS, ORDER_JOINS as JOINS, event, markPicked, markShipped, markDelivered, markStored } from '../lib/orderflow.js';
import { buildOrderPdf } from '../pdf/order.js';
import { sendMail, opsEmails } from '../lib/mailer.js';

const r = Router();
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const lineSchema = z.array(z.object({ article_id: z.coerce.number().int(), qty: z.coerce.number().int().min(0).max(9999), note: opt(z.string().max(300)) })).max(200);
const headSchema = { notes: opt(z.string().max(1000)), urgent: z.boolean().optional(), urgent_reason: opt(z.string().max(300)), client_ref: opt(z.string().max(60)) };

async function loadOrder(req, id) {
  const o = await one(`SELECT ${ORDER_COLS} ${JOINS} WHERE o.id=$1`, [id]);
  if (!o) throw notFound('Ordine non trovato');
  if (!isOps(req.user) && o.struttura_id !== req.user.struttura_id) throw forbidden('Ordine non autorizzato');
  return o;
}
async function saveLines(client, orderId, lines) {
  await client.query('DELETE FROM order_lines WHERE order_id=$1', [orderId]);
  const ids = [...new Set(lines.map((l) => l.article_id))];
  const arts = (await client.query('SELECT id, active FROM articles WHERE id = ANY($1)', [ids])).rows;
  for (const l of lines) {
    if (!l.qty) continue;
    const a = arts.find((x) => x.id === l.article_id);
    if (!a || !a.active) throw bad(`Articolo ${l.article_id} non disponibile`);
    await client.query('INSERT INTO order_lines (order_id, article_id, qty_requested, note_client) VALUES ($1,$2,$3,$4)', [orderId, l.article_id, l.qty, l.note || null]);
  }
}
async function fullDetail(req, id) {
  const o = await loadOrder(req, id);
  o.lines = await orderLines(id);
  o.events = await many('SELECT e.*, u.full_name FROM order_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.order_id=$1 ORDER BY e.at', [id]);
  o.packages = await many(`SELECT p.id, p.line_id, p.article_id, p.seq, p.status, p.barcode, p.lot, p.expiry, p.received_at, p.used_at, a.code AS article_code, a.name AS article_name, a.pack_label, a.color, a.gtin
    FROM packages p JOIN articles a ON a.id=p.article_id WHERE p.order_id=$1 ORDER BY a.sort, p.seq`, [id]);
  o.issues = await many('SELECT i.*, u.full_name AS opened_by_name, c.full_name AS closed_by_name FROM issues i LEFT JOIN users u ON u.id=i.opened_by LEFT JOIN users c ON c.id=i.closed_by WHERE i.order_id=$1 ORDER BY i.opened_at', [id]);
  o.struttura = await one('SELECT * FROM strutture WHERE id=$1', [o.struttura_id]);
  return o;
}

// ---------------- Elenco e dettaglio ----------------
r.get('/', ah(async (req, res) => {
  const P = new Params();
  const where = [isOps(req.user) ? 'TRUE' : `o.struttura_id=${P.add(req.user.struttura_id)}`];
  if (req.query.status) where.push(`o.status = ANY(${P.add(String(req.query.status).split(','))}::text[])`);
  if (req.query.kind) where.push(`o.kind=${P.add(req.query.kind)}`);
  if (req.query.struttura_id) where.push(`o.struttura_id=${P.add(Number(req.query.struttura_id))}`);
  if (req.query.month) where.push(`to_char(o.created_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM')=${P.add(req.query.month)}`);
  const rows = await many(`SELECT ${ORDER_COLS} ${JOINS} WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 500`, P.values);
  res.json(rows.map(({ pdf, silva_payload, ...o }) => o));
}));

r.get('/:id', ah(async (req, res) => {
  const o = await fullDetail(req, req.params.id);
  delete o.pdf;
  res.json(o);
}));

// ---------------- Creazione (carrello) ----------------
r.post('/', ah(async (req, res) => {
  const d = parse(z.object({ struttura_id: opt(z.coerce.number().int()), lines: lineSchema, submit: z.boolean().optional(), ...headSchema }), req.body);
  const strutturaId = isOps(req.user) ? d.struttura_id : req.user.struttura_id;
  if (!strutturaId) throw bad('Struttura obbligatoria');
  const s = await assertStruttura(req.user, strutturaId);
  if (!s.active) throw bad('Struttura disattivata');
  if (d.urgent && !d.urgent_reason) throw bad('Motivare la richiesta urgente');
  if (!d.lines.some((l) => l.qty > 0)) throw bad('Il carrello è vuoto');
  const origin = isOps(req.user) ? 'OPERATIONS' : 'CLIENTE';
  const id = await tx(async (c) => {
    const number = await nextOrderNumber(c);
    const row = await c.query(`INSERT INTO orders (number, struttura_id, kind, origin, status, urgent, urgent_reason, notes, client_ref, requested_by)
      VALUES ($1,$2,$3,$4,'BOZZA',$5,$6,$7,$8,$9) RETURNING id`, [number, s.id, s.kind, origin, Boolean(d.urgent), d.urgent_reason, d.notes, d.client_ref, req.user.id]);
    await saveLines(c, row.rows[0].id, d.lines);
    return row.rows[0].id;
  });
  await event(id, req.user.id, 'Creato');
  await audit(req, 'ORDER_CREATE', 'order', id, { struttura: s.code, lines: d.lines.length });
  if (d.submit) await submit(req, id);
  res.status(201).json({ id });
}));

r.put('/:id', ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  assertStatus(o, 'BOZZA');
  const d = parse(z.object({ lines: lineSchema, ...headSchema }), req.body);
  if (d.urgent && !d.urgent_reason) throw bad('Motivare la richiesta urgente');
  await tx(async (c) => {
    await c.query('UPDATE orders SET urgent=$2, urgent_reason=$3, notes=$4, client_ref=$5, updated_at=now() WHERE id=$1', [o.id, Boolean(d.urgent), d.urgent_reason, d.notes, d.client_ref]);
    await saveLines(c, o.id, d.lines);
  });
  res.json({ ok: true });
}));

async function submit(req, id) {
  const o = await loadOrder(req, id);
  assertStatus(o, 'BOZZA');
  const n = await one('SELECT count(*)::int AS n FROM order_lines WHERE order_id=$1 AND qty_requested>0', [id]);
  if (!n.n) throw bad('Nessuna riga con quantità');
  const { months } = await enrichLines(id, o.struttura_id, o.kind);
  await q('UPDATE orders SET status=$2, submitted_at=now(), updated_at=now() WHERE id=$1', [id, 'INVIATO']);
  await event(id, req.user.id, 'Inviato a Toscana Diagnostica', { production_months: months });
  await audit(req, 'ORDER_SUBMIT', 'order', id);
  const to = await opsEmails();
  if (to.length) await sendMail({ kind: 'NUOVO_ORDINE', refKey: `NUOVO:${id}`, to, strutturaId: o.struttura_id, subject: `Nuovo ordine ${o.number}${o.urgent ? ' URGENTE' : ''} · ${o.struttura_name}`, title: `Ordine ${o.number} da verificare`,
    body: `${o.struttura_name} ha inviato l'ordine ${o.number}${o.urgent ? ' con richiesta di urgenza: ' + (o.urgent_reason || '') : ''}.\n\nVerificalo in Orders Management: confronto con la produzione media e quantità da approvare.` });
}
r.post('/:id/submit', ah(async (req, res) => { await submit(req, req.params.id); res.json({ ok: true }); }));

// ---------------- Verifica e approvazione (Area Operations) ----------------
r.post('/:id/refresh-production', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  assertStatus(o, 'INVIATO', 'BOZZA');
  const info = await enrichLines(o.id, o.struttura_id, o.kind);
  res.json(info);
}));

r.post('/:id/verify', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  assertStatus(o, 'INVIATO', 'BOZZA');
  const d = parse(z.object({ lines: z.array(z.object({ id: z.coerce.number().int(), qty_approved: z.coerce.number().int().min(0).max(9999), note_ops: opt(z.string().max(300)) })), ops_notes: opt(z.string().max(1000)), approve: z.boolean().optional() }), req.body);
  await tx(async (c) => {
    for (const l of d.lines) await c.query('UPDATE order_lines SET qty_approved=$2, note_ops=$3 WHERE id=$1 AND order_id=$4', [l.id, l.qty_approved, l.note_ops, o.id]);
    await c.query('UPDATE orders SET ops_notes=$2, updated_at=now() WHERE id=$1', [o.id, d.ops_notes]);
  });
  await audit(req, 'ORDER_VERIFY', 'order', o.id, { lines: d.lines.length });
  if (d.approve) return res.json(await approve(req, o.id));
  res.json({ ok: true });
}));

async function approve(req, id) {
  const o = await loadOrder(req, id);
  assertStatus(o, 'INVIATO', 'BOZZA');
  const n = await one('SELECT coalesce(sum(coalesce(qty_approved, qty_requested)),0)::int AS n FROM order_lines WHERE order_id=$1', [id]);
  if (!n.n) throw bad('Nessuna quantità approvata: annulla l\'ordine invece di approvarlo');
  if (o.kind === 'LAB' && o.status === 'BOZZA') await enrichLines(id, o.struttura_id, o.kind);
  await tx(async (c) => {
    await c.query("UPDATE order_lines SET qty_approved = coalesce(qty_approved, qty_requested) WHERE order_id=$1", [id]);
    await c.query("UPDATE orders SET status='APPROVATO', approved_by=$2, approved_at=now(), submitted_at=coalesce(submitted_at, now()), updated_at=now() WHERE id=$1", [id, req.user.id]);
  });
  await event(id, req.user.id, 'Approvato dall\'Area Operations: in attesa del magazzino', { packs: n.n });
  await audit(req, 'ORDER_APPROVE', 'order', id);
  // PDF archiviato sull'ordine e inviato alla struttura
  const full = await fullDetail(req, id);
  const company = await one('SELECT * FROM company LIMIT 1');
  const cats = await many('SELECT code, name FROM categories');
  const lines = full.lines.map((l) => ({ ...l, category_name: cats.find((c) => c.code === l.category_code)?.name }));
  const pdf = await buildOrderPdf({ order: full, struttura: full.struttura, lines, company, packages: [], events: full.events });
  await q('UPDATE orders SET pdf=$2 WHERE id=$1', [id, pdf]);
  if (full.struttura.email) await sendMail({ kind: 'ORDINE_APPROVATO', refKey: `APPROVATO:${id}`, to: full.struttura.email, strutturaId: o.struttura_id, subject: `Ordine ${o.number} approvato`, title: `Ordine ${o.number} approvato`,
    body: `L'ordine ${o.number} è stato approvato da Toscana Diagnostica ed è in preparazione presso il magazzino. Riceverete un avviso alla consegna.`, attachment: { filename: `${o.number}.pdf`, content: pdf } });
  return { ok: true, status: 'APPROVATO' };
}
r.post('/:id/approve', requireRole(...OPS_ROLES), ah(async (req, res) => res.json(await approve(req, req.params.id))));

// Ripiego quando il fornitore non legge le API: ordine PDF via email alla casella del magazzino
async function emailToSupplier(req, id) {
  const o = await fullDetail(req, id);
  assertStatus(o, 'APPROVATO', 'PRESO_IN_CARICO');
  const company = await one('SELECT * FROM company LIMIT 1');
  const cats = await many('SELECT code, name FROM categories');
  const lines = o.lines.map((l) => ({ ...l, category_name: cats.find((c) => c.code === l.category_code)?.name }));
  const pdf = o.pdf || await buildOrderPdf({ order: o, struttura: o.struttura, lines, company, packages: [], events: o.events });
  const r2 = await emailOrder({ order: o, struttura: o.struttura, lines, pdf });
  await event(id, req.user.id, r2.status === 'INVIATA' ? 'Ordine inviato via email al magazzino' : `Invio email al magazzino non riuscito (${r2.error || r2.status})`);
  await audit(req, 'ORDER_EMAIL_SUPPLIER', 'order', id, { status: r2.status });
  return { ok: r2.status === 'INVIATA', status: r2.status, error: r2.error };
}
r.post('/:id/email-supplier', requireRole(...OPS_ROLES), ah(async (req, res) => res.json(await emailToSupplier(req, req.params.id))));

// Fasi 3 e 4 registrate a mano dall'Area Operations (quando il fornitore non chiama le API)
r.post('/:id/picked', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object({ reference: opt(z.string().max(80)) }), req.body || {});
  const out = await markPicked(await loadOrder(req, req.params.id), { reference: d.reference, userId: req.user.id, actor: req.user.full_name });
  await audit(req, 'ORDER_PICKED', 'order', req.params.id, d); res.json(out);
}));
r.post('/:id/shipped', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object({ ddt: opt(z.string().max(80)) }), req.body || {});
  const out = await markShipped(await loadOrder(req, req.params.id), { ddt: d.ddt, userId: req.user.id, actor: req.user.full_name });
  await audit(req, 'ORDER_SHIPPED', 'order', req.params.id, d); res.json(out);
}));
r.post('/:id/delivered', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object({ ddt: opt(z.string().max(80)), lines: z.array(z.object({ article_code: z.string(), packs: z.coerce.number().int().min(0), lot: opt(z.string().max(60)), expiry: opt(z.string()) })).optional() }), req.body || {});
  const out = await markDelivered(await loadOrder(req, req.params.id), { ddt: d.ddt, lines: d.lines?.map((l) => ({ codiceArticolo: l.article_code, confezioni: l.packs, lotto: l.lot, scadenza: l.expiry })), userId: req.user.id, actor: req.user.full_name });
  await audit(req, 'ORDER_DELIVERED', 'order', req.params.id, { ddt: d.ddt }); res.json(out);
}));

// ---------------- Fase 5 · Carico nel magazzino interno (strutture TD): una riga per confezione, lettura o spunta ----------------
const canLoad = (req, o) => (isOps(req.user) || o.struttura_id === req.user.struttura_id) && o.kind !== 'CLIENTE';

// Lettura di un codice: confezione già nota (barcode comunicato dal fornitore), GTIN o codice articolo -> prossima confezione attesa
r.post('/:id/load-scan', ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  if (!canLoad(req, o)) throw forbidden();
  assertStatus(o, 'CONSEGNATO');
  const { code, lot, expiry } = parse(z.object({ code: z.string().min(1).max(120), lot: opt(z.string().max(60)), expiry: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) }), req.body);
  const c = code.trim();
  let pk = await one("SELECT id FROM packages WHERE order_id=$1 AND status='ATTESO' AND barcode=$2 ORDER BY seq LIMIT 1", [o.id, c]);
  if (!pk) {
    const parsed = parseGs1(c);
    const art = await one(`SELECT a.id FROM articles a WHERE (a.gtin IS NOT NULL AND (a.gtin=$1 OR a.gtin=$2)) OR upper(a.code)=upper($1) OR upper(a.silva_code)=upper($1) LIMIT 1`, [c, parsed.gtin || '']);
    if (!art) throw bad(`Codice ${c} non riconosciuto: associa il codice a barre all'articolo nel catalogo oppure spunta la riga a mano`);
    pk = await one(`SELECT id FROM packages WHERE order_id=$1 AND article_id=$2 AND status='ATTESO' ORDER BY seq LIMIT 1`, [o.id, art.id]);
    if (!pk) throw bad('Tutte le confezioni di questo articolo risultano già caricate');
    const row = await one(`UPDATE packages SET status='RICEVUTO', barcode=coalesce(barcode,$2), lot=coalesce($3, lot), expiry=coalesce($4::date, expiry), received_at=now(), received_by=$5 WHERE id=$1 RETURNING *`, [pk.id, c, lot || parsed.lot || null, expiry || parsed.expiry || null, req.user.id]);
    return res.json(row);
  }
  res.json(await one(`UPDATE packages SET status='RICEVUTO', lot=coalesce($2, lot), expiry=coalesce($3::date, expiry), received_at=now(), received_by=$4 WHERE id=$1 RETURNING *`, [pk.id, lot || null, expiry || null, req.user.id]));
}));

r.post('/:id/load', ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  if (!canLoad(req, o)) throw forbidden();
  assertStatus(o, 'CONSEGNATO');
  const d = parse(z.object({ all: z.boolean().optional(), packages: z.array(z.object({ id: z.coerce.number().int(), received: z.boolean().default(true), lot: opt(z.string().max(60)), expiry: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) })).optional() }), req.body);
  await tx(async (c) => {
    if (d.all) await c.query("UPDATE packages SET status='RICEVUTO', received_at=now(), received_by=$2 WHERE order_id=$1 AND status='ATTESO'", [o.id, req.user.id]);
    for (const p of d.packages || []) {
      if (p.received) await c.query(`UPDATE packages SET status='RICEVUTO', lot=coalesce($3, lot), expiry=coalesce($4::date, expiry), received_at=now(), received_by=$2 WHERE id=$1 AND order_id=$5 AND status IN ('ATTESO','RICEVUTO')`, [p.id, req.user.id, p.lot, p.expiry, o.id]);
      else await c.query("UPDATE packages SET status='ATTESO', received_at=NULL, received_by=NULL WHERE id=$1 AND order_id=$2 AND status='RICEVUTO'", [p.id, o.id]);
    }
  });
  res.json({ ok: true });
}));

r.post('/:id/load-confirm', ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  if (!canLoad(req, o)) throw forbidden();
  const d = parse(z.object({ note: opt(z.string().max(1000)) }), req.body || {});
  const out = await markStored(o, { userId: req.user.id, note: d.note });
  await audit(req, 'ORDER_STORED', 'order', o.id, out);
  res.json(out);
}));

r.post('/:id/close', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  if (o.kind === 'CLIENTE') assertStatus(o, 'CONSEGNATO'); else assertStatus(o, 'IMMAGAZZINATO');
  const open = await one("SELECT count(*)::int AS n FROM issues WHERE order_id=$1 AND status='APERTA'", [o.id]);
  if (open.n) throw bad('Chiudi prima le difformità aperte');
  await q("UPDATE orders SET status='CHIUSO', closed_by=$2, closed_at=now(), updated_at=now() WHERE id=$1", [o.id, req.user.id]);
  await event(o.id, req.user.id, 'Processo concluso');
  await audit(req, 'ORDER_CLOSE', 'order', o.id);
  res.json({ ok: true });
}));

// Eliminazione definitiva dall'archivio (Area Operations). Rifiutata se l'ordine ha confezioni già in giacenza o messe in uso
// (toglierle a sistema falserebbe le scorte: si annulla, non si elimina) o se una giacenza mensile lo ha generato.
r.delete('/:id', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  const inStock = await one("SELECT count(*)::int AS n FROM packages WHERE order_id=$1 AND status IN ('RICEVUTO','IN_USO','RETTIFICATO')", [o.id]);
  if (inStock.n > 0) throw bad(`L'ordine ${o.number} ha ${inStock.n} confezioni caricate o già usate: non si può eliminare, si annulla`);
  const sc = await one('SELECT id FROM stock_counts WHERE order_id=$1 LIMIT 1', [o.id]);
  if (sc) throw bad(`L'ordine ${o.number} è stato generato da una giacenza mensile: non si può eliminare, si annulla`);
  await tx(async (c) => {
    await c.query('DELETE FROM packages WHERE order_id=$1', [o.id]);
    await c.query('DELETE FROM orders WHERE id=$1', [o.id]);
  });
  await audit(req, 'ORDER_DELETE', 'order', o.id, { number: o.number, status: o.status, struttura: o.struttura_name });
  res.json({ ok: true });
}));

r.post('/:id/cancel', ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  const { reason } = parse(z.object({ reason: z.string().min(3).max(500) }), req.body);
  if (isOps(req.user)) assertStatus(o, 'BOZZA', 'INVIATO', 'APPROVATO', 'PRESO_IN_CARICO');
  else assertStatus(o, 'BOZZA', 'INVIATO');
  await tx(async (c) => {
    await c.query("DELETE FROM packages WHERE order_id=$1 AND status='ATTESO'", [o.id]);
    await c.query("UPDATE orders SET status='ANNULLATO', cancelled_by=$2, cancelled_at=now(), cancel_reason=$3, updated_at=now() WHERE id=$1", [o.id, req.user.id, reason]);
  });
  await event(o.id, req.user.id, 'Annullato', { reason });
  await audit(req, 'ORDER_CANCEL', 'order', o.id, { reason });
  res.json({ ok: true });
}));

r.get('/:id/pdf', ah(async (req, res) => {
  const o = await fullDetail(req, req.params.id);
  const company = await one('SELECT * FROM company LIMIT 1');
  const cats = await many('SELECT code, name FROM categories');
  const lines = o.lines.map((l) => ({ ...l, category_name: cats.find((c) => c.code === l.category_code)?.name }));
  const pdf = await buildOrderPdf({ order: o, struttura: o.struttura, lines, company, packages: o.packages, events: o.events });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename="${o.number}.pdf"`);
  res.send(pdf);
}));

// ---------------- Difformità ----------------
r.post('/:id/issues', ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  if (!isOps(req.user) && o.struttura_id !== req.user.struttura_id) throw forbidden();
  const d = parse(z.object({ kind: z.enum(['MANCANTE', 'DANNEGGIATO', 'ERRATO', 'ALTRO']), description: z.string().min(3).max(1000) }), req.body);
  const row = await one('INSERT INTO issues (order_id, struttura_id, kind, description, opened_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [o.id, o.struttura_id, d.kind, d.description, req.user.id]);
  await event(o.id, req.user.id, `Difformità segnalata (${d.kind})`, { description: d.description });
  const to = await opsEmails();
  if (to.length) await sendMail({ kind: 'DIFFORMITA', to, strutturaId: o.struttura_id, subject: `Difformità su ordine ${o.number} · ${o.struttura_name}`, title: 'Difformità segnalata', body: `${o.struttura_name}, ordine ${o.number}: ${d.kind}. ${d.description}` });
  res.status(201).json(row);
}));

// Parsing minimo GS1-128 letto in sequenza: (01) GTIN 14 cifre, (17) scadenza AAMMGG, (10) lotto a lunghezza variabile (fino al separatore GS o alla fine)
function parseGs1(code) {
  const out = {};
  let s = String(code).replace(/[()]/g, '').replace(/\u001d/g, '|');
  if (!/^(01|17|10)\d/.test(s)) return out;
  let guard = 0;
  while (s.length >= 2 && guard++ < 10) {
    const ai = s.slice(0, 2);
    if (ai === '01' && /^\d{14}/.test(s.slice(2))) { out.gtin = s.slice(2, 16); s = s.slice(16); }
    else if (ai === '17' && /^\d{6}/.test(s.slice(2))) { const v = s.slice(2, 8); const dd = v.slice(4, 6); out.expiry = `20${v.slice(0, 2)}-${v.slice(2, 4)}-${dd === '00' ? '28' : dd}`; s = s.slice(8); }
    else if (ai === '10') { const end = s.indexOf('|'); out.lot = (end === -1 ? s.slice(2) : s.slice(2, end)).slice(0, 20); s = end === -1 ? '' : s.slice(end + 1); }
    else break;
    if (s.startsWith('|')) s = s.slice(1);
  }
  return out;
}

export default r;
export { itDate, ARTICLE_COLS };
