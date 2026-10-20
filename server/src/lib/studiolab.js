// Adattatore StudioLab (gestionale di laboratorio).
// Due funzioni: verifica delle credenziali cliente (accettazione campioni) e lettura della produzione mensile per codice esame.
//
// ATTENZIONE: il contratto dell'API di StudioLab NON è documentato in questo progetto. Le chiamate HTTP qui sotto sono un'IPOTESI
// di interfaccia (endpoint, campi) da allineare alla documentazione del fornitore prima di passare STUDIOLAB_MODE=API.
// In modalità SIMULATO (default) nessuna chiamata esce: le credenziali StudioLab non sono verificabili e la produzione
// arriva solo da import o inserimento manuale (pagina Produzione).
import { config } from '../config.js';
import { many, one, q } from '../db.js';

export const studiolabStatus = () => ({ mode: config.studiolab.mode, configured: Boolean(config.studiolab.baseUrl && config.studiolab.apiKey) });

async function call(path, body) {
  const res = await fetch(`${config.studiolab.baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.studiolab.apiKey}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`StudioLab ${res.status}: ${j.message || j.error || 'errore'}`);
  return j;
}

/**
 * Verifica le credenziali assegnate al cliente su StudioLab.
 * Ritorna { ok, clientCode, clientName } oppure { ok: false }.
 * Ipotesi di contratto: POST /api/auth/verify { username, password } -> { valid, clientCode, clientName }
 */
export async function verifyCredentials(username, password) {
  if (config.studiolab.mode !== 'API' || !studiolabStatus().configured) return { ok: false, reason: 'StudioLab non collegato' };
  try {
    const j = await call('/api/auth/verify', { username, password });
    return j.valid ? { ok: true, clientCode: String(j.clientCode || ''), clientName: j.clientName || '' } : { ok: false, reason: 'Credenziali StudioLab non valide' };
  } catch (e) { return { ok: false, reason: e.message }; }
}

/**
 * Legge la produzione di un cliente/struttura per un mese: elenco { examCode, examName, qty }.
 * Ipotesi di contratto: POST /api/production/monthly { clientCode, year, month } -> { items: [{ code, description, count }] }
 */
export async function fetchProduction(studiolabCode, monthIso) {
  if (config.studiolab.mode !== 'API' || !studiolabStatus().configured) throw new Error('StudioLab non collegato (STUDIOLAB_MODE=SIMULATO): usa l\'import o l\'inserimento manuale');
  const [year, month] = monthIso.split('-').map(Number);
  const j = await call('/api/production/monthly', { clientCode: studiolabCode, year, month });
  return (j.items || []).map((x) => ({ examCode: String(x.code), examName: x.description || null, qty: Number(x.count || 0) }));
}

// Salva la produzione di un mese per una struttura (sostituisce i valori esistenti per gli esami presenti)
export async function saveProduction(strutturaId, monthIso, items, source) {
  const month = `${monthIso.slice(0, 7)}-01`;
  let n = 0;
  for (const it of items) {
    if (!it.examCode) continue;
    await q(`INSERT INTO production (struttura_id, month, exam_code, exam_name, qty, source)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (struttura_id, month, exam_code) DO UPDATE SET qty=EXCLUDED.qty, exam_name=coalesce(EXCLUDED.exam_name, production.exam_name), source=EXCLUDED.source, updated_at=now()`,
    [strutturaId, month, String(it.examCode).trim(), it.examName || null, Math.max(0, Math.round(Number(it.qty) || 0)), source]);
    n++;
  }
  return n;
}

// Sincronizza da StudioLab gli ultimi N mesi di una struttura
export async function syncProduction(strutturaId, months = 3) {
  const s = await one('SELECT * FROM strutture WHERE id=$1', [strutturaId]);
  if (!s?.studiolab_code) throw new Error('Codice StudioLab della struttura non impostato');
  const out = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
    const m = d.toISOString().slice(0, 7);
    const items = await fetchProduction(s.studiolab_code, m);
    out.push({ month: m, rows: await saveProduction(strutturaId, m, items, 'STUDIOLAB') });
  }
  return out;
}

/**
 * Consumo medio mensile di materiale per una struttura, in unità e in confezioni, dagli ultimi N mesi di produzione
 * attraverso la tabella di correlazione esame -> articolo. Ritorna una mappa article_id -> { units, packs, months, exams[] }.
 */
export async function consumptionByArticle(strutturaId, months = 3) {
  const rows = await many(`
    WITH mesi AS (
      SELECT DISTINCT month FROM production WHERE struttura_id=$1 ORDER BY month DESC LIMIT $2
    )
    SELECT m.article_id, a.pack_size, sum(p.qty * m.qty_per_exam)::numeric AS units, count(DISTINCT p.month)::int AS n_months,
           json_agg(json_build_object('exam_code', p.exam_code, 'exam_name', coalesce(p.exam_name, m.exam_name), 'month', p.month, 'qty', p.qty, 'qty_per_exam', m.qty_per_exam) ORDER BY p.month DESC, p.exam_code) AS detail
      FROM production p
      JOIN mesi ON mesi.month = p.month
      JOIN exam_mappings m ON m.exam_code = p.exam_code AND m.active
      JOIN articles a ON a.id = m.article_id
     WHERE p.struttura_id=$1
     GROUP BY m.article_id, a.pack_size`, [strutturaId, months]);
  const nMonths = (await one(`SELECT count(*)::int AS n FROM (SELECT DISTINCT month FROM production WHERE struttura_id=$1 ORDER BY month DESC LIMIT $2) x`, [strutturaId, months]))?.n || 0;
  const map = new Map();
  for (const r of rows) {
    const div = Math.max(1, nMonths);
    const units = Number(r.units) / div;
    map.set(r.article_id, { units: Math.round(units * 100) / 100, packs: Math.round((units / r.pack_size) * 100) / 100, months: nMonths, detail: r.detail });
  }
  return { map, months: nMonths };
}
