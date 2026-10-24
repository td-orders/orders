// Logica di dominio degli ordini: numerazione, arricchimento righe con produzione e giacenza, approvazione con creazione
// delle confezioni attese, ricezione, proposta d'ordine mensile.
import { one, many, q } from '../db.js';
import { bad, getSetting } from './util.js';
import { consumptionByArticle } from './studiolab.js';

export const ARTICLE_COLS = `a.code AS article_code, a.name AS article_name, a.category_code, a.unit, a.pack_size, a.pack_label, a.color, a.gtin, a.coverage_factor`;

export async function nextOrderNumber(client) {
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' }).format(new Date()));
  const r = await client.query(`INSERT INTO order_counters (year, last) VALUES ($1, 1) ON CONFLICT (year) DO UPDATE SET last = order_counters.last + 1 RETURNING last`, [year]);
  return `ORD-${year}-${String(r.rows[0].last).padStart(4, '0')}`;
}

// Giacenza attuale per articolo (confezioni ricevute e non ancora messe in uso)
export async function stockByArticle(strutturaId) {
  const rows = await many(`SELECT article_id, count(*)::int AS packs, min(expiry) AS next_expiry FROM packages WHERE struttura_id=$1 AND status='RICEVUTO' GROUP BY article_id`, [strutturaId]);
  return new Map(rows.map((r) => [r.article_id, { packs: r.packs, next_expiry: r.next_expiry }]));
}

// Quantità dell'ultimo ordine approvato per articolo
export async function lastOrderByArticle(strutturaId, excludeOrderId = null) {
  const rows = await many(`
    SELECT DISTINCT ON (l.article_id) l.article_id, coalesce(l.qty_approved, l.qty_requested) AS qty, o.number, o.approved_at
      FROM order_lines l JOIN orders o ON o.id = l.order_id
     WHERE o.struttura_id=$1 AND o.status IN ('APPROVATO','PRESO_IN_CARICO','SPEDITO','CONSEGNATO','IMMAGAZZINATO','CHIUSO') AND ($2::int IS NULL OR o.id <> $2)
     ORDER BY l.article_id, o.approved_at DESC NULLS LAST, o.id DESC`, [strutturaId, excludeOrderId]);
  return new Map(rows.map((r) => [r.article_id, r]));
}

export async function orderLines(orderId) {
  return many(`SELECT l.*, ${ARTICLE_COLS},
      (SELECT count(*)::int FROM packages p WHERE p.line_id=l.id AND p.status IN ('RICEVUTO','IN_USO')) AS packs_received,
      (SELECT count(*)::int FROM packages p WHERE p.line_id=l.id AND p.status='NON_RICEVUTO') AS packs_missing
    FROM order_lines l JOIN articles a ON a.id=l.article_id WHERE l.order_id=$1 ORDER BY a.sort, a.code`, [orderId]);
}

/**
 * Colonne di verifica per l'Area Operations: produzione media mensile correlata (unità e confezioni), distanza % tra
 * richiesta e produzione, giacenza attuale e ultimo ordine. Salvate sulle righe così la verifica resta storicizzata.
 */
export async function enrichLines(orderId, strutturaId, kind) {
  const months = Number(await getSetting('production_months', '3'));
  const prod = kind === 'LAB' ? { map: new Map(), months: 0 } : await consumptionByArticle(strutturaId, months);
  const stock = await stockByArticle(strutturaId);
  const last = await lastOrderByArticle(strutturaId, orderId);
  const lines = await many('SELECT l.id, l.article_id, l.qty_requested, l.qty_approved, a.pack_size FROM order_lines l JOIN articles a ON a.id=l.article_id WHERE l.order_id=$1', [orderId]);
  for (const l of lines) {
    const p = prod.map.get(l.article_id);
    const packsAvg = p ? p.packs : null;
    const delta = packsAvg && packsAvg > 0 ? Math.round(((l.qty_requested - packsAvg) / packsAvg) * 1000) / 10 : null;
    await q(`UPDATE order_lines SET prod_units_avg=$2, prod_packs_avg=$3, delta_pct=$4, stock_packs=$5, last_order_qty=$6,
             qty_approved = coalesce(qty_approved, qty_requested) WHERE id=$1`,
    [l.id, p ? p.units : null, packsAvg, delta, stock.get(l.article_id)?.packs || 0, last.get(l.article_id)?.qty ?? null]);
  }
  return { months: prod.months };
}

// Approvazione: crea una riga per ogni confezione approvata (stato ATTESO), da ricevere con scansione o spunta
export async function createPackages(client, order) {
  const lines = await client.query('SELECT id, article_id, qty_approved FROM order_lines WHERE order_id=$1', [order.id]);
  await client.query("DELETE FROM packages WHERE order_id=$1 AND status='ATTESO'", [order.id]);
  let n = 0;
  for (const l of lines.rows) {
    for (let i = 1; i <= (l.qty_approved || 0); i++) {
      await client.query('INSERT INTO packages (struttura_id, article_id, order_id, line_id, seq, status) VALUES ($1,$2,$3,$4,$5,$6)', [order.struttura_id, l.article_id, order.id, l.id, i, 'ATTESO']);
      n++;
    }
  }
  return n;
}

/**
 * Proposta d'ordine mensile dalla giacenza confermata (sedi del network).
 * Formula scelta da Francesco (DIFF_X_FACTOR): (produzione mensile - giacenza effettiva) x fattore, senza decimali, arrotondato per eccesso, mai negativa.
 * Alternativa disponibile in Impostazioni (TARGET_MINUS_STOCK): produzione x fattore - giacenza.
 */
export function proposeQty({ prodPacks, stockPacks, factor, formula }) {
  const p = Number(prodPacks || 0); const g = Number(stockPacks || 0); const f = Number(factor || 1.5);
  const raw = formula === 'TARGET_MINUS_STOCK' ? p * f - g : (p - g) * f;
  return Math.max(0, Math.ceil(raw - 1e-9));
}

export async function stockCountDetail(countId) {
  const c = await one(`SELECT c.*, s.name AS struttura_name, s.code AS struttura_code, s.kind, u.full_name AS confirmed_by_name, o.number AS order_number, o.status AS order_status
    FROM stock_counts c JOIN strutture s ON s.id=c.struttura_id LEFT JOIN users u ON u.id=c.confirmed_by LEFT JOIN orders o ON o.id=c.order_id WHERE c.id=$1`, [countId]);
  if (!c) return null;
  c.lines = await many(`SELECT l.*, ${ARTICLE_COLS} FROM stock_count_lines l JOIN articles a ON a.id=l.article_id WHERE l.count_id=$1 ORDER BY a.sort, a.code`, [countId]);
  c.extras = await many(`SELECT e.*, a.name AS article_name, a.pack_label FROM stock_count_extras e LEFT JOIN articles a ON a.id=e.article_id WHERE e.count_id=$1 ORDER BY e.id`, [countId]);
  return c;
}

// Apre (o riprende) la giacenza del mese: colonna 1 ultimo ordine, colonna 2 giacenza da scarichi, colonna 3 precompilata con la 2
export async function openStockCount(strutturaId, monthIso) {
  const month = `${monthIso.slice(0, 7)}-01`;
  let c = await one('SELECT * FROM stock_counts WHERE struttura_id=$1 AND month=$2', [strutturaId, month]);
  if (c && c.status === 'CONFERMATO') return c.id;
  if (!c) c = await one('INSERT INTO stock_counts (struttura_id, month) VALUES ($1,$2) RETURNING *', [strutturaId, month]);
  const s = await one('SELECT kind FROM strutture WHERE id=$1', [strutturaId]);
  const stock = await stockByArticle(strutturaId);
  const last = await lastOrderByArticle(strutturaId);
  // elenco della struttura: articoli visibili al suo tipo più quelli che ha comunque movimentato
  const arts = await many(`SELECT id FROM articles a WHERE a.active AND (a.visible_all OR ${s.kind === 'CLIENTE' ? 'a.visible_service' : 'a.visible_sedi'}
    OR EXISTS (SELECT 1 FROM packages p WHERE p.struttura_id=$1 AND p.article_id=a.id)) ORDER BY a.sort`, [strutturaId]);
  for (const a of arts) {
    const sys = stock.get(a.id)?.packs || 0;
    await q(`INSERT INTO stock_count_lines (count_id, article_id, last_order_qty, system_qty, counted_qty) VALUES ($1,$2,$3,$4,$4)
             ON CONFLICT (count_id, article_id) DO UPDATE SET last_order_qty=EXCLUDED.last_order_qty, system_qty=EXCLUDED.system_qty,
               counted_qty = CASE WHEN stock_count_lines.counted_qty = stock_count_lines.system_qty THEN EXCLUDED.system_qty ELSE stock_count_lines.counted_qty END`,
    [c.id, a.id, last.get(a.id)?.qty || 0, sys]);
  }
  return c.id;
}

export function assertStatus(order, ...allowed) {
  if (!allowed.includes(order.status)) throw bad(`Operazione non consentita nello stato "${order.status}"`);
}
