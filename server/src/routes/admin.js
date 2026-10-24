import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse, getSetting } from '../lib/util.js';
import { requireRole, isOps, isSuper, Params, OPS_ROLES } from '../lib/access.js';
import { mailStatus, sendMail } from '../lib/mailer.js';
import { studiolabStatus } from '../lib/studiolab.js';
import { silvaStatus } from '../lib/silva.js';
import { config } from '../config.js';
import multer from 'multer';
import ExcelJS from 'exceljs';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const CODE = /^[A-Z0-9_-]{2,16}$/;

// ---------------- Strutture ----------------
const strutturaFields = {
  name: z.string().min(2).max(200),
  address: opt(z.string().max(200)), zip: opt(z.string().max(10)), city: opt(z.string().max(100)), province: opt(z.string().max(4).transform((v) => v?.toUpperCase())),
  phone: opt(z.string().max(40)), email: opt(z.string().email().or(z.literal(''))), pec: opt(z.string().email().or(z.literal(''))),
  referente: opt(z.string().max(120)), referente_phone: opt(z.string().max(40)),
  studiolab_code: opt(z.string().max(40)), delivery_notes: opt(z.string().max(500)),
  delivery_mode: z.enum(['GIRO', 'RITIRO']).optional(),
  stock_deadline_day: z.coerce.number().int().min(1).max(31).optional(),
  active: z.boolean().optional(),
};
const STRUTTURA_COLS = `s.*, (SELECT count(*)::int FROM users u WHERE u.struttura_id=s.id AND u.active) AS users_count,
  (SELECT string_agg(u.full_name, ', ' ORDER BY u.full_name) FROM users u WHERE u.struttura_id=s.id AND u.active AND u.is_referente) AS referenti,
  (SELECT count(*)::int FROM orders o WHERE o.struttura_id=s.id AND o.status NOT IN ('CHIUSO','ANNULLATO')) AS open_orders,
  (SELECT max(month) FROM stock_counts c WHERE c.struttura_id=s.id AND c.status='CONFERMATO') AS last_stock_month`;

r.get('/strutture', ah(async (req, res) => {
  const P = new Params();
  const where = [isOps(req.user) ? 'TRUE' : `s.id=${P.add(req.user.struttura_id)}`];
  if (req.query.kind) where.push(`s.kind=${P.add(req.query.kind)}`);
  res.json(await many(`SELECT ${STRUTTURA_COLS} FROM strutture s WHERE ${where.join(' AND ')} ORDER BY s.kind, s.name`, P.values));
}));

r.get('/strutture/:id', ah(async (req, res) => {
  const s = await one(`SELECT ${STRUTTURA_COLS} FROM strutture s WHERE s.id=$1`, [req.params.id]);
  if (!s) throw notFound();
  if (!isOps(req.user) && s.id !== req.user.struttura_id) throw forbidden();
  res.json(s);
}));

r.post('/strutture', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ kind: z.enum(['CLIENTE', 'SEDE', 'LAB']), code: z.string().regex(CODE, 'codice: 2-16 caratteri maiuscoli, numeri, - o _'), ...strutturaFields }), req.body);
  if (await one('SELECT 1 FROM strutture WHERE code=$1', [d.code])) throw bad('Codice struttura già esistente');
  if (d.stock_deadline_day == null) d.stock_deadline_day = d.kind === 'LAB' ? 30 : 15;
  const cols = Object.keys(d);
  const row = await one(`INSERT INTO strutture (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, cols.map((c) => d[c]));
  await audit(req, 'STRUTTURA_CREATE', 'struttura', row.id, d);
  res.status(201).json(row);
}));

r.put('/strutture/:id', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const s = await one('SELECT * FROM strutture WHERE id=$1', [req.params.id]);
  if (!s) throw notFound();
  const d = parse(z.object(strutturaFields), req.body);
  if (!isSuper(req.user)) delete d.active;
  const cols = Object.keys(d);
  if (!cols.length) throw bad('Nessun dato');
  await q(`UPDATE strutture SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1`, [s.id, ...cols.map((c) => d[c])]);
  await audit(req, 'STRUTTURA_UPDATE', 'struttura', s.id, d);
  res.json({ ok: true });
}));

// Eliminazione di una struttura: solo senza attività registrata (ordini, confezioni, giacenze, produzione, utenti); altrimenti si disattiva
r.delete('/strutture/:id', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const s = await one('SELECT * FROM strutture WHERE id=$1', [req.params.id]);
  if (!s) throw notFound();
  if (s.kind === 'LAB') throw bad('Il laboratorio TD non si elimina');
  const used = await one(`SELECT (SELECT count(*) FROM orders WHERE struttura_id=$1)::int AS orders, (SELECT count(*) FROM packages WHERE struttura_id=$1)::int AS packages,
    (SELECT count(*) FROM stock_counts WHERE struttura_id=$1)::int AS counts, (SELECT count(*) FROM production WHERE struttura_id=$1)::int AS production, (SELECT count(*) FROM users WHERE struttura_id=$1)::int AS users`, [s.id]);
  const busy = Object.entries(used).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${{ orders: 'ordini', packages: 'confezioni', counts: 'giacenze mensili', production: 'righe di produzione', users: 'utenti' }[k]}`);
  if (busy.length) throw bad(`Struttura con attività registrata (${busy.join(', ')}): disattivala invece di eliminarla`);
  await q('DELETE FROM email_log WHERE struttura_id=$1', [s.id]);
  await q('DELETE FROM issues WHERE struttura_id=$1', [s.id]);
  await q('DELETE FROM strutture WHERE id=$1', [s.id]);
  await audit(req, 'STRUTTURA_DELETE', 'struttura', s.id, { code: s.code, name: s.name });
  res.json({ ok: true });
}));

// Import dell'elenco clienti esportato da StudioLab (colonne: CodiceCliente, Profilo, RagSoc, PartIVA, CodFisc, PersonaDiRiferimento, Indirizzo, Cap, Citta, Provincia, Telefono1, ...)
// Aggiorna le strutture esistenti per codice e crea quelle nuove; non disattiva nulla.
r.post('/strutture/import', requireRole('SUPERADMIN'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];
  const head = ws.getRow(1).values.slice(1).map((v) => String(v || '').trim().toLowerCase());
  const col = (name) => head.indexOf(name.toLowerCase());
  const need = ['codicecliente', 'profilo', 'ragsoc'];
  for (const k of need) if (col(k) < 0) throw bad(`Colonna ${k} mancante nel file`);
  const txt = (row, name) => { const i = col(name); if (i < 0) return ''; const v = row.values.slice(1)[i]; return v == null ? '' : String(typeof v === 'object' && 'text' in v ? v.text : v).trim(); };
  let created = 0, updated = 0;
  await tx(async (c) => {
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const code = txt(row, 'codicecliente'); if (!code) continue;
      const kind = /sede/i.test(txt(row, 'profilo')) ? 'SEDE' : 'CLIENTE';
      const email = (txt(row, 'email').match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0].toLowerCase();
      const vals = [code, kind, txt(row, 'ragsoc'), txt(row, 'indirizzo') || null, txt(row, 'cap') || null, txt(row, 'citta') || null, (txt(row, 'provincia') || '').toUpperCase().slice(0, 2) || null, txt(row, 'telefono1') || txt(row, 'telefono2') || null, email || null, txt(row, 'personadiriferimento') || null];
      const ex = await c.query('SELECT id FROM strutture WHERE code=$1', [code]);
      if (ex.rows.length) {
        await c.query(`UPDATE strutture SET name=$3, address=coalesce($4, address), zip=coalesce($5, zip), city=coalesce($6, city), province=coalesce($7, province), phone=coalesce($8, phone), email=coalesce($9, email), referente=coalesce($10, referente), studiolab_code=coalesce(studiolab_code, $1), updated_at=now() WHERE code=$1`, vals);
        updated++;
      } else {
        await c.query(`INSERT INTO strutture (code, kind, name, address, zip, city, province, phone, email, referente, studiolab_code, stock_deadline_day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$1,15)`, vals);
        created++;
      }
    }
  });
  await audit(req, 'STRUTTURE_IMPORT', 'struttura', null, { created, updated });
  res.json({ created, updated });
}));

// ---------------- Utenti ----------------
const userFields = {
  email: z.string().email(), full_name: z.string().min(2).max(120),
  role: z.enum(['SUPERADMIN', 'PROCUREMENT', 'CLIENTE', 'SEDE', 'LAB']),
  struttura_id: opt(z.coerce.number().int()),
  auth_provider: z.enum(['LOCAL', 'ENTRA', 'BOTH', 'STUDIOLAB']).default('BOTH'),
  studiolab_username: opt(z.string().max(100)),
  is_referente: z.boolean().optional(),
  active: z.boolean().optional(),
};
const USER_COLS = `u.id, u.email, u.full_name, u.role, u.struttura_id, u.auth_provider, u.studiolab_username, u.is_referente, u.active, u.totp_enabled, u.must_change_password, u.last_login_at, u.locked_until,
  s.name AS struttura_name, s.kind AS struttura_kind`;
const tempPassword = () => `Td-${crypto.randomBytes(9).toString('base64url')}-${crypto.randomInt(10, 99)}`;

async function validateUser(req, d, existing) {
  if (['SUPERADMIN', 'PROCUREMENT'].includes(d.role)) { d.struttura_id = null; d.is_referente = false; }
  else {
    if (!d.struttura_id) throw bad('Struttura obbligatoria per questo profilo');
    const s = await one('SELECT * FROM strutture WHERE id=$1', [d.struttura_id]);
    if (!s) throw bad('Struttura inesistente');
    const expected = { CLIENTE: 'CLIENTE', SEDE: 'SEDE', LAB: 'LAB' }[d.role];
    if (s.kind !== expected) throw bad(`Il profilo ${d.role} richiede una struttura di tipo ${expected}`);
  }
  if (d.role === 'SUPERADMIN' && !isSuper(req.user)) throw forbidden('Solo il super amministratore crea super amministratori');
  if (existing?.role === 'SUPERADMIN' && !isSuper(req.user)) throw forbidden();
  if (d.auth_provider === 'STUDIOLAB' && d.role !== 'CLIENTE') throw bad('Le credenziali StudioLab valgono solo per il profilo Cliente');
}

r.get('/users', requireRole(...OPS_ROLES), ah(async (req, res) => {
  res.json(await many(`SELECT ${USER_COLS} FROM users u LEFT JOIN strutture s ON s.id=u.struttura_id ORDER BY u.role, s.name NULLS FIRST, u.full_name`));
}));

r.post('/users', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object(userFields), req.body);
  await validateUser(req, d);
  if (await one('SELECT 1 FROM users WHERE lower(email)=lower($1)', [d.email])) throw bad('Email già registrata');
  let pwd = null, hash = null;
  if (['LOCAL', 'BOTH'].includes(d.auth_provider)) { pwd = tempPassword(); hash = await bcrypt.hash(pwd, 12); }
  const row = await one(`INSERT INTO users (email, full_name, role, struttura_id, auth_provider, studiolab_username, is_referente, password_hash, must_change_password)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id`, [d.email, d.full_name, d.role, d.struttura_id, d.auth_provider, d.studiolab_username, Boolean(d.is_referente), hash]);
  await audit(req, 'USER_CREATE', 'user', row.id, { email: d.email, role: d.role, struttura_id: d.struttura_id });
  res.status(201).json({ id: row.id, temporaryPassword: pwd });
}));

r.put('/users/:id', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!u) throw notFound();
  const d = parse(z.object(userFields), req.body);
  await validateUser(req, d, u);
  if (u.id === req.user.id && (d.active === false || d.role !== u.role)) throw bad('Non puoi disattivare o cambiare ruolo al tuo utente');
  await q(`UPDATE users SET email=$2, full_name=$3, role=$4, struttura_id=$5, auth_provider=$6, studiolab_username=$7, is_referente=$8, active=coalesce($9, active), updated_at=now() WHERE id=$1`,
    [u.id, d.email, d.full_name, d.role, d.struttura_id, d.auth_provider, d.studiolab_username, Boolean(d.is_referente), d.active ?? null]);
  await audit(req, 'USER_UPDATE', 'user', u.id, d);
  res.json({ ok: true });
}));

// Eliminazione di un utente: solo senza attività registrata (ordini, ricezioni, giacenze); altrimenti si disattiva
r.delete('/users/:id', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!u) throw notFound();
  if (u.id === req.user.id) throw bad('Non puoi eliminare il tuo utente');
  if (u.role === 'SUPERADMIN' && !isSuper(req.user)) throw forbidden();
  try {
    await tx(async (c) => {
      await c.query('DELETE FROM email_log WHERE sent_by=$1', [u.id]);
      await c.query('DELETE FROM users WHERE id=$1', [u.id]);
    });
  } catch (e) {
    if (e.code === '23503') throw bad('Utente con attività registrata (ordini, ricezioni, giacenze): disattivalo invece di eliminarlo');
    throw e;
  }
  await audit(req, 'USER_DELETE', 'user', u.id, { email: u.email, role: u.role });
  res.json({ ok: true });
}));

r.post('/users/:id/reset-password', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!u) throw notFound();
  if (u.role === 'SUPERADMIN' && !isSuper(req.user)) throw forbidden();
  const pwd = tempPassword();
  await q('UPDATE users SET password_hash=$2, must_change_password=TRUE, failed_logins=0, locked_until=NULL, updated_at=now() WHERE id=$1', [u.id, await bcrypt.hash(pwd, 12)]);
  await audit(req, 'USER_RESET_PASSWORD', 'user', u.id);
  // Le credenziali generate dall'app si consegnano al cliente: se c'è la casella, partono anche via email
  let mailed = null;
  if (req.body?.sendEmail && u.email && !u.email.endsWith('@studiolab.local')) {
    mailed = await sendMail({ kind: 'CREDENZIALI', to: u.email, strutturaId: u.struttura_id, sentBy: req.user.id, subject: 'Orders Management · credenziali di accesso', title: 'Credenziali di accesso',
      body: `Buongiorno ${u.full_name},\n\nqueste sono le credenziali per accedere a Orders Management di Toscana Diagnostica (${config.baseUrl}).\n\nEmail: ${u.email}\nPassword temporanea: ${pwd}\n\nAl primo accesso il sistema chiede di scegliere una password personale.` });
  }
  res.json({ temporaryPassword: pwd, mailed: mailed?.status || null });
}));

r.post('/users/:id/reset-totp', requireRole('SUPERADMIN'), ah(async (req, res) => {
  await q('UPDATE users SET totp_secret=NULL, totp_enabled=FALSE, updated_at=now() WHERE id=$1', [req.params.id]);
  await audit(req, 'USER_RESET_TOTP', 'user', req.params.id);
  res.json({ ok: true });
}));

// ---------------- Catalogo ----------------
r.get('/categories', ah(async (_req, res) => res.json(await many('SELECT * FROM categories ORDER BY sort'))));

// Catalogo: l'Area Operations vede tutto (con ?all=1 anche i disattivati); le strutture solo gli articoli resi visibili al loro tipo (fase 0)
export const visibleClause = (user, alias = 'a') => {
  if (isOps(user)) return 'TRUE';
  const k = user.struttura_kind === 'CLIENTE' ? `${alias}.visible_service` : `${alias}.visible_sedi`;
  return `(${alias}.visible_all OR ${k})`;
};
r.get('/articles', ah(async (req, res) => {
  const all = req.query.all === '1' && isOps(req.user);
  res.json(await many(`SELECT a.*, c.name AS category_name, c.icon,
      (SELECT count(*)::int FROM exam_mappings m WHERE m.article_id=a.id AND m.active) AS mappings_count
    FROM articles a JOIN categories c ON c.code=a.category_code WHERE ($1 OR a.active) AND ${visibleClause(req.user)} ORDER BY c.sort, a.sort, a.code`, [all]));
}));

const articleFields = {
  name: z.string().min(2).max(200), unit: z.string().min(1).max(60), pack_size: z.coerce.number().int().min(1), pack_label: z.string().min(1).max(120),
  color: opt(z.string().max(12)), gtin: opt(z.string().max(32)), silva_code: opt(z.string().max(40)), coverage_factor: z.coerce.number().min(0).max(12).optional(),
  visible_all: z.boolean().optional(), visible_sedi: z.boolean().optional(), visible_service: z.boolean().optional(),
  min_stock_packs: z.coerce.number().int().min(0).optional(), lab_only: z.boolean().optional(), active: z.boolean().optional(), category_code: z.string().optional(),
};
r.post('/articles', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ code: z.string().regex(CODE), category_code: z.string(), ...articleFields }), req.body);
  if (!(await one('SELECT 1 FROM categories WHERE code=$1', [d.category_code]))) throw bad('Categoria inesistente');
  const cols = Object.keys(d);
  const row = await one(`INSERT INTO articles (${cols.join(',')}, sort) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}, (SELECT coalesce(max(sort),0)+1 FROM articles)) RETURNING id`, cols.map((c) => d[c]));
  await audit(req, 'ARTICLE_CREATE', 'article', row.id, d);
  res.status(201).json(row);
}));
r.put('/articles/:id', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object(articleFields), req.body);
  const cols = Object.keys(d);
  const r2 = await q(`UPDATE articles SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1`, [req.params.id, ...cols.map((c) => d[c])]);
  if (!r2.rowCount) throw notFound();
  await audit(req, 'ARTICLE_UPDATE', 'article', req.params.id, d);
  res.json({ ok: true });
}));

// ---------------- Correlazione esami StudioLab -> materiali ----------------
r.get('/mappings', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  res.json(await many(`SELECT m.*, a.code AS article_code, a.name AS article_name, a.unit FROM exam_mappings m JOIN articles a ON a.id=m.article_id ORDER BY m.exam_code, a.code`));
}));
r.post('/mappings', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object({ exam_code: z.string().min(1).max(40), exam_name: opt(z.string().max(200)), article_id: z.coerce.number().int(), qty_per_exam: z.coerce.number().positive().default(1) }), req.body);
  const row = await one(`INSERT INTO exam_mappings (exam_code, exam_name, article_id, qty_per_exam) VALUES ($1,$2,$3,$4)
    ON CONFLICT (exam_code, article_id) DO UPDATE SET exam_name=EXCLUDED.exam_name, qty_per_exam=EXCLUDED.qty_per_exam, active=TRUE RETURNING id`, [d.exam_code.trim(), d.exam_name, d.article_id, d.qty_per_exam]);
  await audit(req, 'MAPPING_SAVE', 'mapping', row.id, d);
  res.status(201).json(row);
}));
// Export e import della tabella (XLSX: codice esame, descrizione, codice articolo MOD252, unità per esame)
r.get('/mappings/export.xlsx', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  const rows = await many(`SELECT m.exam_code, m.exam_name, a.code AS article_code, a.name AS article_name, m.qty_per_exam FROM exam_mappings m JOIN articles a ON a.id=m.article_id WHERE m.active ORDER BY m.exam_code, a.code`);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Correlazioni');
  ws.addRow(['Codice esame', 'Descrizione esame', 'Codice articolo MOD252', 'Articolo', 'Unità per esame']); ws.getRow(1).font = { bold: true };
  for (const x of rows) ws.addRow([x.exam_code, x.exam_name, x.article_code, x.article_name, Number(x.qty_per_exam)]);
  ws.columns.forEach((c, i) => { c.width = [14, 60, 22, 50, 14][i]; });
  const arts = wb.addWorksheet('Articoli'); arts.addRow(['Codice', 'Articolo', 'Confezione']); arts.getRow(1).font = { bold: true };
  for (const a of await many('SELECT code, name, pack_label FROM articles WHERE active ORDER BY sort')) arts.addRow([a.code, a.name, a.pack_label]);
  arts.columns.forEach((c, i) => { c.width = [12, 60, 30][i]; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="correlazioni_esami_materiali.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

r.post('/mappings/import', requireRole(...OPS_ROLES), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];
  const arts = new Map((await many('SELECT id, code FROM articles')).map((a) => [a.code, a.id]));
  const items = []; const errors = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const v = row.values.slice(1).map((x) => (x && typeof x === 'object' && 'text' in x ? x.text : x));
    const [exam, name, art, , qty] = v.map((x) => (x == null ? '' : String(x).trim()));
    if (!exam && !art) return;
    if (!arts.has(art)) return errors.push(`riga ${i}: codice articolo "${art}" non in catalogo`);
    items.push({ exam, name, article_id: arts.get(art), qty: Number(String(qty).replace(',', '.')) || 1 });
  });
  if (errors.length) return res.status(400).json({ error: `Importazione non eseguita: ${errors.length} errori`, details: errors.slice(0, 50) });
  const replace = req.query.replace === '1';
  await tx(async (c) => {
    if (replace) await c.query('DELETE FROM exam_mappings');
    for (const it of items) await c.query(`INSERT INTO exam_mappings (exam_code, exam_name, article_id, qty_per_exam) VALUES ($1,$2,$3,$4) ON CONFLICT (exam_code, article_id) DO UPDATE SET exam_name=EXCLUDED.exam_name, qty_per_exam=EXCLUDED.qty_per_exam, active=TRUE`, [it.exam, it.name || null, it.article_id, it.qty]);
  });
  await audit(req, 'MAPPINGS_IMPORT', 'mapping', null, { rows: items.length, replace });
  res.json({ rows: items.length, replace });
}));

r.delete('/mappings/:id', requireRole(...OPS_ROLES), ah(async (req, res) => {
  await q('DELETE FROM exam_mappings WHERE id=$1', [req.params.id]);
  await audit(req, 'MAPPING_DELETE', 'mapping', req.params.id);
  res.json({ ok: true });
}));

// ---------------- Impostazioni e registri ----------------
const SETTING_KEYS = ['reorder_formula', 'production_months', 'alerts_enabled', 'alert_hour', 'receipt_reminder_days', 'verify_reminder_days'];
r.get('/settings', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  const rows = await many('SELECT key, value FROM app_settings WHERE key = ANY($1)', [SETTING_KEYS]);
  const last = Object.fromEntries((await many("SELECT key, value FROM app_settings WHERE key IN ('silva_last_poll_at','silva_last_feed_at','studiolab_last_hl7_at')")).map((x) => [x.key, x.value]));
  res.json({ settings: Object.fromEntries(rows.map((x) => [x.key, x.value])), mail: mailStatus(), studiolab: { ...studiolabStatus(), last_hl7_at: last.studiolab_last_hl7_at || null }, silva: { ...silvaStatus(), last_poll_at: last.silva_last_poll_at || null, last_feed_at: last.silva_last_feed_at || null }, entra: config.entra.enabled, baseUrl: config.baseUrl });
}));
r.put('/settings', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({
    reorder_formula: z.enum(['DIFF_X_FACTOR', 'TARGET_MINUS_STOCK']).optional(), production_months: z.coerce.number().int().min(1).max(12).optional(),
    alerts_enabled: z.enum(['true', 'false']).optional(), alert_hour: z.coerce.number().int().min(0).max(23).optional(),
    receipt_reminder_days: z.coerce.number().int().min(1).max(30).optional(), verify_reminder_days: z.coerce.number().int().min(1).max(30).optional(),
  }), req.body);
  for (const [k, v] of Object.entries(d)) await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, String(v)]);
  await audit(req, 'SETTINGS_UPDATE', 'settings', null, d);
  res.json({ ok: true });
}));
r.post('/settings/test-email', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const to = parse(z.object({ to: z.string().email() }), req.body).to;
  res.json(await sendMail({ kind: 'TEST', to, sentBy: req.user.id, subject: 'Orders Management · email di prova', title: 'Email di prova', body: 'La configurazione di invio funziona.' }));
}));

r.get('/audit', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const P = new Params();
  const where = ['TRUE'];
  if (req.query.action) where.push(`a.action=${P.add(req.query.action)}`);
  const limit = P.add(Math.min(1000, Number(req.query.limit || 300)));
  res.json(await many(`SELECT a.*, u.full_name, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE ${where.join(' AND ')} ORDER BY a.at DESC LIMIT ${limit}`, P.values));
}));

r.get('/email-log', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  res.json(await many(`SELECT e.id, e.kind, e.to_addr, e.subject, e.status, e.error, e.sent_at, e.attachment_name, s.name AS struttura_name, u.full_name AS sent_by_name
    FROM email_log e LEFT JOIN strutture s ON s.id=e.struttura_id LEFT JOIN users u ON u.id=e.sent_by ORDER BY e.sent_at DESC LIMIT 300`));
}));

r.get('/company', ah(async (_req, res) => res.json(await one('SELECT id, name, vat_number, address, zip, city, province, phone, email, pec, website FROM company LIMIT 1'))));

export default r;
export { getSetting };
