import { Router } from 'express';
import ExcelJS from 'exceljs';
import { one, many } from '../db.js';
import { ah, todayRome, getSetting, itDate } from '../lib/util.js';
import { isOps, Params, requireRole, OPS_ROLES } from '../lib/access.js';
import { pendingStockCounts } from '../lib/alerts.js';

const r = Router();

// Cruscotto: Area Operations vede tutta la filiera; le strutture la propria situazione
r.get('/dashboard', ah(async (req, res) => {
  const P = new Params();
  const scope = isOps(req.user) ? 'TRUE' : `o.struttura_id=${P.add(req.user.struttura_id)}`;
  const byStatus = await many(`SELECT o.status, count(*)::int AS n, coalesce(sum(CASE WHEN o.urgent THEN 1 ELSE 0 END),0)::int AS urgent FROM orders o WHERE ${scope} AND o.status NOT IN ('CHIUSO','ANNULLATO') GROUP BY o.status`, P.values);
  const recent = await many(`SELECT o.id, o.number, o.status, o.kind, o.urgent, o.created_at, o.updated_at, s.name AS struttura_name,
      (SELECT coalesce(sum(coalesce(l.qty_approved, l.qty_requested)),0)::int FROM order_lines l WHERE l.order_id=o.id) AS packs_total,
      (SELECT count(*)::int FROM order_lines l WHERE l.order_id=o.id AND l.delta_pct IS NOT NULL AND abs(l.delta_pct) > 50) AS anomalies
    FROM orders o JOIN strutture s ON s.id=o.struttura_id WHERE ${scope} ORDER BY o.updated_at DESC LIMIT 12`, P.values);
  const issues = await one(`SELECT count(*)::int AS n FROM issues i JOIN orders o ON o.id=i.order_id WHERE i.status='APERTA' AND ${scope}`, P.values);
  const month = todayRome().slice(0, 7);
  const monthly = await many(`SELECT to_char(date_trunc('month', o.created_at AT TIME ZONE 'Europe/Rome'), 'YYYY-MM') AS m, count(*)::int AS orders,
      coalesce(sum((SELECT sum(coalesce(l.qty_approved, l.qty_requested)) FROM order_lines l WHERE l.order_id=o.id)),0)::int AS packs
    FROM orders o WHERE ${scope} AND o.status <> 'ANNULLATO' AND o.created_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`, P.values);
  const out = { byStatus, recent, openIssues: issues.n, monthly, month };
  if (isOps(req.user)) {
    out.pendingCounts = await pendingStockCounts(month);
    out.lowStock = await many(`SELECT s.id AS struttura_id, s.name AS struttura_name, a.name AS article_name, a.code AS article_code, a.min_stock_packs,
        (SELECT count(*)::int FROM packages p WHERE p.struttura_id=s.id AND p.article_id=a.id AND p.status='RICEVUTO') AS packs
      FROM strutture s CROSS JOIN articles a WHERE s.active AND s.kind IN ('SEDE','LAB') AND a.active AND a.min_stock_packs > 0
        AND (SELECT count(*) FROM packages p WHERE p.struttura_id=s.id AND p.article_id=a.id AND p.status='RICEVUTO') < a.min_stock_packs ORDER BY s.name, a.sort LIMIT 50`);
    out.supplier = { last_poll_at: await getSetting('silva_last_poll_at', null), last_feed_at: await getSetting('silva_last_feed_at', null), last_hl7_at: await getSetting('studiolab_last_hl7_at', null) };
    out.strutture = await one(`SELECT count(*) FILTER (WHERE kind='CLIENTE')::int AS clienti, count(*) FILTER (WHERE kind='SEDE')::int AS sedi, count(*) FILTER (WHERE kind='LAB')::int AS lab FROM strutture WHERE active`);
    out.topArticles = await many(`SELECT a.name, a.code, sum(coalesce(l.qty_approved, l.qty_requested))::int AS packs FROM order_lines l JOIN orders o ON o.id=l.order_id JOIN articles a ON a.id=l.article_id
      WHERE o.status IN ('APPROVATO','PRESO_IN_CARICO','SPEDITO','CONSEGNATO','IMMAGAZZINATO','CHIUSO') AND o.created_at > now() - interval '3 months' GROUP BY a.id ORDER BY packs DESC LIMIT 8`);
  } else {
    const sid = req.user.struttura_id;
    out.stock = await one(`SELECT count(*) FILTER (WHERE status='RICEVUTO')::int AS packs, count(*) FILTER (WHERE status='ATTESO')::int AS incoming,
      count(*) FILTER (WHERE status='IN_USO' AND used_at >= date_trunc('month', now() AT TIME ZONE 'Europe/Rome'))::int AS used_month,
      count(*) FILTER (WHERE status='RICEVUTO' AND expiry IS NOT NULL AND expiry < current_date + 60)::int AS expiring FROM packages WHERE struttura_id=$1`, [sid]);
    if (req.user.struttura_kind !== 'CLIENTE') {
      const c = await one(`SELECT id, status FROM stock_counts WHERE struttura_id=$1 AND month=$2`, [sid, `${month}-01`]);
      out.stockCount = { month, deadline: req.user.stock_deadline_day, status: c?.status || 'DA_INSERIRE', id: c?.id || null };
    }
    out.toReceive = await many(`SELECT o.id, o.number, o.delivered_at AS transmitted_at FROM orders o WHERE o.struttura_id=$1 AND o.status='CONSEGNATO' ORDER BY o.delivered_at`, [sid]);
    out.inTransit = await many(`SELECT o.id, o.number, o.status FROM orders o WHERE o.struttura_id=$1 AND o.status IN ('APPROVATO','PRESO_IN_CARICO','SPEDITO') ORDER BY o.approved_at`, [sid]);
  }
  res.json(out);
}));

// Riepilogo scorte di tutta la rete (Area Operations)
r.get('/network-stock', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  res.json(await many(`SELECT s.id AS struttura_id, s.name AS struttura_name, s.kind, a.id AS article_id, a.code AS article_code, a.name AS article_name, a.category_code,
      count(p.id) FILTER (WHERE p.status='RICEVUTO')::int AS packs, count(p.id) FILTER (WHERE p.status='ATTESO')::int AS incoming
    FROM strutture s CROSS JOIN articles a LEFT JOIN packages p ON p.struttura_id=s.id AND p.article_id=a.id
    WHERE s.active AND s.kind IN ('SEDE','LAB') AND a.active GROUP BY s.id, a.id HAVING count(p.id) > 0 ORDER BY s.name, a.sort`));
}));

const xlsxHeaders = (ws, headers) => { ws.addRow(headers); ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; ws.columns.forEach((c) => { c.width = 22; }); };

r.get('/export/orders.xlsx', ah(async (req, res) => {
  const P = new Params();
  const scope = isOps(req.user) ? 'TRUE' : `o.struttura_id=${P.add(req.user.struttura_id)}`;
  const rows = await many(`SELECT o.number, o.status, o.kind, o.origin, o.urgent, o.created_at, o.submitted_at, o.approved_at, o.shipped_at AS transmitted_at, o.delivered_at AS received_at, o.closed_at, o.silva_reference, s.code AS scode, s.name AS sname,
      a.code AS acode, a.name AS aname, a.pack_label, l.qty_requested, l.qty_proposed, l.qty_approved, l.prod_packs_avg, l.delta_pct, l.stock_packs, l.qty_received, l.note_client, l.note_ops
    FROM orders o JOIN strutture s ON s.id=o.struttura_id JOIN order_lines l ON l.order_id=o.id JOIN articles a ON a.id=l.article_id WHERE ${scope} ORDER BY o.created_at DESC, a.sort`, P.values);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Ordini');
  xlsxHeaders(ws, ['Ordine', 'Stato', 'Tipo', 'Origine', 'Urgente', 'Creato', 'Inviato', 'Approvato', 'Trasmesso', 'Ricevuto', 'Chiuso', 'Rif. fornitore', 'Cod. struttura', 'Struttura', 'Cod. articolo', 'Articolo', 'Confezione', 'Richiesto', 'Proposto', 'Approvato', 'Produzione media (conf.)', 'Delta %', 'Giacenza', 'Ricevuto', 'Note richiedente', 'Note Operations']);
  for (const x of rows) ws.addRow([x.number, x.status, x.kind, x.origin, x.urgent ? 'Sì' : 'No', itDate(x.created_at), itDate(x.submitted_at), itDate(x.approved_at), itDate(x.transmitted_at), itDate(x.received_at), itDate(x.closed_at), x.silva_reference, x.scode, x.sname, x.acode, x.aname, x.pack_label, x.qty_requested, x.qty_proposed, x.qty_approved, x.prod_packs_avg, x.delta_pct, x.stock_packs, x.qty_received, x.note_client, x.note_ops]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ordini_${todayRome()}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

r.get('/export/stock.xlsx', ah(async (req, res) => {
  const P = new Params();
  const scope = isOps(req.user) ? 'TRUE' : `p.struttura_id=${P.add(req.user.struttura_id)}`;
  const rows = await many(`SELECT s.code AS scode, s.name AS sname, a.code AS acode, a.name AS aname, a.pack_label, p.status, p.lot, p.expiry, p.received_at, p.used_at, p.origin, o.number
    FROM packages p JOIN strutture s ON s.id=p.struttura_id JOIN articles a ON a.id=p.article_id LEFT JOIN orders o ON o.id=p.order_id WHERE ${scope} AND p.status IN ('RICEVUTO','ATTESO') ORDER BY s.name, a.sort, p.expiry NULLS LAST`, P.values);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Giacenza');
  xlsxHeaders(ws, ['Cod. struttura', 'Struttura', 'Cod. articolo', 'Articolo', 'Confezione', 'Stato', 'Lotto', 'Scadenza', 'Ricevuto il', 'Origine', 'Ordine']);
  for (const x of rows) ws.addRow([x.scode, x.sname, x.acode, x.aname, x.pack_label, x.status, x.lot, itDate(x.expiry), itDate(x.received_at), x.origin, x.number]);
  const sum = wb.addWorksheet('Riepilogo');
  xlsxHeaders(sum, ['Struttura', 'Articolo', 'Confezioni in giacenza', 'In arrivo']);
  const agg = new Map();
  for (const x of rows) { const k = `${x.sname}|${x.aname}`; const v = agg.get(k) || [x.sname, x.aname, 0, 0]; if (x.status === 'RICEVUTO') v[2]++; else v[3]++; agg.set(k, v); }
  for (const v of agg.values()) sum.addRow(v);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="giacenza_${todayRome()}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

export default r;
export { getSetting };
