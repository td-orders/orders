// Test end-to-end delle API (server avviato su BASE con database vuoto, DISABLE_SCHEDULER=true,
// SILVA_INBOUND_KEY=test-silva-key, STUDIOLAB_INBOUND_KEY=test-hl7-key)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from 'otplib';

const BASE = process.env.BASE || 'http://localhost:3000';
const SUPER = { email: 'francesco.epifani@toscanadiagnostica.it', password: process.env.SUPER_PWD || 'Prova-Sicura-2026' };
const NEWPWD = 'NuovaPassword-2026';
const SILVA_KEY = process.env.SILVA_INBOUND_KEY || 'test-silva-key';
const HL7_KEY = process.env.STUDIOLAB_INBOUND_KEY || 'test-hl7-key';

function client() {
  let cookie = '';
  const call = async (method, url, body, raw = false) => {
    const isForm = body instanceof FormData;
    const res = await fetch(BASE + url, { method, redirect: 'manual', headers: { 'X-Requested-With': 'td-orders', ...(cookie ? { cookie } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    const txt = await res.text(); let data; try { data = JSON.parse(txt); } catch { data = txt; }
    return { status: res.status, data };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), raw: (u) => call('GET', u, null, true), upload: (u, f) => call('POST', u, f) };
}
// Chiamate "da fornitore": chiave API, nessuna sessione, nessun header anti-CSRF
async function ext(method, url, body, key = SILVA_KEY, contentType = 'application/json') {
  const res = await fetch(BASE + url, { method, headers: { 'X-API-KEY': key, ...(body ? { 'content-type': contentType } : {}) }, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
  const txt = await res.text(); let data; try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: res.status, data };
}
const S = client(); const P = client(); const C = client(); const D = client(); const L = client();
const ctx = { secrets: {} };

async function login(c, email, password, newPwd, needTotp) {
  let r = await c.post('/api/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  if (r.data.totpRequired) { r = await c.post('/api/auth/totp', { code: authenticator.generate(ctx.secrets[email]) }); assert.equal(r.status, 200); }
  if (r.data.onboarding === 'PASSWORD_CHANGE_REQUIRED') {
    assert.equal((await c.get('/api/articles')).status, 403);
    r = await c.post('/api/auth/change-password', { currentPassword: password, newPassword: newPwd }); assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const me = await c.get('/api/auth/me');
  if (needTotp && me.data.onboarding === 'TOTP_SETUP_REQUIRED') {
    const s = await c.post('/api/auth/totp/setup'); ctx.secrets[email] = s.data.secret;
    r = await c.post('/api/auth/totp/enable', { code: authenticator.generate(s.data.secret) }); assert.equal(r.status, 200);
  }
  return (await c.get('/api/auth/me')).data;
}

test('Orders Management v2: flusso a fasi', async (t) => {
  await t.test('CSRF, login errato, chiavi API', async () => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
    assert.equal((await S.post('/api/auth/login', { email: SUPER.email, password: 'sbagliata' })).status, 401);
    assert.equal((await ext('GET', '/api/integrations/silva/ping', null, 'chiave-sbagliata')).status, 401);
    assert.equal((await ext('GET', '/api/integrations/silva/ping')).status, 200);
  });
  await t.test('super amministratore: onboarding', async () => {
    const me = await login(S, SUPER.email, SUPER.password, NEWPWD, true);
    assert.equal(me.user.role, 'SUPERADMIN'); assert.equal(me.onboarding, null);
  });
  await t.test('catalogo MOD252 precaricato e visibile a tutti; strutture precaricate', async () => {
    const a = await S.get('/api/articles'); assert.equal(a.status, 200); assert.equal(a.data.length, 48);
    assert.ok(a.data.every((x) => x.visible_all), 'MOD252 visibile a tutti all\'avvio');
    ctx.art = Object.fromEntries(a.data.map((x) => [x.code, x]));
    let r = await S.put(`/api/articles/${ctx.art.PRV07.id}`, { name: 'Tappo Viola', unit: 'n. provette', pack_size: 100, pack_label: 'confezione da 100 provette', gtin: '08012345678905', min_stock_packs: 2, coverage_factor: 1.5 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const all = (await S.get('/api/strutture')).data;
    assert.ok(all.filter((x) => x.kind === 'CLIENTE').length >= 60 && all.filter((x) => x.kind === 'SEDE').length >= 20);
    ctx.cliente = all.find((x) => x.code === 'SER0002').id;   // Villa Fiorita: codice StudioLab SER0002
    ctx.sede = all.find((x) => x.code === 'TD02').id;         // Calenzano
    ctx.lab = all.find((x) => x.kind === 'LAB').id;
    r = await S.put(`/api/strutture/${ctx.cliente}`, { name: 'CASA DI CURA VILLA FIORITA S.R.L.', email: 'cliente@example.org' }); assert.equal(r.status, 200);
    r = await S.put(`/api/strutture/${ctx.sede}`, { name: 'Punto Prelievi Calenzano', email: 'calenzano@example.org' }); assert.equal(r.status, 200);
  });
  await t.test('utenti', async () => {
    const mk = async (b) => { const r = await S.post('/api/users', b); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data; };
    ctx.pwdP = (await mk({ email: 'ops@toscanadiagnostica.it', full_name: 'Operations Manager', role: 'PROCUREMENT', auth_provider: 'LOCAL' })).temporaryPassword;
    ctx.pwdC = (await mk({ email: 'cliente@example.org', full_name: 'Rita Merola', role: 'CLIENTE', struttura_id: ctx.cliente, auth_provider: 'LOCAL', is_referente: true })).temporaryPassword;
    ctx.pwdD = (await mk({ email: 'sede@example.org', full_name: 'Referente Calenzano', role: 'SEDE', struttura_id: ctx.sede, auth_provider: 'LOCAL', is_referente: true })).temporaryPassword;
    ctx.pwdL = (await mk({ email: 'lab@example.org', full_name: 'Referente Laboratorio', role: 'LAB', struttura_id: ctx.lab, auth_provider: 'LOCAL' })).temporaryPassword;
    assert.equal((await login(P, 'ops@toscanadiagnostica.it', ctx.pwdP, NEWPWD, true)).user.role, 'PROCUREMENT');
    assert.equal((await login(C, 'cliente@example.org', ctx.pwdC, NEWPWD, false)).user.role, 'CLIENTE');
    assert.equal((await login(D, 'sede@example.org', ctx.pwdD, NEWPWD, false)).user.role, 'SEDE');
    assert.equal((await login(L, 'lab@example.org', ctx.pwdL, NEWPWD, false)).user.role, 'LAB');
    assert.equal((await C.get('/api/users')).status, 403);
  });

  // ---------- Fase 0: magazzino Silva ----------
  await t.test('fase 0: feed giacenze del magazzino, articoli nuovi nascosti, visibilità decisa dall\'Area Operations', async () => {
    let r = await ext('POST', '/api/integrations/silva/stock', { articoli: [
      { codice: 'PRV07', descrizione: 'Provette tappo viola', barcode: '08012345678905', lotto: 'L-VIOLA-1', scadenza: '2027-12-31', quantita: 120, unita: 'confezioni' },
      { codice: 'PRV07', descrizione: 'Provette tappo viola', barcode: '08012345678905', lotto: 'L-VIOLA-2', scadenza: '2028-03-31', quantita: 40, unita: 'confezioni' },
      { codice: 'SLV-GUANTI-M', descrizione: 'Guanti nitrile M', barcode: '08099999000012', lotto: 'G1', scadenza: '2029-01-31', quantita: 300, unita: 'scatole', confezione: 'scatola da 100 guanti', unitaPerConfezione: 100 },
      { codice: 'SLV-DISINF', descrizione: 'Disinfettante cute 1 l', lotto: 'D7', scadenza: '2027-06-30', quantita: 25, unita: 'flaconi' },
      { codice: '', descrizione: 'riga errata', quantita: 1 },
    ] });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.items, 4); assert.equal(r.data.newArticles, 2); assert.equal(r.data.errors.length, 1);
    assert.equal((await ext('POST', '/api/integrations/silva/stock', { articoli: [] }, 'x')).status, 401);
    const w = (await P.get('/api/warehouse')).data; assert.equal(w.status, undefined);
    const viola = w.rows.find((x) => x.code === 'PRV07'); assert.equal(Number(viola.qty), 160); assert.equal(viola.lots, 2); assert.equal(viola.next_expiry, '2027-12-31');
    const guanti = w.rows.find((x) => x.silva_code === 'SLV-GUANTI-M'); assert.ok(guanti); assert.equal(guanti.visible_all, false); assert.equal(guanti.source, 'SILVA'); assert.equal(guanti.pack_size, 100);
    ctx.guanti = guanti.article_id;
    assert.ok(!(await C.get('/api/articles')).data.find((x) => x.id === ctx.guanti), 'il cliente non vede l\'articolo nuovo finché non è reso visibile');
    assert.equal((await C.get('/api/warehouse')).status, 403, 'le strutture non vedono il magazzino del fornitore');
    r = await P.put(`/api/warehouse/articles/${ctx.guanti}/visibility`, { visible_sedi: true }); assert.equal(r.status, 200);
    assert.ok(!(await C.get('/api/articles')).data.find((x) => x.id === ctx.guanti), 'visibile solo ai punti prelievo');
    assert.ok((await D.get('/api/articles')).data.find((x) => x.id === ctx.guanti), 'la sede lo vede');
    r = await P.put('/api/warehouse/visibility', { ids: [ctx.guanti], visible_service: true }); assert.equal(r.status, 200);
    const cl = (await C.get('/api/articles')).data.find((x) => x.id === ctx.guanti); assert.ok(cl);
    assert.equal(cl.qty, undefined); assert.equal(cl.lot_detail, undefined, 'niente quantità, lotti o scadenze del magazzino per la struttura');
    // secondo feed: fotografia completa, il disinfettante sparisce e va a zero
    r = await ext('POST', '/api/integrations/silva/stock', { articoli: [{ codice: 'PRV07', lotto: 'L-VIOLA-2', scadenza: '2028-03-31', quantita: 30 }] }); assert.equal(r.status, 200);
    const w2 = (await P.get('/api/warehouse')).data;
    assert.equal(Number(w2.rows.find((x) => x.code === 'PRV07').qty), 30); assert.equal(Number(w2.rows.find((x) => x.silva_code === 'SLV-DISINF').qty), 0);
    assert.equal(w2.feeds.length, 2);
  });

  // ---------- Fase 2 (preparazione): produzione da HL7 StudioLab e correlazioni ----------
  await t.test('StudioLab: messaggi HL7 in ingresso alimentano la produzione del cliente (ORC-13 / facility); ACK corretto', async () => {
    const hl7 = (ctrl, acc, exams, client = 'SER0002') => [
      `MSH|^~\\&|STUDIOLAB|STUDIOLAB|TDORDERS|${client}|20260915120000||OML^O21|${ctrl}|P|2.5|||||UNICODE UTF-8`,
      'PID|||PAZ-1^^^^PI||ROSSI^MARIO||19850801|M',
      `PV1||O|||||||||||||||||${acc}|||||||||||||||||||||||||20260915`,
      ...exams.flatMap(([placer, code, desc, orc = 'SC', st = 'IP'], i) => [`ORC|${orc}|${placer}|F${i}|${acc}|${st}||||20260915120000||||${client}`, `OBR|${i + 1}|${placer}|F${i}|${code}^${desc}`]),
    ].join('\r') + '\r';
    assert.equal((await ext('POST', '/api/integrations/studiolab/hl7', hl7('M1', 'ACC-1', [['ACC-1-1', '0014', 'Emocromo']]), 'chiave-errata', 'text/plain')).status, 401);
    for (let i = 1; i <= 140; i++) {
      const r = await ext('POST', '/api/integrations/studiolab/hl7', hl7(`M${i}`, `ACC-${i}`, [['A' + i, '0014', 'Emocromo'], ['B' + i, '200', 'Glicemia']]), HL7_KEY, 'text/plain');
      assert.equal(r.status, 200); assert.match(String(r.data), /^MSH\|.*\rMSA\|AA\|M\d+/);
    }
    // duplicato e cancellazione
    let r = await ext('POST', '/api/integrations/studiolab/hl7', hl7('M1b', 'ACC-1', [['A1', '0014', 'Emocromo']]), HL7_KEY, 'text/plain'); assert.equal(r.status, 200);
    r = await ext('POST', '/api/integrations/studiolab/hl7', hl7('M1c', 'ACC-2', [['A2', '0014', 'Emocromo', 'CA', 'CA']]), HL7_KEY, 'text/plain'); assert.equal(r.status, 200);
    r = await ext('POST', '/api/integrations/studiolab/hl7', 'PID|||x', HL7_KEY, 'text/plain'); assert.equal(r.status, 200); assert.match(String(r.data), /MSA\|AE/);
    const prod = (await P.get(`/api/production?struttura_id=${ctx.cliente}&months=3`)).data;
    assert.equal(prod.find((p) => p.exam_code === '0014').qty, 139, '140 emocromi, uno annullato, un duplicato ignorato');
    assert.equal(prod.find((p) => p.exam_code === '200').qty, 140); assert.equal(prod[0].source, 'STUDIOLAB');
    const ev = (await P.get('/api/production/hl7-events')).data; assert.ok(ev.length >= 200);
    // correlazioni precaricate: 0014 -> viola, 200 (PLASMA) -> grigio
    const maps = (await P.get('/api/mappings')).data; assert.ok(maps.length >= 1385);
    assert.ok(maps.find((m) => m.exam_code === '0014' && m.article_code === 'PRV07')); assert.ok(maps.find((m) => m.exam_code === '200' && m.article_code === 'PRV04'));
    const cons = (await P.get(`/api/stock/consumption?struttura_id=${ctx.cliente}`)).data;
    assert.equal(cons.items.find((x) => x.article_id === ctx.art.PRV07.id).units, 139); assert.equal(cons.months, 1);
    assert.equal((await P.get('/api/production/studiolab/test')).status, 400, 'REST ServiceNET non configurato nel test');
  });

  // ---------- Processo cliente Service: fasi 1-4 ----------
  await t.test('fase 1 cliente: carrello e invio', async () => {
    let r = await C.post('/api/orders', { lines: [{ article_id: ctx.art.PRV07.id, qty: 2 }, { article_id: ctx.art.PRV04.id, qty: 5 }, { article_id: ctx.guanti, qty: 1 }], notes: 'Consegna al piano terra', client_ref: 'RIC-77' });
    assert.equal(r.status, 201, JSON.stringify(r.data)); ctx.o1 = r.data.id;
    r = await C.post(`/api/orders/${ctx.o1}/submit`); assert.equal(r.status, 200, JSON.stringify(r.data));
    const o = (await C.get(`/api/orders/${ctx.o1}`)).data; assert.equal(o.status, 'INVIATO'); assert.equal(o.lines.length, 3);
    assert.equal((await D.get(`/api/orders/${ctx.o1}`)).status, 403);
  });
  await t.test('fase 2 operations: verifica con produzione StudioLab, approvazione (in attesa del magazzino)', async () => {
    const o = (await P.get(`/api/orders/${ctx.o1}`)).data;
    const viola = o.lines.find((l) => l.article_code === 'PRV07'); const grigio = o.lines.find((l) => l.article_code === 'PRV04');
    assert.equal(viola.prod_units_avg, 139); assert.equal(viola.prod_packs_avg, 1.39); assert.equal(viola.qty_approved, 2);
    assert.equal(grigio.prod_packs_avg, 1.4); assert.equal(grigio.delta_pct, 257.1);
    assert.equal((await C.post(`/api/orders/${ctx.o1}/approve`)).status, 403);
    const r = await P.post(`/api/orders/${ctx.o1}/verify`, { lines: [{ id: grigio.id, qty_approved: 2, note_ops: 'Ridotto alla produzione' }], ops_notes: 'Verificato', approve: true });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'APPROVATO');
    const o2 = (await P.get(`/api/orders/${ctx.o1}`)).data; assert.equal(o2.status, 'APPROVATO'); assert.equal(o2.packages.length, 0, 'nessuna confezione prima della consegna');
    const pdf = await C.raw(`/api/orders/${ctx.o1}/pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  });
  await t.test('fase 3 Silva: il fornitore legge gli ordini da preparare ogni 5 minuti e li prende in carico', async () => {
    let r = await ext('GET', '/api/integrations/silva/orders'); assert.equal(r.status, 200, JSON.stringify(r.data));
    const ord = r.data.ordini.find((x) => x.numero.endsWith('0001')); assert.ok(ord);
    assert.equal(ord.urgenza, 'ORDINARIA'); assert.equal(ord.tipoDestinatario, 'CLIENTE_SERVICE'); assert.equal(ord.destinazione.codice, 'SER0002');
    assert.equal(ord.righe.length, 3); assert.equal(ord.righe.find((x) => x.codiceArticolo === 'PRV04').confezioni, 2); assert.equal(ord.righe.find((x) => x.codiceArticolo === 'PRV07').unitaTotali, 200);
    assert.equal(ord.righe.find((x) => x.codiceSilva === 'SLV-GUANTI-M').confezioni, 1);
    ctx.n1 = ord.numero;
    r = await ext('POST', `/api/integrations/silva/orders/${ctx.n1}/presa-in-carico`, { riferimento: 'SG-2026-555' }); assert.equal(r.status, 200); assert.equal(r.data.status, 'PRESO_IN_CARICO');
    assert.equal((await ext('GET', '/api/integrations/silva/orders')).data.ordini.length, 0, 'non più tra quelli da preparare');
    assert.equal((await ext('POST', `/api/integrations/silva/orders/${ctx.n1}/presa-in-carico`, {})).status, 400, 'doppia presa in carico rifiutata');
    r = await ext('POST', `/api/integrations/silva/orders/${ctx.n1}/spedito`, { ddt: 'DDT-1001' }); assert.equal(r.status, 200); assert.equal(r.data.status, 'SPEDITO');
    const o = (await P.get(`/api/orders/${ctx.o1}`)).data; assert.equal(o.status, 'SPEDITO'); assert.equal(o.silva_reference, 'SG-2026-555'); assert.equal(o.ddt_number, 'DDT-1001'); assert.ok(o.polled_at);
  });
  await t.test('fase 4 Silva: consegna al cliente Service con lotti e codici a barre, processo concluso', async () => {
    const r = await ext('POST', `/api/integrations/silva/orders/${ctx.n1}/consegnato`, { ddt: 'DDT-1001', righe: [
      { codiceArticolo: 'PRV07', confezioni: 2, lotto: 'L-VIOLA-2', scadenza: '2028-03-31', barcodes: ['PK-0001', 'PK-0002'] },
      { codiceArticolo: 'PRV04', confezioni: 2, lotto: 'G1', scadenza: '2027-09-30' },
      { codiceArticolo: 'SLV-GUANTI-M', confezioni: 1, lotto: 'G1' },
      { codiceArticolo: 'XXX', confezioni: 1 },
    ] });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'CHIUSO'); assert.deepEqual(r.data.unknown, ['XXX']);
    const o = (await C.get(`/api/orders/${ctx.o1}`)).data;
    assert.equal(o.status, 'CHIUSO'); assert.equal(o.packages.length, 5); assert.ok(o.packages.every((p) => p.status === 'RICEVUTO'));
    assert.equal(o.packages.find((p) => p.barcode === 'PK-0002').lot, 'L-VIOLA-2');
    assert.equal(o.lines.find((l) => l.article_code === 'PRV07').qty_delivered, 2);
    const st = (await C.get('/api/stock')).data; assert.equal(st.rows.find((x) => x.article_code === 'PRV07').packs, 2);
    assert.equal((await C.post(`/api/orders/${ctx.o1}/load-confirm`, {})).status, 403, 'il cliente Service non ha la fase 5');
    // difformità segnalabile dal cliente anche a processo concluso
    assert.equal((await C.post(`/api/orders/${ctx.o1}/issues`, { kind: 'DANNEGGIATO', description: 'Una confezione di provette rotta' })).status, 201);
    const iss = (await P.get('/api/stock/issues?status=APERTA')).data; assert.equal(iss.length, 1);
    assert.equal((await P.post(`/api/stock/issues/${iss[0].id}/close`, { response: 'Sostituita con il prossimo giro' })).status, 200);
  });

  // ---------- Processo sede TD: fasi 1-7 ----------
  await t.test('sede: carico iniziale e giacenza mensile (fase 7) con righe fuori elenco; ordine automatico generato', async () => {
    let r = await D.post('/api/stock/initial', { lines: [{ article_id: ctx.art.PRV07.id, qty: 3, lot: 'INIT', expiry: '2027-01-31' }, { article_id: ctx.art.PRV04.id, qty: 1 }], note: 'Prima giacenza' }); assert.equal(r.status, 201);
    // produzione della sede via HL7 con facility TD02 (nessun ORC-13)
    const hl7 = (ctrl, acc, code) => `MSH|^~\\&|STUDIOLAB|STUDIOLAB|TDORDERS|TD02|20260915||OML^O21|${ctrl}|P|2.5\rPV1||O|||||||||||||||||${acc}|||||||||||||||||||||||||20260915\rORC|SC|${acc}-1|X|${acc}|IP||||20260915\rOBR|1|${acc}-1|X|${code}^Emocromo\r`;
    for (let i = 1; i <= 310; i++) assert.equal((await ext('POST', '/api/integrations/studiolab/hl7', hl7(`S${i}`, `SACC-${i}`, '0014'), HL7_KEY, 'text/plain')).status, 200);
    r = await D.post('/api/stock/counts/open', { month: '2026-10' }); assert.equal(r.status, 200, JSON.stringify(r.data)); ctx.count = r.data.id;
    let c = (await D.get(`/api/stock/counts/${ctx.count}`)).data;
    assert.equal(c.status, 'BOZZA'); assert.ok(c.lines.length >= 49, 'elenco MOD252 più l\'articolo Silva reso visibile');
    const viola = c.lines.find((l) => l.article_code === 'PRV07'); assert.equal(viola.system_qty, 3); assert.equal(viola.counted_qty, 3);
    r = await D.put(`/api/stock/counts/${ctx.count}`, { lines: [{ article_id: ctx.art.PRV07.id, counted_qty: 2 }, { article_id: ctx.art.PRV04.id, counted_qty: 2 }] }); assert.equal(r.status, 200);
    r = await D.post(`/api/stock/counts/${ctx.count}/extras`, { name: 'Cerotti post prelievo (fornitura precedente)', qty: 4, note: 'non a catalogo' }); assert.equal(r.status, 201);
    r = await D.post(`/api/stock/counts/${ctx.count}/extras`, { article_id: ctx.art.KIT11.id, qty: 1 }); assert.equal(r.status, 201);
    c = (await D.get(`/api/stock/counts/${ctx.count}`)).data; assert.equal(c.extras.length, 2); assert.equal(c.extras[1].article_name, 'Kit Quantiferon');
    assert.equal((await D.del(`/api/stock/counts/${ctx.count}/extras/${c.extras[0].id}`)).status, 200);
    r = await D.post(`/api/stock/counts/${ctx.count}/confirm`); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.adjusted, 2); ctx.o2 = r.data.orderId;
    const o = (await D.get(`/api/orders/${ctx.o2}`)).data; assert.equal(o.status, 'INVIATO'); assert.equal(o.origin, 'SISTEMA');
    const v = o.lines.find((l) => l.article_code === 'PRV07'); // 310 emocromi / 100 = 3,1 conf; giacenza 2 -> (3,1 - 2) x 1,5 = 1,65 -> 2
    assert.equal(v.prod_packs_avg, 3.1); assert.equal(v.qty_proposed, 2);
  });
  await t.test('sede: fase 2 approvazione, fase 3/4 avanzamento registrato a mano dall\'Area Operations', async () => {
    const o0 = (await P.get(`/api/orders/${ctx.o2}`)).data; const grigio = o0.lines.find((l) => l.article_code === 'PRV04');
    let r = await P.post(`/api/orders/${ctx.o2}/verify`, { lines: [{ id: grigio.id, qty_approved: 2, note_ops: 'scorta minima' }], approve: true }); assert.equal(r.status, 200); assert.equal(r.data.status, 'APPROVATO');
    r = await P.post(`/api/orders/${ctx.o2}/picked`, { reference: 'manuale' }); assert.equal(r.status, 200);
    r = await P.post(`/api/orders/${ctx.o2}/shipped`, { ddt: 'DDT-2002' }); assert.equal(r.status, 200);
    r = await P.post(`/api/orders/${ctx.o2}/delivered`, { ddt: 'DDT-2002' }); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'CONSEGNATO');
    const o = (await D.get(`/api/orders/${ctx.o2}`)).data; assert.equal(o.status, 'CONSEGNATO'); assert.equal(o.packages.length, o.packs_total); assert.ok(o.packages.every((p) => p.status === 'ATTESO'));
    assert.equal((await P.post(`/api/orders/${ctx.o2}/close`)).status, 400, 'non chiudibile prima del carico');
  });
  await t.test('sede: fase 5 carico nel magazzino interno con lettura dei codici a barre, seleziona tutto, conferma', async () => {
    let r = await D.post(`/api/orders/${ctx.o2}/load-scan`, { code: '(01)08012345678905(17)271231(10)LOT-A' }); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.lot, 'LOT-A'); assert.equal(r.data.expiry, '2027-12-31');
    r = await D.post(`/api/orders/${ctx.o2}/load-scan`, { code: 'PRV07' }); assert.equal(r.status, 200);
    assert.equal((await D.post(`/api/orders/${ctx.o2}/load-scan`, { code: 'PRV07' })).status, 400, 'terza viola non attesa');
    assert.equal((await D.post(`/api/orders/${ctx.o2}/load-scan`, { code: 'XYZ' })).status, 400);
    const o = (await D.get(`/api/orders/${ctx.o2}`)).data;
    const first = o.packages.find((p) => p.status === 'ATTESO');
    r = await D.post(`/api/orders/${ctx.o2}/load`, { packages: [{ id: first.id, received: true, lot: 'M1' }] }); assert.equal(r.status, 200);
    r = await D.post(`/api/orders/${ctx.o2}/load-confirm`, { note: 'Manca il resto' }); assert.equal(r.status, 200); assert.equal(r.data.status, 'IMMAGAZZINATO'); assert.ok(r.data.missing > 0);
    const o2 = (await D.get(`/api/orders/${ctx.o2}`)).data; assert.equal(o2.status, 'IMMAGAZZINATO'); assert.equal(o2.issues.length, 1);
    const st = (await D.get('/api/stock')).data; assert.equal(st.rows.find((x) => x.article_code === 'PRV07').packs, 4, '2 iniziali + 2 caricate');
    assert.equal((await P.post(`/api/orders/${ctx.o2}/close`)).status, 400, 'difformità aperta');
    const iss = (await P.get('/api/stock/issues?status=APERTA')).data;
    assert.equal((await P.post(`/api/stock/issues/${iss[0].id}/close`, { response: 'Integrazione con il prossimo giro' })).status, 200);
    assert.equal((await P.post(`/api/orders/${ctx.o2}/close`)).status, 200);
  });
  await t.test('sede: fase 6 scarico per lettura del codice a barre (FEFO), registro scarichi, annullo', async () => {
    let r = await D.post('/api/stock/use', { code: '08012345678905' }); assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.used[0].expiry, '2027-01-31', 'esce la scadenza più vicina'); assert.equal(r.data.remaining, 3);
    r = await D.post('/api/stock/use', { article_id: ctx.art.PRV07.id, qty: 2 }); assert.equal(r.status, 200); assert.equal(r.data.remaining, 1);
    r = await D.post('/api/stock/unuse', { package_id: r.data.used[0].id }); assert.equal(r.status, 200);
    const un = (await D.get('/api/stock/unloads')).data; assert.equal(un.length, 2);
    const st = (await D.get('/api/stock')).data; assert.equal(st.rows.find((x) => x.article_code === 'PRV07').packs, 2);
    assert.equal((await P.get(`/api/stock?struttura_id=${ctx.sede}`)).data.rows.find((x) => x.article_code === 'PRV07').packs, 2, 'Operations vede la giacenza a distanza');
  });

  // ---------- Laboratorio TD ----------
  await t.test('laboratorio: giacenza entro il 30, bozza compilata dall\'Area Operations, consegna via API, carico', async () => {
    let r = await L.post('/api/stock/counts/open', { month: '2026-10' }); assert.equal(r.status, 200); const cid = r.data.id;
    r = await L.post(`/api/stock/counts/${cid}/confirm`); assert.equal(r.status, 200); ctx.o3 = r.data.orderId;
    let o = (await L.get(`/api/orders/${ctx.o3}`)).data; assert.equal(o.status, 'BOZZA'); assert.equal(o.kind, 'LAB');
    const ist = o.lines.find((l) => l.article_code === 'IST01');
    r = await P.post(`/api/orders/${ctx.o3}/verify`, { lines: [{ id: ist.id, qty_approved: 4 }], ops_notes: 'Ordine laboratorio', approve: true }); assert.equal(r.status, 200); assert.equal(r.data.status, 'APPROVATO');
    const n3 = (await P.get(`/api/orders/${ctx.o3}`)).data.number;
    const pending = (await ext('GET', '/api/integrations/silva/orders')).data.ordini; assert.equal(pending.length, 1); assert.equal(pending[0].tipoDestinatario, 'LABORATORIO_TD');
    r = await ext('POST', `/api/integrations/silva/orders/${n3}/consegnato`, { ddt: 'DDT-3003', righe: [{ codiceArticolo: 'IST01', confezioni: 4, lotto: 'F-1', scadenza: '2028-01-01' }] }); assert.equal(r.status, 200); assert.equal(r.data.status, 'CONSEGNATO');
    r = await L.post(`/api/orders/${ctx.o3}/load`, { all: true }); assert.equal(r.status, 200);
    r = await L.post(`/api/orders/${ctx.o3}/load-confirm`, {}); assert.equal(r.status, 200); assert.equal(r.data.missing, 0);
    assert.equal((await L.get('/api/stock')).data.rows.find((x) => x.article_code === 'IST01').packs, 4);
    assert.equal((await P.post(`/api/orders/${ctx.o3}/close`)).status, 200);
  });

  await t.test('annullamento, cruscotti, export, solleciti, registri, eliminazioni', async () => {
    let r = await C.post('/api/orders', { lines: [{ article_id: ctx.art.TRB01.id, qty: 1 }], submit: true }); assert.equal(r.status, 201);
    const cancelledId = r.data.id;
    r = await C.post(`/api/orders/${cancelledId}/cancel`, { reason: 'Inserito per errore' }); assert.equal(r.status, 200);
    // eliminazione dall'archivio: solo Area Operations; rifiutata con confezioni in giacenza o ordine nato da una giacenza mensile
    assert.equal((await C.del(`/api/orders/${cancelledId}`)).status, 403);
    const closed = (await P.get('/api/orders?status=CHIUSO')).data.find((o) => o.kind === 'SEDE');
    r = await P.del(`/api/orders/${closed.id}`); assert.equal(r.status, 400, JSON.stringify(r.data)); assert.match(r.data.error, /caricate|giacenza/);
    assert.equal((await P.del(`/api/orders/${cancelledId}`)).status, 200);
    assert.equal((await P.get(`/api/orders/${cancelledId}`)).status, 404);
    assert.ok((await S.get('/api/audit')).data.some((a) => a.action === 'ORDER_DELETE'));
    const dOps = (await P.get('/api/stats/dashboard')).data; assert.ok(dOps.byStatus); assert.ok(dOps.supplier.last_poll_at); assert.ok(dOps.supplier.last_feed_at); assert.ok(dOps.supplier.last_hl7_at);
    const dCli = (await C.get('/api/stats/dashboard')).data; assert.equal(dCli.stock.packs, 5);
    const dSede = (await D.get('/api/stats/dashboard')).data; assert.equal(dSede.stockCount.status, 'CONFERMATO');
    assert.equal((await P.raw('/api/stats/export/orders.xlsx')).status, 200);
    assert.equal((await D.raw('/api/stats/export/stock.xlsx')).status, 200);
    assert.ok((await P.get('/api/stats/network-stock')).data.length >= 2);
    r = await P.post('/api/alerts/run'); assert.equal(r.status, 200, JSON.stringify(r.data));
    const log = (await P.get('/api/email-log')).data; assert.ok(log.length >= 4); assert.equal(log[0].status, 'NON_CONFIGURATA');
    assert.ok((await S.get('/api/audit')).data.some((a) => a.action === 'ORDER_APPROVE'));
    const set = (await S.get('/api/settings')).data; assert.equal(set.silva.inboundConfigured, true); assert.ok(set.silva.last_poll_at);
    assert.equal((await P.get('/api/orders?status=CHIUSO')).data.length, 3);
    // eliminazioni
    r = await S.post('/api/strutture', { kind: 'CLIENTE', code: 'CLI-TMP', name: 'Cliente temporaneo' }); assert.equal(r.status, 201); const tmpS = r.data.id;
    r = await S.post('/api/users', { email: 'tmp@example.org', full_name: 'Utente temporaneo', role: 'CLIENTE', struttura_id: tmpS, auth_provider: 'LOCAL' }); assert.equal(r.status, 201); const tmpU = r.data.id;
    assert.equal((await S.del(`/api/strutture/${tmpS}`)).status, 400);
    assert.equal((await S.del(`/api/users/${tmpU}`)).status, 200);
    assert.equal((await S.del(`/api/strutture/${tmpS}`)).status, 200);
    assert.equal((await S.del(`/api/strutture/${ctx.cliente}`)).status, 400);
    assert.equal((await S.del(`/api/strutture/${ctx.lab}`)).status, 400);
    assert.equal((await C.post('/api/auth/logout')).status, 200); assert.equal((await C.get('/api/auth/me')).status, 401);
  });
});
