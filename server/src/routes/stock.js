import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse, getSetting, todayRome } from '../lib/util.js';
import { requireRole, isOps, Params, assertStruttura, OPS_ROLES } from '../lib/access.js';
import { ARTICLE_COLS, stockByArticle, openStockCount, stockCountDetail, proposeQty, nextOrderNumber, enrichLines } from '../lib/orders.js';
import { consumptionByArticle } from '../lib/studiolab.js';
import { sendMail, opsEmails } from '../lib/mailer.js';

const r = Router();
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));

function targetStruttura(req) {
  const id = isOps(req.user) ? Number(req.query.struttura_id || req.body?.struttura_id) : req.user.struttura_id;
  if (!id) throw bad('Struttura obbligatoria');
  return id;
}

// ---------------- Giacenza attuale per articolo ----------------
r.get('/', ah(async (req, res) => {
  const sid = targetStruttura(req);
  const s = await assertStruttura(req.user, sid);
  const months = Number(await getSetting('production_months', '3'));
  const cons = s.kind === 'LAB' ? { map: new Map(), months: 0 } : await consumptionByArticle(sid, months);
  const rows = await many(`SELECT a.id AS article_id, ${ARTICLE_COLS}, a.min_stock_packs, c.name AS category_name, c.icon,
      (SELECT count(*)::int FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id AND p.status='RICEVUTO') AS packs,
      (SELECT min(expiry) FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id AND p.status='RICEVUTO') AS next_expiry,
      (SELECT count(*)::int FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id AND p.status='IN_USO' AND p.used_at >= date_trunc('month', now() AT TIME ZONE 'Europe/Rome')) AS used_this_month,
      (SELECT count(*)::int FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id AND p.status='ATTESO') AS packs_incoming
    FROM articles a JOIN categories c ON c.code=a.category_code WHERE a.active AND (a.visible_all OR ${s.kind === 'CLIENTE' ? 'a.visible_service' : 'a.visible_sedi'} OR EXISTS (SELECT 1 FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id)) ORDER BY c.sort, a.sort`, [sid]);
  for (const row of rows) {
    const p = cons.map.get(row.article_id);
    row.prod_packs_avg = p ? p.packs : null;
    row.prod_units_avg = p ? p.units : null;
    row.coverage_months = p && p.packs > 0 ? Math.round((row.packs / p.packs) * 10) / 10 : null;
    row.alert = (p && p.packs > 0 && row.packs < p.packs * 0.5) || (row.min_stock_packs > 0 && row.packs < row.min_stock_packs);
  }
  res.json({ struttura: { id: s.id, name: s.name, kind: s.kind, code: s.code, stock_deadline_day: s.stock_deadline_day }, production_months: cons.months, rows });
}));

// Confezioni in giacenza di un articolo, ordinate per scadenza (FEFO)
r.get('/packages', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  const P = new Params();
  const where = [`p.struttura_id=${P.add(sid)}`];
  where.push(req.query.status ? `p.status=${P.add(req.query.status)}` : `p.status='RICEVUTO'`);
  if (req.query.article_id) where.push(`p.article_id=${P.add(Number(req.query.article_id))}`);
  res.json(await many(`SELECT p.*, a.code AS article_code, a.name AS article_name, a.pack_label, a.color, o.number AS order_number, u.full_name AS used_by_name
    FROM packages p JOIN articles a ON a.id=p.article_id LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN users u ON u.id=p.used_by
    WHERE ${where.join(' AND ')} ORDER BY p.expiry NULLS LAST, p.received_at, p.id LIMIT 2000`, P.values));
}));

// Messa in uso: per confezione (id), per codice letto, o la prossima in scadenza dell'articolo (spunta)
r.post('/use', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  const d = parse(z.object({ package_id: opt(z.coerce.number().int()), code: opt(z.string().max(120)), article_id: opt(z.coerce.number().int()), qty: z.coerce.number().int().min(1).max(500).default(1) }), req.body);
  let ids = [];
  if (d.package_id) ids = [d.package_id];
  else {
    let articleId = d.article_id;
    if (!articleId && d.code) {
      const byBarcode = await one("SELECT article_id FROM packages WHERE struttura_id=$1 AND barcode=$2 AND status='RICEVUTO' LIMIT 1", [sid, d.code.trim()]);
      const art = byBarcode || await one(`SELECT id AS article_id FROM articles WHERE (gtin IS NOT NULL AND $1 LIKE '%' || gtin || '%') OR upper(code)=upper($1) LIMIT 1`, [d.code.trim()]);
      if (!art) throw bad(`Codice ${d.code} non riconosciuto`);
      articleId = art.article_id;
    }
    if (!articleId) throw bad('Indica confezione, codice o articolo');
    ids = (await many("SELECT id FROM packages WHERE struttura_id=$1 AND article_id=$2 AND status='RICEVUTO' ORDER BY expiry NULLS LAST, received_at, id LIMIT $3", [sid, articleId, d.qty])).map((x) => x.id);
    if (!ids.length) throw bad('Nessuna confezione in giacenza per questo articolo');
  }
  const rows = await many(`UPDATE packages SET status='IN_USO', used_at=now(), used_by=$2 WHERE id = ANY($1) AND struttura_id=$3 AND status='RICEVUTO' RETURNING id, article_id, lot, expiry`, [ids, req.user.id, sid]);
  if (!rows.length) throw bad('Confezione non in giacenza');
  await audit(req, 'PACKAGE_USE', 'package', rows.map((x) => x.id).join(','), { struttura_id: sid });
  const left = await one("SELECT count(*)::int AS n FROM packages WHERE struttura_id=$1 AND article_id=$2 AND status='RICEVUTO'", [sid, rows[0].article_id]);
  res.json({ used: rows, remaining: left.n });
}));

// Annulla una messa in uso per errore (entro la giornata)
r.post('/unuse', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  const { package_id } = parse(z.object({ package_id: z.coerce.number().int() }), req.body);
  const row = await one("UPDATE packages SET status='RICEVUTO', used_at=NULL, used_by=NULL WHERE id=$1 AND struttura_id=$2 AND status='IN_USO' AND used_at > now() - interval '1 day' RETURNING id", [package_id, sid]);
  if (!row) throw bad('Operazione non annullabile');
  await audit(req, 'PACKAGE_UNUSE', 'package', package_id);
  res.json({ ok: true });
}));

// Carico iniziale (prima giacenza) o rettifica manuale dell'Area Operations
r.post('/initial', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  const d = parse(z.object({ lines: z.array(z.object({ article_id: z.coerce.number().int(), qty: z.coerce.number().int().min(0).max(5000), lot: opt(z.string().max(60)), expiry: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) })).min(1), note: opt(z.string().max(300)) }), req.body);
  let n = 0;
  await tx(async (c) => {
    for (const l of d.lines) for (let i = 0; i < l.qty; i++) {
      await c.query("INSERT INTO packages (struttura_id, article_id, seq, status, origin, lot, expiry, received_at, received_by, note) VALUES ($1,$2,$3,'RICEVUTO','INIZIALE',$4,$5,now(),$6,$7)", [sid, l.article_id, i + 1, l.lot, l.expiry, req.user.id, d.note]);
      n++;
    }
  });
  await audit(req, 'STOCK_INITIAL', 'struttura', sid, { packages: n });
  res.status(201).json({ packages: n });
}));

// ---------------- Giacenza mensile dichiarata ----------------
r.get('/counts', ah(async (req, res) => {
  const P = new Params();
  const where = [isOps(req.user) ? 'TRUE' : `c.struttura_id=${P.add(req.user.struttura_id)}`];
  if (req.query.struttura_id) where.push(`c.struttura_id=${P.add(Number(req.query.struttura_id))}`);
  res.json(await many(`SELECT c.*, s.name AS struttura_name, s.code AS struttura_code, s.kind, u.full_name AS confirmed_by_name, o.number AS order_number, o.status AS order_status,
      (SELECT count(*)::int FROM stock_count_lines l WHERE l.count_id=c.id AND l.counted_qty <> l.system_qty) AS differences
    FROM stock_counts c JOIN strutture s ON s.id=c.struttura_id LEFT JOIN users u ON u.id=c.confirmed_by LEFT JOIN orders o ON o.id=c.order_id
    WHERE ${where.join(' AND ')} ORDER BY c.month DESC, s.name LIMIT 300`, P.values));
}));

r.post('/counts/open', ah(async (req, res) => {
  const sid = targetStruttura(req);
  const s = await assertStruttura(req.user, sid);
  if (s.kind === 'CLIENTE') throw bad('La giacenza mensile riguarda le sedi del network e il laboratorio');
  const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}/).default(todayRome().slice(0, 7)) }), req.body || {});
  const id = await openStockCount(sid, month);
  res.json({ id });
}));

r.get('/counts/:id', ah(async (req, res) => {
  const c = await stockCountDetail(req.params.id);
  if (!c) throw notFound();
  if (!isOps(req.user) && c.struttura_id !== req.user.struttura_id) throw forbidden();
  res.json(c);
}));

// Fase 7: righe fuori elenco (articolo a catalogo non in elenco, oppure descrizione libera)
r.post('/counts/:id/extras', ah(async (req, res) => {
  const c = await one('SELECT * FROM stock_counts WHERE id=$1', [req.params.id]);
  if (!c) throw notFound();
  if (!isOps(req.user) && c.struttura_id !== req.user.struttura_id) throw forbidden();
  if (c.status === 'CONFERMATO') throw bad('Giacenza già confermata');
  const d = parse(z.object({ article_id: opt(z.coerce.number().int()), name: opt(z.string().max(200)), qty: z.coerce.number().int().min(0).max(99999), note: opt(z.string().max(300)) }), req.body);
  if (!d.article_id && !d.name) throw bad('Indica un articolo del catalogo o una descrizione');
  const row = await one('INSERT INTO stock_count_extras (count_id, article_id, name, qty, note) VALUES ($1,$2,$3,$4,$5) RETURNING id', [c.id, d.article_id, d.name, d.qty, d.note]);
  res.status(201).json(row);
}));
r.delete('/counts/:id/extras/:eid', ah(async (req, res) => {
  const c = await one('SELECT * FROM stock_counts WHERE id=$1', [req.params.id]);
  if (!c) throw notFound();
  if (!isOps(req.user) && c.struttura_id !== req.user.struttura_id) throw forbidden();
  if (c.status === 'CONFERMATO') throw bad('Giacenza già confermata');
  await q('DELETE FROM stock_count_extras WHERE id=$1 AND count_id=$2', [req.params.eid, c.id]);
  res.json({ ok: true });
}));

// Fase 6: scarichi di oggi della struttura (registro della pagina Scarico)
r.get('/unloads', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  res.json(await many(`SELECT p.id, p.used_at, p.lot, p.expiry, p.barcode, a.name AS article_name, a.pack_label, a.color, u.full_name AS used_by_name,
      (SELECT count(*)::int FROM packages x WHERE x.struttura_id=p.struttura_id AND x.article_id=p.article_id AND x.status='RICEVUTO') AS remaining
    FROM packages p JOIN articles a ON a.id=p.article_id LEFT JOIN users u ON u.id=p.used_by
    WHERE p.struttura_id=$1 AND p.status='IN_USO' AND p.used_at >= now() - interval '7 days' ORDER BY p.used_at DESC LIMIT 200`, [sid]));
}));

r.put('/counts/:id', ah(async (req, res) => {
  const c = await one('SELECT * FROM stock_counts WHERE id=$1', [req.params.id]);
  if (!c) throw notFound();
  if (!isOps(req.user) && c.struttura_id !== req.user.struttura_id) throw forbidden();
  if (c.status === 'CONFERMATO') throw bad('Giacenza già confermata');
  const d = parse(z.object({ lines: z.array(z.object({ article_id: z.coerce.number().int(), counted_qty: z.coerce.number().int().min(0).max(99999) })) }), req.body);
  for (const l of d.lines) await q('UPDATE stock_count_lines SET counted_qty=$3 WHERE count_id=$1 AND article_id=$2', [c.id, l.article_id, l.counted_qty]);
  await q('UPDATE stock_counts SET updated_at=now() WHERE id=$1', [c.id]);
  res.json({ ok: true });
}));

/**
 * Conferma della giacenza: allinea le confezioni a sistema al conteggio (rettifiche tracciate), poi
 * sedi del network: genera l'ordine potenziale con la formula di riordino e lo mette in verifica all'Area Operations;
 * laboratorio TD: apre una bozza d'ordine che l'Area Operations compila e approva direttamente.
 */
r.post('/counts/:id/confirm', ah(async (req, res) => {
  const c = await stockCountDetail(req.params.id);
  if (!c) throw notFound();
  if (!isOps(req.user) && c.struttura_id !== req.user.struttura_id) throw forbidden();
  if (c.status === 'CONFERMATO') throw bad('Giacenza già confermata');
  const formula = await getSetting('reorder_formula', 'DIFF_X_FACTOR');
  const months = Number(await getSetting('production_months', '3'));
  const cons = c.kind === 'LAB' ? { map: new Map(), months: 0 } : await consumptionByArticle(c.struttura_id, months);
  const s = await one('SELECT * FROM strutture WHERE id=$1', [c.struttura_id]);
  const result = await tx(async (cl) => {
    let adjusted = 0;
    for (const l of c.lines) {
      const diff = l.counted_qty - l.system_qty;
      if (diff < 0) {
        await cl.query(`UPDATE packages SET status='RETTIFICATO', note=$4 WHERE id IN (SELECT id FROM packages WHERE struttura_id=$1 AND article_id=$2 AND status='RICEVUTO' ORDER BY expiry NULLS FIRST, received_at LIMIT $3)`,
          [c.struttura_id, l.article_id, -diff, `Rettifica giacenza ${c.month.slice(0, 7)}`]);
        adjusted += -diff;
      } else if (diff > 0) {
        for (let i = 0; i < diff; i++) await cl.query("INSERT INTO packages (struttura_id, article_id, seq, status, origin, received_at, received_by, note) VALUES ($1,$2,$3,'RICEVUTO','RETTIFICA',now(),$4,$5)", [c.struttura_id, l.article_id, i + 1, req.user.id, `Rettifica giacenza ${c.month.slice(0, 7)}`]);
        adjusted += diff;
      }
    }
    const number = await nextOrderNumber(cl);
    const isSede = c.kind === 'SEDE';
    const o = await cl.query(`INSERT INTO orders (number, struttura_id, kind, origin, status, notes, stock_count_id, requested_by, submitted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $5='INVIATO' THEN now() ELSE NULL END) RETURNING id`,
    [number, c.struttura_id, c.kind, isSede ? 'SISTEMA' : 'OPERATIONS', isSede ? 'INVIATO' : 'BOZZA', `Generato dalla giacenza di ${c.month.slice(0, 7)}`, c.id, req.user.id]);
    const orderId = o.rows[0].id;
    let proposed = 0;
    for (const l of c.lines) {
      const p = cons.map.get(l.article_id);
      const qty = isSede ? proposeQty({ prodPacks: p?.packs || 0, stockPacks: l.counted_qty, factor: l.coverage_factor, formula }) : 0;
      proposed += qty;
      await cl.query(`INSERT INTO order_lines (order_id, article_id, qty_requested, qty_proposed, qty_approved, prod_units_avg, prod_packs_avg, stock_packs, last_order_qty)
        VALUES ($1,$2,$3,$3,$3,$4,$5,$6,$7)`, [orderId, l.article_id, qty, p?.units ?? null, p?.packs ?? null, l.counted_qty, l.last_order_qty]);
    }
    await cl.query("UPDATE stock_counts SET status='CONFERMATO', confirmed_by=$2, confirmed_at=now(), order_id=$3, updated_at=now() WHERE id=$1", [c.id, req.user.id, orderId]);
    await cl.query('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,$2,$3,$4)', [orderId, req.user.id, isSede ? 'Ordine potenziale generato dalla giacenza' : 'Bozza aperta dalla giacenza del laboratorio', JSON.stringify({ formula, months: cons.months, proposed })]);
    return { orderId, number, adjusted, proposed };
  });
  await audit(req, 'STOCK_COUNT_CONFIRM', 'stock_count', c.id, result);
  const to = await opsEmails();
  if (to.length) await sendMail({ kind: 'GIACENZA', refKey: `GIACENZA:${c.id}`, to, strutturaId: c.struttura_id, subject: `Giacenza ${c.month.slice(0, 7)} confermata · ${s.name}`, title: 'Giacenza mensile confermata',
    body: c.kind === 'SEDE' ? `${s.name} ha confermato la giacenza di ${c.month.slice(0, 7)}. Il sistema ha generato l'ordine potenziale ${result.number} (${result.proposed} confezioni proposte): verificalo e approvalo in Orders Management.` : `${s.name} ha confermato la giacenza di ${c.month.slice(0, 7)}. È aperta la bozza d'ordine ${result.number} da compilare e approvare.` });
  res.json(result);
}));

// Consumo medio per articolo con dettaglio degli esami (per la verifica dell'Area Operations)
r.get('/consumption', ah(async (req, res) => {
  const sid = targetStruttura(req);
  await assertStruttura(req.user, sid);
  const months = Number(req.query.months || await getSetting('production_months', '3'));
  const cons = await consumptionByArticle(sid, months);
  res.json({ months: cons.months, items: [...cons.map.entries()].map(([article_id, v]) => ({ article_id, ...v })) });
}));

// ---------------- Difformità ----------------
r.get('/issues', ah(async (req, res) => {
  const P = new Params();
  const where = [isOps(req.user) ? 'TRUE' : `i.struttura_id=${P.add(req.user.struttura_id)}`];
  if (req.query.status) where.push(`i.status=${P.add(req.query.status)}`);
  res.json(await many(`SELECT i.*, o.number AS order_number, s.name AS struttura_name, u.full_name AS opened_by_name FROM issues i LEFT JOIN orders o ON o.id=i.order_id JOIN strutture s ON s.id=i.struttura_id LEFT JOIN users u ON u.id=i.opened_by
    WHERE ${where.join(' AND ')} ORDER BY i.status, i.opened_at DESC LIMIT 300`, P.values));
}));
r.post('/issues/:id/close', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const { response } = parse(z.object({ response: z.string().min(3).max(1000) }), req.body);
  const i = await one("UPDATE issues SET status='CHIUSA', response=$2, closed_by=$3, closed_at=now() WHERE id=$1 AND status='APERTA' RETURNING *", [req.params.id, response, req.user.id]);
  if (!i) throw notFound();
  if (i.order_id) await q('INSERT INTO order_events (order_id, user_id, event, data) VALUES ($1,$2,$3,$4)', [i.order_id, req.user.id, 'Difformità chiusa', JSON.stringify({ response })]);
  const s = await one('SELECT email, name FROM strutture WHERE id=$1', [i.struttura_id]);
  if (s?.email) await sendMail({ kind: 'DIFFORMITA_CHIUSA', to: s.email, strutturaId: i.struttura_id, sentBy: req.user.id, subject: 'Difformità gestita da Toscana Diagnostica', title: 'Difformità gestita', body: `Segnalazione: ${i.description}\n\nRisposta dell'Area Operations: ${response}` });
  await audit(req, 'ISSUE_CLOSE', 'issue', i.id);
  res.json({ ok: true });
}));

export default r;
export { enrichLines, stockByArticle };
