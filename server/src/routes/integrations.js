// API per i sistemi esterni. Autenticazione con header X-API-KEY (o ?api_key=), chiavi distinte per fornitore.
// Nessuna sessione: queste rotte sono montate prima del controllo di login.
import { Router, text as textBody } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, parse, HttpError } from '../lib/util.js';
import { config } from '../config.js';
import { orderPayload, silvaStatus } from '../lib/silva.js';
import { byNumber, markPicked, markShipped, markDelivered, ORDER_COLS, ORDER_JOINS } from '../lib/orderflow.js';
import { ingestHl7, buildAck } from '../lib/studiolab.js';
import { orderLines } from '../lib/orders.js';

const r = Router();
const keyOf = (req) => req.get('X-API-KEY') || req.get('x-api-key') || req.query.api_key || '';
const requireKey = (expected, who) => (req, _res, next) => {
  if (!expected) return next(new HttpError(503, `Integrazione ${who} non configurata (chiave mancante nel pannello)`));
  if (keyOf(req) !== expected) return next(new HttpError(401, 'Chiave API non valida'));
  next();
};
async function setSetting(key, value) { await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, value]); }

// =====================================================================================================================
// Silva Group (gestore del magazzino)
// =====================================================================================================================
const silvaKey = () => requireKey(config.silva.inboundKey, 'Silva');

r.get('/silva/ping', silvaKey(), ah(async (_req, res) => res.json({ ok: true, cliente: config.silva.customerCode, ora: new Date().toISOString() })));

// Fase 0: feed delle giacenze di magazzino. Fotografia completa: gli articoli assenti nel feed risultano a quantità zero.
// Corpo: { articoli: [ { codice, descrizione, barcode, lotto, scadenza (AAAA-MM-GG), quantita, unita, confezione, unitaPerConfezione } ] }
const feedItem = z.object({
  codice: z.string().min(1).max(40), descrizione: z.string().max(200).optional().nullable(), barcode: z.string().max(40).optional().nullable(),
  lotto: z.string().max(60).optional().nullable(), scadenza: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional().nullable(),
  quantita: z.coerce.number().min(0).default(0), unita: z.string().max(40).optional().nullable(), confezione: z.string().max(120).optional().nullable(),
  unitaPerConfezione: z.coerce.number().int().min(1).optional().nullable(), categoria: z.string().max(40).optional().nullable(),
});
export async function applyFeed(items, source = 'API') {
  const errors = [];
  const result = await tx(async (c) => {
    const feed = (await c.query('INSERT INTO warehouse_feeds (source) VALUES ($1) RETURNING id', [source])).rows[0];
    await c.query('UPDATE warehouse_stock SET current=FALSE WHERE current');
    let newArticles = 0, n = 0;
    for (const [i, raw] of items.entries()) {
      const p = feedItem.safeParse(raw);
      if (!p.success) { errors.push(`riga ${i + 1}: ${p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`); continue; }
      const it = p.data;
      let art = (await c.query('SELECT id FROM articles WHERE silva_code=$1 OR (silva_code IS NULL AND code=$1)', [it.codice])).rows[0];
      if (!art) {
        // articolo nuovo dal magazzino: nasce nascosto, l'Area Operations decide a chi renderlo visibile
        const cat = it.categoria && (await c.query('SELECT 1 FROM categories WHERE code=$1', [it.categoria])).rowCount ? it.categoria : 'MAGAZZINO';
        art = (await c.query(`INSERT INTO articles (code, silva_code, category_code, name, unit, pack_size, pack_label, gtin, source, active, visible_all, visible_sedi, visible_service, sort)
          VALUES ($1,$1,$2,$3,$4,$5,$6,$7,'SILVA',TRUE,FALSE,FALSE,FALSE,(SELECT coalesce(max(sort),0)+1 FROM articles)) RETURNING id`,
        [it.codice, cat, it.descrizione || it.codice, it.unita || 'n.', it.unitaPerConfezione || 1, it.confezione || (it.unitaPerConfezione ? `confezione da ${it.unitaPerConfezione}` : 'confezione'), it.barcode || null])).rows[0];
        newArticles++;
      } else {
        await c.query('UPDATE articles SET silva_code=coalesce(silva_code,$2), gtin=coalesce(gtin,$3), updated_at=now() WHERE id=$1', [art.id, it.codice, it.barcode || null]);
      }
      await c.query('INSERT INTO warehouse_stock (feed_id, article_id, silva_code, description, lot, expiry, qty, unit, barcode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [feed.id, art.id, it.codice, it.descrizione || null, it.lotto || null, it.scadenza ? it.scadenza.slice(0, 10) : null, it.quantita, it.unita || null, it.barcode || null]);
      n++;
    }
    await c.query('UPDATE warehouse_feeds SET items=$2, new_articles=$3, errors=$4 WHERE id=$1', [feed.id, n, newArticles, errors.length ? JSON.stringify(errors) : null]);
    return { feedId: feed.id, items: n, newArticles };
  });
  await setSetting('silva_last_feed_at', new Date().toISOString());
  return { ...result, errors };
}
r.post('/silva/stock', silvaKey(), ah(async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.articoli || req.body?.items;
  if (!Array.isArray(items)) throw bad('Atteso { articoli: [...] }');
  res.json(await applyFeed(items, 'API'));
}));

// Fase 3: ordini da preparare. Il fornitore li legge ogni 5 minuti; ?stato=APPROVATO (default) oppure tutti gli aperti.
r.get('/silva/orders', silvaKey(), ah(async (req, res) => {
  const statuses = req.query.stato ? String(req.query.stato).split(',') : ['APPROVATO'];
  const orders = await many(`SELECT ${ORDER_COLS} ${ORDER_JOINS} WHERE o.status = ANY($1::text[]) ORDER BY o.urgent DESC, o.approved_at`, [statuses]);
  const out = [];
  for (const o of orders) {
    const s = await one('SELECT * FROM strutture WHERE id=$1', [o.struttura_id]);
    const lines = await many(`SELECT l.*, a.code AS article_code, a.name AS article_name, a.unit, a.pack_size, a.pack_label, a.gtin, a.silva_code FROM order_lines l JOIN articles a ON a.id=l.article_id WHERE l.order_id=$1 ORDER BY a.sort`, [o.id]);
    out.push(orderPayload(o, s, lines));
  }
  await q('UPDATE orders SET polled_at=now() WHERE status = ANY($1::text[])', [statuses]);
  await setSetting('silva_last_poll_at', new Date().toISOString());
  res.json({ ordini: out, letto: new Date().toISOString() });
}));
r.get('/silva/orders/:numero', silvaKey(), ah(async (req, res) => {
  const o = await byNumber(req.params.numero);
  const s = await one('SELECT * FROM strutture WHERE id=$1', [o.struttura_id]);
  res.json(orderPayload(o, s, await orderLines(o.id)));
}));

// Fase 3/4: avanzamento comunicato dal fornitore
r.post('/silva/orders/:numero/presa-in-carico', silvaKey(), ah(async (req, res) => {
  const d = parse(z.object({ riferimento: z.string().max(80).optional().nullable() }), req.body || {});
  res.json(await markPicked(await byNumber(req.params.numero), { reference: d.riferimento, actor: 'Silva API' }));
}));
r.post('/silva/orders/:numero/spedito', silvaKey(), ah(async (req, res) => {
  const d = parse(z.object({ ddt: z.string().max(80).optional().nullable(), data: z.string().optional().nullable() }), req.body || {});
  res.json(await markShipped(await byNumber(req.params.numero), { ddt: d.ddt, actor: 'Silva API' }));
}));
// Corpo: { ddt, data, righe: [ { codiceArticolo, confezioni, lotto, scadenza, barcodes: [uno per confezione] } ] } (righe facoltative)
r.post('/silva/orders/:numero/consegnato', silvaKey(), ah(async (req, res) => {
  const d = parse(z.object({ ddt: z.string().max(80).optional().nullable(), data: z.string().optional().nullable(), righe: z.array(z.object({}).passthrough()).optional() }), req.body || {});
  res.json(await markDelivered(await byNumber(req.params.numero), { ddt: d.ddt, lines: d.righe, actor: 'Silva API' }));
}));

// =====================================================================================================================
// StudioLab ServiceNET (CB Sistemi): HL7 over HTTPS in ingresso
// =====================================================================================================================
// POST testo HL7 (Content-Type text/plain), header X-API-KEY = STUDIOLAB_INBOUND_KEY. Risposta sempre 200 con l'ACK nel corpo.
r.post('/studiolab/hl7', textBody({ type: '*/*', limit: '5mb' }), ah(async (req, res) => {
  res.type('text/plain');
  if (!config.studiolab.inboundKey) return res.status(503).send('Integrazione StudioLab in ingresso non configurata');
  if (keyOf(req) !== config.studiolab.inboundKey) return res.status(401).send('Chiave API non valida');
  const body = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  try {
    const out = await ingestHl7(body);
    await setSetting('studiolab_last_hl7_at', new Date().toISOString());
    res.send(out.ack);
  } catch (e) {
    res.send(buildAck(null, 'AE', null, e.message));
  }
}));

r.get('/status', ah(async (_req, res) => res.json({ silva: silvaStatus(), studiolab: config.studiolab.enabled })));

export default r;
