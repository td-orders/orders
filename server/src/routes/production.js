import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { parse as csvParse } from 'csv-parse/sync';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireRole, isOps, assertStruttura, OPS_ROLES } from '../lib/access.js';
import { saveProduction, studiolabStatus, whoAmI, syncExamCatalog } from '../lib/studiolab.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Produzione mensile per struttura: tabella esami x mesi
r.get('/', ah(async (req, res) => {
  const sid = isOps(req.user) ? Number(req.query.struttura_id) : req.user.struttura_id;
  if (!sid) throw bad('Struttura obbligatoria');
  await assertStruttura(req.user, sid);
  const months = Math.min(24, Number(req.query.months || 6));
  const rows = await many(`SELECT p.month, p.exam_code, p.exam_name, p.qty, p.source,
      (SELECT json_agg(json_build_object('article', a.name, 'qty_per_exam', m.qty_per_exam)) FROM exam_mappings m JOIN articles a ON a.id=m.article_id WHERE m.exam_code=p.exam_code AND m.active) AS materials
    FROM production p WHERE p.struttura_id=$1 AND p.month >= (date_trunc('month', now()) - ($2 || ' months')::interval)::date ORDER BY p.month DESC, p.exam_code`, [sid, months]);
  res.json(rows);
}));

// Inserimento manuale di un mese
r.post('/', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const d = parse(z.object({ struttura_id: z.coerce.number().int(), month: z.string().regex(/^\d{4}-\d{2}/), items: z.array(z.object({ examCode: z.string().min(1), examName: z.string().optional().nullable(), qty: z.coerce.number().int().min(0) })).min(1) }), req.body);
  await assertStruttura(req.user, d.struttura_id);
  const n = await saveProduction(d.struttura_id, d.month, d.items, 'MANUALE');
  await audit(req, 'PRODUCTION_SAVE', 'struttura', d.struttura_id, { month: d.month, rows: n });
  res.json({ rows: n });
}));

// Import da file (CSV o XLSX) esportato da StudioLab: colonne codice struttura (o codice StudioLab), mese AAAA-MM, codice esame, descrizione, quantità
r.post('/import', requireRole(...OPS_ROLES), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  let records = [];
  if (/\.xlsx$/i.test(req.file.originalname)) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    ws.eachRow((row, i) => { if (i > 1) records.push(row.values.slice(1).map((v) => (v && typeof v === 'object' && 'text' in v ? v.text : v))); });
  } else {
    const txt = req.file.buffer.toString('utf8');
    records = csvParse(txt, { delimiter: txt.split('\n')[0].includes(';') ? ';' : ',', from_line: 2, relax_column_count: true, trim: true });
  }
  const strutture = await many('SELECT id, code, studiolab_code FROM strutture WHERE active');
  const byMonth = new Map(); const errors = [];
  records.forEach((rec, i) => {
    const [code, month, examCode, examName, qty] = rec.map((v) => (v == null ? '' : String(v).trim()));
    if (!code && !examCode) return;
    const s = strutture.find((x) => x.code === code || (x.studiolab_code && x.studiolab_code === code));
    if (!s) return errors.push(`riga ${i + 2}: struttura ${code} non trovata`);
    const m = month.match(/^(\d{4})[-/](\d{1,2})/) || month.match(/^(\d{1,2})[-/](\d{4})$/);
    if (!m) return errors.push(`riga ${i + 2}: mese ${month} non valido (atteso AAAA-MM)`);
    const monthIso = m[1].length === 4 ? `${m[1]}-${m[2].padStart(2, '0')}` : `${m[2]}-${m[1].padStart(2, '0')}`;
    const key = `${s.id}|${monthIso}`;
    byMonth.set(key, [...(byMonth.get(key) || []), { examCode, examName, qty: Number(String(qty).replace(',', '.')) || 0 }]);
  });
  if (errors.length && !req.query.force) return res.status(400).json({ error: `Importazione non eseguita: ${errors.length} errori`, details: errors.slice(0, 50) });
  let rows = 0;
  for (const [key, items] of byMonth) { const [sid, month] = key.split('|'); rows += await saveProduction(Number(sid), month, items, 'IMPORT'); }
  await audit(req, 'PRODUCTION_IMPORT', 'production', null, { rows, months: byMonth.size });
  res.json({ rows, months: byMonth.size, errors });
}));

r.get('/import/template.xlsx', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Produzione');
  ws.addRow(['Codice struttura (o codice StudioLab)', 'Mese (AAAA-MM)', 'Codice esame StudioLab', 'Descrizione esame', 'Quantità']);
  ws.addRow(['CLI-001', '2026-09', '0014', 'Emocromo', 140]);
  ws.getRow(1).font = { bold: true }; ws.columns.forEach((c) => { c.width = 28; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modello_produzione.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

// StudioLab ServiceNET: prova del collegamento e sincronizzazione del catalogo esami (con materiale) per la correlazione
r.get('/studiolab/test', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  if (!studiolabStatus().configured) throw bad('StudioLab non collegato: impostare STUDIOLAB_API_KEY nel pannello Render');
  try { res.json({ ok: true, whoami: await whoAmI() }); } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
}));
r.post('/studiolab/sync-exams', requireRole(...OPS_ROLES), ah(async (req, res) => {
  const out = await syncExamCatalog();
  await audit(req, 'STUDIOLAB_SYNC_EXAMS', 'exam_catalog', null, out);
  res.json(out);
}));
r.get('/exam-catalog', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  res.json(await many(`SELECT e.*, (SELECT count(*)::int FROM exam_mappings m WHERE m.exam_code=e.code AND m.active) AS mappings FROM exam_catalog e ORDER BY e.code`));
}));
// Eventi HL7 ricevuti (ultimi 200)
r.get('/hl7-events', requireRole(...OPS_ROLES), ah(async (_req, res) => {
  res.json(await many('SELECT * FROM studiolab_events ORDER BY received_at DESC LIMIT 200'));
}));

export default r;
export { one, q };
