import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse, itDate } from '../lib/util.js';
import { requireRole, isOps, Params, assertStruttura, OPS_ROLES } from '../lib/access.js';
import { nextOrderNumber, orderLines, enrichLines, createPackages, assertStatus, ARTICLE_COLS } from '../lib/orders.js';
import { transmit } from '../lib/silva.js';
import { buildOrderPdf } from '../pdf/order.js';
import { sendMail, opsEmails } from '../lib/mailer.js';

const r = Router();
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const lineSchema = z.array(z.object({ article_id: z.coerce.number().int(), qty: z.coerce.number().int().min(0).max(9999), note: opt(z.string().max(300)) })).max(200);
const headSchema = { notes: opt(z.string().max(1000)), urgent: z.boolean().optional(), urgent_reason: opt(z.string().max(300)), client_ref: opt(z.string().max(60)) };

const ORDER_COLS = `o.*, s.name AS struttura_name, s.code AS struttura_code, s.kind AS struttura_kind, s.city AS struttura_city,
  ru.full_name AS requested_by_name, au.full_name AS approved_by_name, cu.full_name AS received_by_name, ku.full_name AS closed_by_name,
  (SELECT count(*)::int FROM order_lines l WHERE l.order_id=o.id AND coalesce(l.qty_approved, l.qty_requested) > 0) AS lines_count,
  (SELECT coalesce(sum(coalesce(l.qty_approved, l.qty_requested)),0)::int FROM order_lines l WHERE l.order_id=o.id) AS packs_total,
  (SELECT count(*)::int FROM packages p WHERE p.order_id=o.id AND p.status IN ('RICEVUTO','IN_USO')) AS packs_received,
  (SELECT count(*)::int FROM packages p WHERE p.order_id=o.id AND p.status='ATTESO') AS packs_pending,
  (SELECT count(*)::int FROM issues i WHERE i.order_id=o.id AND i.status='APERTA') AS open_issues,
  (SELECT count(*)::int FROM order_lines l WHERE l.order_id=o.id AND l.delta_pct IS NOT NULL AND abs(l.delta_pct) > 50) AS anomalies`;
const JOINS = `FROM orders o JOIN strutture s ON s.id=o.struttura_id LEFT JOIN users ru ON ru.id=o.requested_by LEFT JOIN users au ON au.id=o.approved_by
  LEFT JOIN users cu ON cu.id=o.received_by LEFT JOIN users ku ON ku.id=o.closed_by`;

async function loadOrder(req, id) {
  const o = await one(`SELECT ${ORDER_COLS} ${JOINS} WHERE o.id=$1`, [id]);
  if (!o) throw notFound('Ordine non trovato');
  if (!isOps(req.user) && o.struttura_id !== req.user.struttura_id) throw forbidden('Ordine non autorizzato');
  return o;
}
async function event(orderId, userId, ev, data) {
  await q('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,$2,$3,$4)', [orderId, userId, ev, data ? JSON.stringify(data) : null]);
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
  assertStatus(o, 'INVIATO', 'BOZZA', 'APPROVATO');
  if (o.status !== 'APPROVATO') {
    const n = await one('SELECT coalesce(sum(coalesce(qty_approved, qty_requested)),0)::int AS n FROM order_lines WHERE order_id=$1', [id]);
    if (!n.n) throw bad('Nessuna quantità approvata: annulla l\'ordine invece di approvarlo');
    if (o.kind === 'LAB' && o.status === 'BOZZA') await enrichLines(id, o.struttura_id, o.kind);
    await tx(async (c) => {
      await c.query("UPDATE order_lines SET qty_approved = coalesce(qty_approved, qty_requested) WHERE order_id=$1", [id]);
      await c.query("UPDATE orders SET status='APPROVATO', approved_by=$2, approved_at=now(), submitted_at=coalesce(submitted_at, now()), updated_at=now() WHERE id=$1", [id, req.user.id]);
      const n2 = await createPackages(c, { id, struttura_id: o.struttura_id });
      await event(id, req.user.id, 'Approvato dall\'Area Operations', { packages: n2 });
    });
    await audit(req, 'ORDER_APPROVE', 'order', id);
  }
  return transmitOrder(req, id);
}
r.post('/:id/approve', requireRole(...OPS_ROLES), ah(async (req, res) => res.json(await approve(req, req.params.id))));

async function transmitOrder(req, id) {
  const o = await fullDetail(req, id);
  assertStatus(o, 'APPROVATO');
  const company = await one('SELECT * FROM company LIMIT 1');
  const lines = o.lines.map((l) => ({ ...l, category_name: null }));
  const cats = await many('SELECT code, name FROM categories');
  for (const l of lines) l.category_name = cats.find((c) => c.code === l.category_code)?.name;
  const pdf = await buildOrderPdf({ order: o, struttura: o.struttura, lines, company, packages: o.packages, events: o.events });
  const t = await transmit({ order: o, struttura: o.struttura, lines, pdf });
  if (t.status === 'OK') {
    await q(`UPDATE orders SET status='TRASMESSO', transmitted_at=now(), silva_mode=$2, silva_reference=$3, silva_payload=$4, pdf=$5, updated_at=now() WHERE id=$1`, [id, t.mode, t.reference, JSON.stringify(t.payload), pdf]);
    await event(id, req.user.id, `Trasmesso al fornitore (${t.mode})`, { reference: t.reference });
    await audit(req, 'ORDER_TRANSMIT', 'order', id, { mode: t.mode, reference: t.reference });
    if (o.struttura.email) await sendMail({ kind: 'ORDINE_APPROVATO', refKey: `APPROVATO:${id}`, to: o.struttura.email, strutturaId: o.struttura_id, subject: `Ordine ${o.number} approvato e in consegna`, title: `Ordine ${o.number} approvato`,
      body: `L'ordine ${o.number} è stato approvato da Toscana Diagnostica e trasmesso al magazzino.\n\nAlla consegna confermate la ricezione in Orders Management, confezione per confezione (lettura del codice a barre o spunta), entro 3 giorni lavorativi: le differenze vanno segnalate lì.`, attachment: { filename: `${o.number}.pdf`, content: pdf } });
    return { ok: true, status: 'TRASMESSO', reference: t.reference, mode: t.mode };
  }
  await q('UPDATE orders SET silva_mode=$2, silva_payload=$3, pdf=$4, updated_at=now() WHERE id=$1', [id, t.mode, JSON.stringify(t.payload), pdf]);
  await event(id, req.user.id, `Trasmissione al fornitore fallita (${t.mode})`, { error: t.error });
  return { ok: false, status: 'APPROVATO', error: t.error, mode: t.mode };
}
r.post('/:id/transmit', requireRole(...OPS_ROLES), ah(async (req, res) => res.json(await transmitOrder(req, req.params.id))));

// ---------------- Ricezione: una riga per confezione, scansione o spunta ----------------
const canReceive = (req, o) => isOps(req.user) || o.struttura_id === req.user.struttura_id;

// Lettura di un codice: risolve l'articolo (GTIN, codice articolo, o codice confezione già noto) e spunta la prossima confezione attesa
r.post('/:id/scan', ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  if (!canReceive(req, o)) throw forbidden();
  assertStatus(o, 'TRASMESSO', 'APPROVATO');
  const { code, lot, expiry } = parse(z.object({ code: z.string().min(1).max(120), lot: opt(z.string().max(60)), expiry: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) }), req.body);
  const parsed = parseGs1(code);
  const art = await one(`SELECT a.id FROM articles a WHERE a.gtin IS NOT NULL AND (a.gtin=$1 OR a.gtin=$2) OR upper(a.code)=upper($1) LIMIT 1`, [code.trim(), parsed.gtin || '']);
  if (!art) throw bad(`Codice ${code} non riconosciuto: associa il codice a barre all'articolo nel catalogo oppure spunta la riga a mano`);
  const pk = await one(`SELECT id FROM packages WHERE order_id=$1 AND article_id=$2 AND status='ATTESO' ORDER BY seq LIMIT 1`, [o.id, art.id]);
  if (!pk) throw bad('Tutte le confezioni di questo articolo risultano già ricevute');
  const row = await one(`UPDATE packages SET status='RICEVUTO', barcode=$2, lot=coalesce($3, lot), expiry=coalesce($4::date, expiry), received_at=now(), received_by=$5 WHERE id=$1 RETURNING *`,
    [pk.id, code.trim(), lot || parsed.lot || null, expiry || parsed.expiry || null, req.user.id]);
  res.json(row);
}));

r.post('/:id/receive', ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  if (!canReceive(req, o)) throw forbidden();
  assertStatus(o, 'TRASMESSO', 'APPROVATO');
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

// Conferma finale: le confezioni non spuntate diventano "non ricevute" e aprono una difformità verso l'Area Operations
r.post('/:id/confirm-receipt', ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  if (!canReceive(req, o)) throw forbidden();
  assertStatus(o, 'TRASMESSO', 'APPROVATO');
  const d = parse(z.object({ note: opt(z.string().max(1000)) }), req.body);
  const missing = await many(`SELECT p.id, a.name FROM packages p JOIN articles a ON a.id=p.article_id WHERE p.order_id=$1 AND p.status='ATTESO'`, [o.id]);
  const received = await one("SELECT count(*)::int AS n FROM packages WHERE order_id=$1 AND status='RICEVUTO'", [o.id]);
  if (!received.n && missing.length) throw bad('Nessuna confezione spuntata: segnala la mancata consegna con una difformità invece di confermare');
  await tx(async (c) => {
    await c.query("UPDATE packages SET status='NON_RICEVUTO' WHERE order_id=$1 AND status='ATTESO'", [o.id]);
    await c.query(`UPDATE order_lines l SET qty_received = (SELECT count(*) FROM packages p WHERE p.line_id=l.id AND p.status IN ('RICEVUTO','IN_USO')) WHERE l.order_id=$1`, [o.id]);
    await c.query("UPDATE orders SET status='CONSEGNATO', received_at=now(), received_by=$2, updated_at=now() WHERE id=$1", [o.id, req.user.id]);
    if (missing.length) {
      const byName = {};
      for (const m of missing) byName[m.name] = (byName[m.name] || 0) + 1;
      const desc = `Confezioni non ricevute: ${Object.entries(byName).map(([n, k]) => `${n} x${k}`).join(', ')}.${d.note ? ' ' + d.note : ''}`;
      await c.query("INSERT INTO issues (order_id, struttura_id, kind, description, opened_by) VALUES ($1,$2,'MANCANTE',$3,$4)", [o.id, o.struttura_id, desc, req.user.id]);
    }
  });
  await event(o.id, req.user.id, missing.length ? `Ricezione confermata con ${missing.length} confezioni mancanti` : 'Ricezione confermata, materiale preso in carico', { missing: missing.length, note: d.note });
  await audit(req, 'ORDER_RECEIVED', 'order', o.id, { missing: missing.length });
  const to = await opsEmails();
  if (to.length) await sendMail({ kind: 'RICEZIONE', refKey: `RICEZIONE:${o.id}`, to, strutturaId: o.struttura_id, subject: `Ordine ${o.number} ricevuto da ${o.struttura_name}${missing.length ? ` · ${missing.length} confezioni mancanti` : ''}`, title: `Ricezione ordine ${o.number}`,
    body: missing.length ? `${o.struttura_name} ha confermato la ricezione dell'ordine ${o.number} segnalando ${missing.length} confezioni mancanti. È aperta una difformità da gestire.` : `${o.struttura_name} ha confermato la ricezione completa dell'ordine ${o.number}. Verifica e chiudi l'ordine.` });
  res.json({ ok: true, missing: missing.length });
}));

r.post('/:id/close', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  assertStatus(o, 'CONSEGNATO');
  const open = await one("SELECT count(*)::int AS n FROM issues WHERE order_id=$1 AND status='APERTA'", [o.id]);
  if (open.n) throw bad('Chiudi prima le difformità aperte');
  await q("UPDATE orders SET status='CHIUSO', closed_by=$2, closed_at=now(), updated_at=now() WHERE id=$1", [o.id, req.user.id]);
  await event(o.id, req.user.id, 'Processo concluso');
  await audit(req, 'ORDER_CLOSE', 'order', o.id);
  res.json({ ok: true });
}));

r.post('/:id/cancel', ah(async (req, res) => {
  const o = await loadOrder(req, req.params.id);
  const { reason } = parse(z.object({ reason: z.string().min(3).max(500) }), req.body);
  if (isOps(req.user)) assertStatus(o, 'BOZZA', 'INVIATO', 'APPROVATO', 'TRASMESSO');
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
