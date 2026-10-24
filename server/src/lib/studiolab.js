// Connettore StudioLab ServiceNET (CB Sistemi).
//
// 1) REST, header X-API-KEY (swagger: https://servicenet.studiolab.it/swagger/ui/index): GET /api/whoami (prova di collegamento),
//    GET /api/esami?CodiceCliente=TD (catalogo esami con materiale), GET /api/esami/Materiali. Nessun endpoint restituisce la
//    produzione per cliente e periodo: la sola interrogazione per accettazione è GET /api/accettazioni/{id}.
// 2) HL7 over HTTPS in ingresso (Appendice B della specifica): StudioLab invia a un nostro URL i messaggi OML_O21 (notifica
//    cambio stato), MDM_T02/T10 (referti) e OUL_R22 come testo; noi rispondiamo con l'ACK. Da ogni esame notificato si ricava
//    la produzione mensile per codice cliente (ORC-13, in subordine MSH-4/MSH-6), che alimenta la verifica degli ordini.
// 3) Import da file e inserimento manuale restano disponibili (pagina Produzione).
import { config } from '../config.js';
import { many, one, q } from '../db.js';

export const studiolabStatus = () => ({ configured: config.studiolab.enabled, baseUrl: config.studiolab.baseUrl, clientCode: config.studiolab.clientCode, inboundConfigured: Boolean(config.studiolab.inboundKey) });

async function call(path, params = {}) {
  if (!config.studiolab.enabled) throw new Error('StudioLab non collegato: impostare STUDIOLAB_API_KEY');
  const url = new URL(`${config.studiolab.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { 'X-API-KEY': config.studiolab.apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  const txt = await res.text();
  let j; try { j = JSON.parse(txt); } catch { j = txt; }
  if (!res.ok) throw new Error(`ServiceNET ${res.status} su ${path}: ${typeof j === 'string' ? j.slice(0, 200) : j.Message || j.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

export const whoAmI = () => call('/api/whoami');

/** Sincronizza il catalogo esami (codice, descrizione, materiale) da ServiceNET nella tabella exam_catalog. */
export async function syncExamCatalog() {
  const esami = await call('/api/esami', { CodiceCliente: config.studiolab.clientCode, IncludiEtichette: true });
  if (!Array.isArray(esami)) throw new Error('Risposta inattesa da /api/esami');
  let n = 0;
  for (const e of esami) {
    const code = String(e.CodEsame ?? e.Codice ?? e.Code ?? '').trim();
    if (!code) continue;
    // il materiale può arrivare come campo diretto o dentro le etichette/campioni: si prende il primo disponibile
    const et = Array.isArray(e.Etichette) ? e.Etichette[0] : Array.isArray(e.Campioni) ? e.Campioni[0] : null;
    const matCode = e.CodiceMateriale ?? e.Materiale ?? et?.CodiceMateriale ?? et?.Materiale ?? null;
    const matDesc = e.DescrizioneMateriale ?? et?.DescrizioneMateriale ?? et?.Descrizione ?? null;
    await q(`INSERT INTO exam_catalog (code, description, material_code, material_desc, sector, is_service, updated_at) VALUES ($1,$2,$3,$4,$5,$6,now())
             ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description, material_code=coalesce(EXCLUDED.material_code, exam_catalog.material_code), material_desc=coalesce(EXCLUDED.material_desc, exam_catalog.material_desc), sector=EXCLUDED.sector, is_service=EXCLUDED.is_service, updated_at=now()`,
    [code, e.Descrizione ?? e.DescBreve ?? e.Description ?? null, matCode ? String(matCode) : null, matDesc ? String(matDesc) : null, e.SettoreCommerciale ?? e.Settore ?? null, e.EsameService ?? e.IsService ?? null]);
    n++;
  }
  return { exams: n };
}

export const listMaterials = () => call('/api/esami/Materiali', { CodiceCliente: config.studiolab.clientCode });

// ---------------- HL7 in ingresso ----------------
const esc = (s) => String(s ?? '');
function parseHl7(text) {
  const segs = esc(text).replace(/^[\x0b]+/, '').replace(/[\x1c\x0d]+$/, '').split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  const msh = segs.find((s) => s.startsWith('MSH|'));
  if (!msh) throw new Error('Segmento MSH mancante');
  const fs = msh[3];
  const f = (seg, i) => (seg ? esc(seg.split(fs)[i]) : '');
  const comp = (v, i) => esc(v).split('^')[i] ?? '';
  const mshF = msh.split(fs); // MSH-1 è il separatore: gli indici sono sfalsati di uno
  const head = { sendingApp: mshF[2], sendingFacility: mshF[3], receivingApp: mshF[4], receivingFacility: mshF[5], ts: mshF[6], type: mshF[8], controlId: mshF[9], version: mshF[11] };
  const pv1 = segs.find((s) => s.startsWith('PV1' + fs));
  const accDateRaw = f(pv1, 44);
  const acceptanceId = comp(f(pv1, 19), 0);
  const exams = [];
  let currentOrc = null;
  for (const s of segs) {
    if (s.startsWith('ORC' + fs)) currentOrc = s;
    else if (s.startsWith('OBR' + fs) && currentOrc) {
      exams.push({ orderControl: f(currentOrc, 1), placerId: comp(f(currentOrc, 2), 0), groupId: comp(f(currentOrc, 4), 0) || acceptanceId, status: f(currentOrc, 5), transDate: f(currentOrc, 9), clientCode: comp(f(currentOrc, 13), 0), examCode: comp(f(s, 4), 0), examDesc: comp(f(s, 4), 1) });
    }
  }
  return { head, acceptanceId, accDate: accDateRaw, exams, fs };
}

function hl7Date(raw) {
  const m = esc(raw).match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function buildAck(head, code, controlId, text) {
  const now = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const trig = (head?.type || 'OML^O21').split('^')[1] || 'O21';
  return `MSH|^~\\&|TDORDERS|TOSCANADIAGNOSTICA|${head?.sendingApp || 'STUDIOLAB'}|${head?.sendingFacility || ''}|${now}||ACK^${trig}|ACK-${Date.now()}|P|2.5\rMSA|${code}|${controlId || ''}${text ? '|' + text : ''}\r`;
}

/**
 * Elabora un messaggio HL7 ricevuto da StudioLab: ogni esame con stato attivo conta +1 nella produzione del cliente e del mese
 * dell'accettazione, un esame cancellato conta -1. Idempotente per (accettazione, esame, evento, stato).
 */
export async function ingestHl7(text) {
  const msg = parseHl7(text);
  const type = msg.head.type?.split('^').slice(0, 2).join('^') || '';
  if (!/^(OML\^O21|MDM\^T02|MDM\^T10|OUL\^R22|ORL\^O22)$/.test(type)) {
    return { ack: buildAck(msg.head, 'AA', msg.head.controlId), ignored: true, type };
  }
  const accDate = hl7Date(msg.accDate) || hl7Date(msg.exams[0]?.transDate) || new Date().toISOString().slice(0, 10);
  const month = `${accDate.slice(0, 7)}-01`;
  let counted = 0, ignored = 0;
  for (const e of msg.exams) {
    const client = e.clientCode || msg.head.receivingFacility || msg.head.sendingFacility || '';
    let delta = 0;
    if (['NW', 'SC', 'SN', 'OK'].includes(e.orderControl) && ['IP', 'SC', 'CM', 'A', ''].includes(e.status)) delta = 1;
    else if (e.orderControl === 'CA' || e.orderControl === 'OC' || e.status === 'CA') delta = -1;
    const r = await q(`INSERT INTO studiolab_events (msg_control_id, msg_type, acceptance_id, exam_placer_id, client_code, exam_code, order_control, order_status, acc_date, counted)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (acceptance_id, exam_placer_id, order_control, order_status) DO NOTHING RETURNING id`,
    [msg.head.controlId, type, e.groupId || msg.acceptanceId, e.placerId || e.examCode, client, e.examCode, e.orderControl, e.status, accDate, delta]);
    if (!r.rowCount) { ignored++; continue; }
    if (delta === 0) { ignored++; continue; }
    // un esame conteggiato una volta sola: se lo stesso esame è già stato contato (+1) per la stessa accettazione, non si somma di nuovo
    if (delta > 0) {
      const dup = await one(`SELECT count(*)::int AS n FROM studiolab_events WHERE acceptance_id=$1 AND exam_placer_id=$2 AND counted > 0`, [e.groupId || msg.acceptanceId, e.placerId || e.examCode]);
      if (dup.n > 1) { await q('UPDATE studiolab_events SET counted=0 WHERE id=$1', [r.rows[0].id]); ignored++; continue; }
    }
    const s = await one("SELECT id FROM strutture WHERE studiolab_code=$1 OR code=$1 LIMIT 1", [client]);
    if (!s) { ignored++; continue; }
    await q(`INSERT INTO production (struttura_id, month, exam_code, exam_name, qty, source) VALUES ($1,$2,$3,$4,GREATEST($5,0),'STUDIOLAB')
             ON CONFLICT (struttura_id, month, exam_code) DO UPDATE SET qty = GREATEST(production.qty + $5, 0), exam_name = coalesce(production.exam_name, EXCLUDED.exam_name), source='STUDIOLAB', updated_at=now()`,
    [s.id, month, e.examCode, e.examDesc || null, delta]);
    counted++;
  }
  return { ack: buildAck(msg.head, 'AA', msg.head.controlId), counted, ignored, type, acceptanceId: msg.acceptanceId };
}

// ---------------- Produzione: salvataggio e consumo ----------------
export async function saveProduction(strutturaId, monthIso, items, source) {
  const month = `${monthIso.slice(0, 7)}-01`;
  let n = 0;
  for (const it of items) {
    if (!it.examCode) continue;
    await q(`INSERT INTO production (struttura_id, month, exam_code, exam_name, qty, source) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (struttura_id, month, exam_code) DO UPDATE SET qty=EXCLUDED.qty, exam_name=coalesce(EXCLUDED.exam_name, production.exam_name), source=EXCLUDED.source, updated_at=now()`,
    [strutturaId, month, String(it.examCode).trim(), it.examName || null, Math.max(0, Math.round(Number(it.qty) || 0)), source]);
    n++;
  }
  return n;
}

/** Consumo medio mensile di materiale per struttura (unità e confezioni) dagli ultimi N mesi, via correlazione esame -> articolo. */
export async function consumptionByArticle(strutturaId, months = 3) {
  const rows = await many(`
    WITH mesi AS (SELECT DISTINCT month FROM production WHERE struttura_id=$1 ORDER BY month DESC LIMIT $2)
    SELECT m.article_id, a.pack_size, sum(p.qty * m.qty_per_exam)::numeric AS units, count(DISTINCT p.month)::int AS n_months,
           json_agg(json_build_object('exam_code', p.exam_code, 'exam_name', coalesce(p.exam_name, m.exam_name), 'month', p.month, 'qty', p.qty, 'qty_per_exam', m.qty_per_exam) ORDER BY p.month DESC, p.exam_code) AS detail
      FROM production p JOIN mesi ON mesi.month = p.month
      JOIN exam_mappings m ON m.exam_code = p.exam_code AND m.active
      JOIN articles a ON a.id = m.article_id
     WHERE p.struttura_id=$1 GROUP BY m.article_id, a.pack_size`, [strutturaId, months]);
  const nMonths = (await one(`SELECT count(*)::int AS n FROM (SELECT DISTINCT month FROM production WHERE struttura_id=$1 ORDER BY month DESC LIMIT $2) x`, [strutturaId, months]))?.n || 0;
  const map = new Map();
  for (const r of rows) {
    const units = Number(r.units) / Math.max(1, nMonths);
    map.set(r.article_id, { units: Math.round(units * 100) / 100, packs: Math.round((units / r.pack_size) * 100) / 100, months: nMonths, detail: r.detail });
  }
  return { map, months: nMonths };
}

export { parseHl7 };
