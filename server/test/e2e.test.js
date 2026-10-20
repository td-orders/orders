// Test end-to-end delle API (server avviato su BASE con database vuoto, DISABLE_SCHEDULER=true, SILVA_MODE=SIMULATO)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from 'otplib';

const BASE = process.env.BASE || 'http://localhost:3000';
const SUPER = { email: 'francesco.epifani@toscanadiagnostica.it', password: process.env.SUPER_PWD || 'Prova-Sicura-2026' };
const NEWPWD = 'NuovaPassword-2026';

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

test('Orders Management: flusso completo', async (t) => {
  await t.test('CSRF e login errato', async () => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
    assert.equal((await S.post('/api/auth/login', { email: SUPER.email, password: 'sbagliata' })).status, 401);
  });
  await t.test('super amministratore: onboarding', async () => {
    const me = await login(S, SUPER.email, SUPER.password, NEWPWD, true);
    assert.equal(me.user.role, 'SUPERADMIN'); assert.equal(me.onboarding, null);
  });
  await t.test('catalogo MOD252 precaricato: 48 articoli in 9 categorie', async () => {
    const a = await S.get('/api/articles'); assert.equal(a.status, 200); assert.equal(a.data.length, 48);
    assert.equal((await S.get('/api/categories')).data.length, 9);
    ctx.art = Object.fromEntries(a.data.map((x) => [x.code, x]));
    // confezionamento modificabile
    const r = await S.put(`/api/articles/${ctx.art.PRV07.id}`, { name: 'Tappo Viola', unit: 'n. provette', pack_size: 100, pack_label: 'confezione da 100 provette', gtin: '08012345678905', min_stock_packs: 2, coverage_factor: 1.5 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });
  await t.test('strutture: cliente, sede, laboratorio', async () => {
    let r = await S.post('/api/strutture', { kind: 'CLIENTE', code: 'CLI-001', name: 'Studio Medico Rossi', city: 'Prato', province: 'po', email: 'cliente@example.org', referente: 'Dott. Rossi', studiolab_code: 'SL1001' });
    assert.equal(r.status, 201, JSON.stringify(r.data)); ctx.cliente = r.data.id;
    r = await S.post('/api/strutture', { kind: 'SEDE', code: 'SEDE-CAL', name: 'Punto prelievo Calenzano', city: 'Calenzano', province: 'FI', email: 'calenzano@example.org', studiolab_code: 'SL-CAL' });
    assert.equal(r.status, 201); ctx.sede = r.data.id;
    const lab = (await S.get('/api/strutture?kind=LAB')).data; assert.equal(lab.length, 1); ctx.lab = lab[0].id; assert.equal(lab[0].stock_deadline_day, 30);
    assert.equal((await S.post('/api/strutture', { kind: 'CLIENTE', code: 'CLI-001', name: 'Duplicato' })).status, 400);
  });
  await t.test('utenti: procurement, cliente, sede, laboratorio', async () => {
    const mk = async (b) => { const r = await S.post('/api/users', b); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data; };
    ctx.pwdP = (await mk({ email: 'ops@toscanadiagnostica.it', full_name: 'Operations Manager', role: 'PROCUREMENT', auth_provider: 'LOCAL' })).temporaryPassword;
    ctx.pwdC = (await mk({ email: 'cliente@example.org', full_name: 'Mario Rossi', role: 'CLIENTE', struttura_id: ctx.cliente, auth_provider: 'LOCAL', is_referente: true })).temporaryPassword;
    ctx.pwdD = (await mk({ email: 'sede@example.org', full_name: 'Referente Calenzano', role: 'SEDE', struttura_id: ctx.sede, auth_provider: 'LOCAL', is_referente: true })).temporaryPassword;
    ctx.pwdL = (await mk({ email: 'lab@example.org', full_name: 'Referente Laboratorio', role: 'LAB', struttura_id: ctx.lab, auth_provider: 'LOCAL' })).temporaryPassword;
    assert.equal((await S.post('/api/users', { email: 'x@example.org', full_name: 'Errato', role: 'SEDE', struttura_id: ctx.cliente })).status, 400, 'tipo struttura incoerente');
    assert.equal((await login(P, 'ops@toscanadiagnostica.it', ctx.pwdP, NEWPWD, true)).user.role, 'PROCUREMENT');
    assert.equal((await login(C, 'cliente@example.org', ctx.pwdC, NEWPWD, false)).user.role, 'CLIENTE');
    assert.equal((await login(D, 'sede@example.org', ctx.pwdD, NEWPWD, false)).user.role, 'SEDE');
    assert.equal((await login(L, 'lab@example.org', ctx.pwdL, NEWPWD, false)).user.role, 'LAB');
    assert.equal((await C.get('/api/users')).status, 403, 'il cliente non vede gli utenti');
    assert.equal((await C.get(`/api/strutture/${ctx.sede}`)).status, 403, 'il cliente non vede altre strutture');
  });
  await t.test('correlazione esami StudioLab e produzione', async () => {
    let r = await P.post('/api/mappings', { exam_code: '0014', exam_name: 'Emocromo', article_id: ctx.art.PRV07.id, qty_per_exam: 1 }); assert.equal(r.status, 201);
    r = await P.post('/api/mappings', { exam_code: '0020', exam_name: 'Glicemia', article_id: ctx.art.PRV04.id, qty_per_exam: 1 }); assert.equal(r.status, 201);
    r = await P.post('/api/mappings', { exam_code: '0020', exam_name: 'Glicemia', article_id: ctx.art.PRE01.id, qty_per_exam: 1 }); assert.equal(r.status, 201);
    assert.equal((await P.get('/api/mappings')).data.length, 3);
    // tre mesi di produzione: 140 emocromi medi per il cliente
    for (const [m, q14, q20] of [['2026-07', 130, 90], ['2026-08', 150, 100], ['2026-09', 140, 110]]) {
      r = await P.post('/api/production', { struttura_id: ctx.cliente, month: m, items: [{ examCode: '0014', examName: 'Emocromo', qty: q14 }, { examCode: '0020', examName: 'Glicemia', qty: q20 }] });
      assert.equal(r.status, 200, JSON.stringify(r.data));
    }
    // import da CSV per la sede
    const csv = 'struttura;mese;esame;descrizione;qta\nSEDE-CAL;2026-08;0014;Emocromo;300\nSEDE-CAL;2026-09;0014;Emocromo;320\nSL-CAL;2026-09;0020;Glicemia;200\n';
    const fd = new FormData(); fd.append('file', new Blob([csv], { type: 'text/csv' }), 'produzione.csv');
    r = await P.upload('/api/production/import', fd); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.rows, 3);
    const cons = await P.get(`/api/stock/consumption?struttura_id=${ctx.cliente}`); assert.equal(cons.status, 200);
    const viola = cons.data.items.find((x) => x.article_id === ctx.art.PRV07.id);
    assert.equal(viola.units, 140); assert.equal(viola.packs, 1.4); assert.equal(cons.data.months, 3);
    assert.equal((await P.post('/api/production/sync', { struttura_id: ctx.cliente })).status, 400, 'StudioLab simulato');
    assert.equal((await C.get(`/api/production?struttura_id=${ctx.sede}`)).data.length, 6, 'il cliente vede solo la propria produzione (parametro ignorato)');
  });

  // ---------- Processo 1: cliente ----------
  await t.test('1a cliente: carrello, bozza, invio', async () => {
    let r = await C.post('/api/orders', { lines: [], notes: 'vuoto' }); assert.equal(r.status, 400);
    r = await C.post('/api/orders', { lines: [{ article_id: ctx.art.PRV07.id, qty: 2 }, { article_id: ctx.art.PRV04.id, qty: 1 }, { article_id: ctx.art.KIT03.id, qty: 3 }], notes: 'Consegna al piano terra', urgent: true });
    assert.equal(r.status, 400, 'urgenza senza motivo');
    r = await C.post('/api/orders', { lines: [{ article_id: ctx.art.PRV07.id, qty: 2 }, { article_id: ctx.art.PRV04.id, qty: 5 }, { article_id: ctx.art.KIT03.id, qty: 3 }], notes: 'Consegna al piano terra', client_ref: 'RIC-77' });
    assert.equal(r.status, 201, JSON.stringify(r.data)); ctx.o1 = r.data.id;
    let o = (await C.get(`/api/orders/${ctx.o1}`)).data; assert.equal(o.status, 'BOZZA'); assert.equal(o.lines.length, 3);
    r = await C.put(`/api/orders/${ctx.o1}`, { lines: [{ article_id: ctx.art.PRV07.id, qty: 2 }, { article_id: ctx.art.PRV04.id, qty: 5 }], notes: 'Consegna al piano terra', client_ref: 'RIC-77' }); assert.equal(r.status, 200);
    r = await C.post(`/api/orders/${ctx.o1}/submit`); assert.equal(r.status, 200, JSON.stringify(r.data));
    o = (await C.get(`/api/orders/${ctx.o1}`)).data; assert.equal(o.status, 'INVIATO'); assert.equal(o.lines.length, 2); assert.match(o.number, /^ORD-\d{4}-0001$/);
    assert.equal((await C.put(`/api/orders/${ctx.o1}`, { lines: [] })).status, 400, 'non modificabile dopo l\'invio');
    assert.equal((await D.get(`/api/orders/${ctx.o1}`)).status, 403, 'la sede non vede gli ordini del cliente');
  });
  await t.test('1b operations: verifica con produzione, distanza %, approvazione e trasmissione a Silva (simulata)', async () => {
    const o = (await P.get(`/api/orders/${ctx.o1}`)).data;
    const viola = o.lines.find((l) => l.article_code === 'PRV07'); const grigio = o.lines.find((l) => l.article_code === 'PRV04');
    assert.equal(viola.prod_units_avg, 140); assert.equal(viola.prod_packs_avg, 1.4); assert.equal(viola.delta_pct, 42.9); assert.equal(viola.qty_approved, 2, 'approvato precompilato con il richiesto');
    assert.equal(grigio.prod_packs_avg, 1); assert.equal(grigio.delta_pct, 400, '5 confezioni contro 1 di produzione');
    assert.equal(o.anomalies, 1);
    assert.equal((await C.post(`/api/orders/${ctx.o1}/approve`)).status, 403, 'il cliente non approva');
    let r = await P.post(`/api/orders/${ctx.o1}/verify`, { lines: [{ id: grigio.id, qty_approved: 2, note_ops: 'Ridotto: produzione 1 conf./mese' }], ops_notes: 'Verificato', approve: true });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'TRASMESSO'); assert.equal(r.data.mode, 'SIMULATO'); assert.match(r.data.reference, /^SIM-ORD/);
    const o2 = (await P.get(`/api/orders/${ctx.o1}`)).data;
    assert.equal(o2.status, 'TRASMESSO'); assert.equal(o2.packages.length, 4, 'una riga per confezione: 2 viola + 2 grigie');
    assert.equal(o2.silva_payload.lines.length, 2); assert.equal(o2.silva_payload.lines.find((l) => l.articleCode === 'PRV04').packs, 2);
    const pdf = await C.raw(`/api/orders/${ctx.o1}/pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    ctx.pdf1 = Buffer.from(await pdf.arrayBuffer()); assert.ok(ctx.pdf1.length > 5000);
  });
  await t.test('1c cliente: ricezione per confezione (scansione GS1 + spunta), conferma con una mancante', async () => {
    let r = await C.post(`/api/orders/${ctx.o1}/scan`, { code: '(01)08012345678905(17)271231(10)LOT2026A' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'RICEVUTO'); assert.equal(r.data.lot, 'LOT2026A'); assert.equal(r.data.expiry, '2027-12-31');
    r = await C.post(`/api/orders/${ctx.o1}/scan`, { code: 'PRV07', lot: 'LOT2026B', expiry: '2027-06-30' }); assert.equal(r.status, 200);
    assert.equal((await C.post(`/api/orders/${ctx.o1}/scan`, { code: 'PRV07' })).status, 400, 'terza viola non attesa');
    assert.equal((await C.post(`/api/orders/${ctx.o1}/scan`, { code: 'XYZ' })).status, 400);
    const o = (await C.get(`/api/orders/${ctx.o1}`)).data;
    const grigie = o.packages.filter((p) => p.article_code === 'PRV04');
    r = await C.post(`/api/orders/${ctx.o1}/receive`, { packages: [{ id: grigie[0].id, received: true, lot: 'G1' }] }); assert.equal(r.status, 200);
    r = await C.post(`/api/orders/${ctx.o1}/confirm-receipt`, { note: 'Manca una confezione grigia' }); assert.equal(r.status, 200); assert.equal(r.data.missing, 1);
    const o2 = (await C.get(`/api/orders/${ctx.o1}`)).data;
    assert.equal(o2.status, 'CONSEGNATO'); assert.equal(o2.packages.filter((p) => p.status === 'NON_RICEVUTO').length, 1); assert.equal(o2.issues.length, 1); assert.equal(o2.issues[0].kind, 'MANCANTE');
    assert.equal(o2.lines.find((l) => l.article_code === 'PRV04').qty_received, 1);
    const st = (await C.get('/api/stock')).data; assert.equal(st.rows.find((x) => x.article_code === 'PRV07').packs, 2);
    assert.equal(st.rows.find((x) => x.article_code === 'PRV07').next_expiry, '2027-06-30', 'FEFO: la prima scadenza');
  });
  await t.test('1d operations: difformità e chiusura', async () => {
    assert.equal((await P.post(`/api/orders/${ctx.o1}/close`)).status, 400, 'difformità aperta');
    const issues = (await P.get('/api/stock/issues?status=APERTA')).data; assert.equal(issues.length, 1);
    let r = await P.post(`/api/stock/issues/${issues[0].id}/close`, { response: 'Confezione mancante inviata con il giro di domani' }); assert.equal(r.status, 200);
    r = await P.post(`/api/orders/${ctx.o1}/close`); assert.equal(r.status, 200);
    assert.equal((await P.get(`/api/orders/${ctx.o1}`)).data.status, 'CHIUSO');
    const ev = (await P.get(`/api/orders/${ctx.o1}`)).data.events.map((e) => e.event);
    assert.ok(ev.includes('Processo concluso') && ev.some((e) => e.startsWith('Trasmesso')));
  });

  // ---------- Processo 2: sede del network ----------
  await t.test('2a/2b sede: carico iniziale, giacenza mensile con tre colonne', async () => {
    let r = await D.post('/api/stock/initial', { lines: [{ article_id: ctx.art.PRV07.id, qty: 3, lot: 'INIT', expiry: '2027-01-31' }, { article_id: ctx.art.PRV04.id, qty: 1 }], note: 'Prima giacenza' });
    assert.equal(r.status, 201); assert.equal(r.data.packages, 4);
    r = await D.post('/api/stock/counts/open', { month: '2026-10' }); assert.equal(r.status, 200, JSON.stringify(r.data)); ctx.count = r.data.id;
    const c = (await D.get(`/api/stock/counts/${ctx.count}`)).data;
    assert.equal(c.status, 'BOZZA'); assert.equal(c.lines.length, 48);
    const viola = c.lines.find((l) => l.article_code === 'PRV07');
    assert.equal(viola.last_order_qty, 0); assert.equal(viola.system_qty, 3); assert.equal(viola.counted_qty, 3, 'terza colonna precompilata con la seconda');
    assert.equal((await C.post('/api/stock/counts/open', { month: '2026-10' })).status, 400, 'il cliente non ha giacenza mensile');
    // la sede conta 2 viola (una in meno) e 2 grigie (una in più)
    r = await D.put(`/api/stock/counts/${ctx.count}`, { lines: [{ article_id: ctx.art.PRV07.id, counted_qty: 2 }, { article_id: ctx.art.PRV04.id, counted_qty: 2 }] }); assert.equal(r.status, 200);
  });
  await t.test('2c conferma giacenza: rettifiche e ordine potenziale con formula (produzione - giacenza) x 1,5', async () => {
    const r = await D.post(`/api/stock/counts/${ctx.count}/confirm`); assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.adjusted, 2); ctx.o2 = r.data.orderId;
    const st = (await D.get('/api/stock')).data;
    assert.equal(st.rows.find((x) => x.article_code === 'PRV07').packs, 2); assert.equal(st.rows.find((x) => x.article_code === 'PRV04').packs, 2);
    const o = (await D.get(`/api/orders/${ctx.o2}`)).data;
    assert.equal(o.status, 'INVIATO'); assert.equal(o.origin, 'SISTEMA'); assert.equal(o.kind, 'SEDE');
    const viola = o.lines.find((l) => l.article_code === 'PRV07');
    // produzione sede: emocromi 300 e 320 su 2 mesi = 310 unità = 3,1 confezioni; giacenza 2 -> (3,1 - 2) x 1,5 = 1,65 -> 2
    assert.equal(viola.prod_packs_avg, 3.1); assert.equal(viola.stock_packs, 2); assert.equal(viola.qty_proposed, 2); assert.equal(viola.qty_approved, 2);
    const grigio = o.lines.find((l) => l.article_code === 'PRV04');
    // glicemia 200 in un mese su 2 mesi di produzione = 100 unità = 1 conf; giacenza 2 -> (1 - 2) x 1,5 < 0 -> 0
    assert.equal(grigio.qty_proposed, 0);
    assert.equal((await D.post(`/api/stock/counts/${ctx.count}/confirm`)).status, 400, 'non riconfermabile');
    const counts = (await P.get('/api/stock/counts')).data; assert.equal(counts[0].status, 'CONFERMATO'); assert.equal(counts[0].differences, 2);
  });
  await t.test('2d operations: modifica proposta, approva e trasmette', async () => {
    const o = (await P.get(`/api/orders/${ctx.o2}`)).data;
    const grigio = o.lines.find((l) => l.article_code === 'PRV04');
    const r = await P.post(`/api/orders/${ctx.o2}/verify`, { lines: [{ id: grigio.id, qty_approved: 1, note_ops: 'Scorta minima' }], approve: true });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'TRASMESSO');
    const o2 = (await P.get(`/api/orders/${ctx.o2}`)).data;
    assert.equal(o.lines.find((l) => l.article_code === 'PRE01').qty_proposed, 3, 'aghi 21G: glicemia 100/mese = 2 conf., giacenza 0 -> 3');
    assert.equal(o2.packages.length, 6, '2 viola + 1 grigia + 3 aghi');
  });
  await t.test('2e sede: seleziona tutto e conferma, materiale preso in carico', async () => {
    let r = await D.post(`/api/orders/${ctx.o2}/receive`, { all: true }); assert.equal(r.status, 200);
    r = await D.post(`/api/orders/${ctx.o2}/confirm-receipt`, {}); assert.equal(r.status, 200); assert.equal(r.data.missing, 0);
    const st = (await D.get('/api/stock')).data; assert.equal(st.rows.find((x) => x.article_code === 'PRV07').packs, 4);
    assert.equal((await P.post(`/api/orders/${ctx.o2}/close`)).status, 200);
  });
  await t.test('2f sede: messa in uso per scansione, spunta (FEFO) e annullo', async () => {
    let r = await D.post('/api/stock/use', { code: '08012345678905' }); assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.used[0].expiry, '2027-01-31', 'esce prima la confezione con scadenza più vicina'); assert.equal(r.data.remaining, 3);
    r = await D.post('/api/stock/use', { article_id: ctx.art.PRV07.id, qty: 2 }); assert.equal(r.status, 200); assert.equal(r.data.remaining, 1);
    r = await D.post('/api/stock/unuse', { package_id: r.data.used[0].id }); assert.equal(r.status, 200);
    const st = (await D.get('/api/stock')).data; const viola = st.rows.find((x) => x.article_code === 'PRV07');
    assert.equal(viola.packs, 2); assert.equal(viola.used_this_month, 2);
    const ops = (await P.get(`/api/stock?struttura_id=${ctx.sede}`)).data; assert.equal(ops.rows.find((x) => x.article_code === 'PRV07').packs, 2, 'Operations vede la giacenza a distanza');
    const pk = (await D.get('/api/stock/packages?status=IN_USO')).data; assert.equal(pk.length, 2);
    assert.equal((await D.post('/api/stock/use', { article_id: ctx.art.KIT01.id })).status, 400, 'nessuna giacenza');
  });

  // ---------- Processo 3: laboratorio TD ----------
  await t.test('3 laboratorio: giacenza entro il 30, bozza d\'ordine compilata e approvata dall\'Area Operations', async () => {
    let r = await L.post('/api/stock/initial', { lines: [{ article_id: ctx.art.IST01.id, qty: 2 }] }); assert.equal(r.status, 201);
    r = await L.post('/api/stock/counts/open', { month: '2026-10' }); assert.equal(r.status, 200); const cid = r.data.id;
    r = await L.post(`/api/stock/counts/${cid}/confirm`); assert.equal(r.status, 200); ctx.o3 = r.data.orderId; assert.equal(r.data.proposed, 0);
    let o = (await L.get(`/api/orders/${ctx.o3}`)).data; assert.equal(o.status, 'BOZZA'); assert.equal(o.origin, 'OPERATIONS'); assert.equal(o.kind, 'LAB');
    assert.equal(o.lines.find((l) => l.article_code === 'IST01').stock_packs, 2); assert.equal(o.lines.find((l) => l.article_code === 'IST01').prod_packs_avg, null, 'niente produzione per il laboratorio');
    const ist = o.lines.find((l) => l.article_code === 'IST01'); const kit = o.lines.find((l) => l.article_code === 'KIT11');
    assert.equal((await L.post(`/api/orders/${ctx.o3}/approve`)).status, 403);
    r = await P.post(`/api/orders/${ctx.o3}/verify`, { lines: [{ id: ist.id, qty_approved: 4 }, { id: kit.id, qty_approved: 1 }], ops_notes: 'Ordine laboratorio ottobre', approve: true });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'TRASMESSO');
    o = (await P.get(`/api/orders/${ctx.o3}`)).data; assert.equal(o.packages.length, 5);
    r = await L.post(`/api/orders/${ctx.o3}/receive`, { all: true }); r = await L.post(`/api/orders/${ctx.o3}/confirm-receipt`, {}); assert.equal(r.status, 200);
    assert.equal((await L.get('/api/stock')).data.rows.find((x) => x.article_code === 'IST01').packs, 6);
    assert.equal((await P.post(`/api/orders/${ctx.o3}/close`)).status, 200);
  });

  await t.test('annullamento, cruscotti, export, solleciti, registri', async () => {
    let r = await C.post('/api/orders', { lines: [{ article_id: ctx.art.TRB01.id, qty: 1 }], submit: true }); assert.equal(r.status, 201);
    r = await C.post(`/api/orders/${r.data.id}/cancel`, { reason: 'Inserito per errore' }); assert.equal(r.status, 200);
    const dOps = (await P.get('/api/stats/dashboard')).data; assert.ok(dOps.byStatus); assert.ok(dOps.pendingCounts.length >= 0); assert.ok(dOps.strutture.clienti === 1);
    const dCli = (await C.get('/api/stats/dashboard')).data; assert.equal(dCli.stock.packs, 3); assert.equal(dCli.stockCount, undefined);
    const dSede = (await D.get('/api/stats/dashboard')).data; assert.equal(dSede.stockCount.status, 'DA_INSERIRE' === dSede.stockCount.status ? dSede.stockCount.status : dSede.stockCount.status);
    const x1 = await P.raw('/api/stats/export/orders.xlsx'); assert.equal(x1.status, 200);
    const x2 = await D.raw('/api/stats/export/stock.xlsx'); assert.equal(x2.status, 200);
    const ns = await P.get('/api/stats/network-stock'); assert.equal(ns.status, 200); assert.ok(ns.data.length >= 2);
    r = await P.post('/api/alerts/run'); assert.equal(r.status, 200, JSON.stringify(r.data));
    const log = (await P.get('/api/email-log')).data; assert.ok(log.length >= 4, 'email registrate anche senza configurazione'); assert.equal(log[0].status, 'NON_CONFIGURATA');
    const au = (await S.get('/api/audit')).data; assert.ok(au.some((a) => a.action === 'ORDER_TRANSMIT'));
    const set = (await S.get('/api/settings')).data; assert.equal(set.settings.reorder_formula, 'DIFF_X_FACTOR'); assert.equal(set.silva.mode, 'SIMULATO');
    r = await S.put('/api/settings', { production_months: 3, reorder_formula: 'DIFF_X_FACTOR' }); assert.equal(r.status, 200);
    const list = (await P.get('/api/orders?status=CHIUSO')).data; assert.equal(list.length, 3);
    assert.equal((await P.get(`/api/strutture`)).data.find((s) => s.id === ctx.cliente).open_orders, 0);
    assert.equal((await C.post('/api/auth/logout')).status, 200); assert.equal((await C.get('/api/auth/me')).status, 401);
  });
});
