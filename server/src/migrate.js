import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'migrations');

export async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log(`[migrate] applicata ${f}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`Migrazione ${f} fallita: ${e.message}`);
    } finally {
      c.release();
    }
  }
  await seed();
}

async function seed() {
  // Azienda emittente con carta intestata
  if ((await pool.query('SELECT count(*)::int AS n FROM company')).rows[0].n === 0) {
    const logo = fs.readFileSync(path.join(here, 'assets', 'logo-td.png'));
    await pool.query(
      `INSERT INTO company (name, vat_number, address, zip, city, province, phone, email, pec, website, letterhead_footer, logo, logo_mime)
       VALUES ('Toscana Diagnostica S.r.l.','07528130482','Via di Pratignone, 13/4','50019','Sesto Fiorentino','FI','055776511',
         'info@toscanadiagnostica.it','toscanadiagnostica@pec.it','www.toscanadiagnostica.it',$1,$2,'image/png')`,
      ['Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI). Tel. e Fax: 055776511. Direttore Sanitario: prof. Gian Luigi Taddei.\nP.IVA e C.F.: 07528130482, REA n. FI-709602, Capitale Sociale: € 50.000,00 i.v.', logo],
    );
    console.log('[seed] creata azienda emittente');
  }
  // Catalogo MOD252: inserimento iniziale, poi solo aggiunta di articoli nuovi (le modifiche fatte dall'app restano)
  const cat = JSON.parse(fs.readFileSync(path.join(here, 'assets', 'catalogo_mod252.json'), 'utf8'));
  let i = 0;
  for (const c of cat.categorie) {
    await pool.query(`INSERT INTO categories (code, name, icon, sort) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING`, [c.code, c.name, c.icon, i++]);
  }
  let added = 0; i = 0;
  for (const a of cat.articoli) {
    const r = await pool.query(
      `INSERT INTO articles (code, category_code, name, unit, pack_size, pack_label, color, sort, source, visible_all) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'MOD252',TRUE) ON CONFLICT (code) DO NOTHING`,
      [a.code, a.category, a.name, a.unit, a.pack_size, a.pack_label, a.color || null, i++]);
    added += r.rowCount;
  }
  if (added) console.log(`[seed] catalogo MOD252: ${added} articoli inseriti`);
  // Correlazione esami StudioLab -> materiali: precaricata dal listino esami (proposta del 20/10/2026) solo se la tabella è vuota
  if ((await pool.query('SELECT count(*)::int AS n FROM exam_mappings')).rows[0].n === 0) {
    const seedFile = path.join(here, 'assets', 'correlazioni_seed.json');
    if (fs.existsSync(seedFile)) {
      const arts = new Map((await pool.query('SELECT id, code FROM articles')).rows.map((a) => [a.code, a.id]));
      let n = 0;
      for (const m of JSON.parse(fs.readFileSync(seedFile, 'utf8'))) {
        if (!arts.has(m.article_code)) continue;
        await pool.query('INSERT INTO exam_mappings (exam_code, exam_name, article_id, qty_per_exam) VALUES ($1,$2,$3,$4) ON CONFLICT (exam_code, article_id) DO NOTHING', [m.exam_code, m.exam_name || null, arts.get(m.article_code), m.qty_per_exam || 1]);
        n++;
      }
      console.log(`[seed] correlazioni esami-materiali: ${n} righe`);
    }
  }
  // Clienti Service e sedi del network dall'elenco clienti StudioLab (20/10/2026): a ogni avvio inserisce i codici mancanti,
  // non modifica mai le strutture già presenti (che si aggiornano dalla pagina Strutture, a mano o con l'import del file)
  {
    const seedFile = path.join(here, 'assets', 'strutture_seed.json');
    if (fs.existsSync(seedFile)) {
      let n = 0;
      for (const x of JSON.parse(fs.readFileSync(seedFile, 'utf8'))) {
        const r = await pool.query(`INSERT INTO strutture (kind, code, name, address, zip, city, province, phone, email, referente, studiolab_code, stock_deadline_day)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,15) ON CONFLICT (code) DO NOTHING`,
        [x.kind, x.code, x.name, x.address || null, x.zip || null, x.city || null, x.province || null, x.phone || null, x.email || null, x.referente || null, x.studiolab_code || x.code]);
        n += r.rowCount;
      }
      if (n) console.log(`[seed] strutture da elenco clienti: ${n} nuove`);
    }
  }
  // Il laboratorio di analisi di Toscana Diagnostica esiste sempre
  if ((await pool.query("SELECT count(*)::int AS n FROM strutture WHERE kind='LAB'")).rows[0].n === 0) {
    await pool.query(`INSERT INTO strutture (kind, code, name, address, zip, city, province, email, stock_deadline_day)
      VALUES ('LAB','LAB-TD','Laboratorio di Analisi Toscana Diagnostica','Via di Pratignone, 13/4','50019','Sesto Fiorentino','FI','info@toscanadiagnostica.it',30)`);
    console.log('[seed] creato Laboratorio TD');
  }
  if (config.seed.superadminEmail) {
    const ex = await pool.query('SELECT id FROM users WHERE lower(email)=lower($1)', [config.seed.superadminEmail]);
    if (!ex.rows.length) {
      if (!config.seed.superadminPassword || config.seed.superadminPassword.length < 12) {
        throw new Error('SEED_SUPERADMIN_PASSWORD obbligatoria (min 12 caratteri) per creare il super amministratore');
      }
      const hash = await bcrypt.hash(config.seed.superadminPassword, 12);
      await pool.query(
        `INSERT INTO users (email, full_name, role, auth_provider, password_hash, must_change_password) VALUES ($1,$2,'SUPERADMIN','BOTH',$3,TRUE)`,
        [config.seed.superadminEmail, config.seed.superadminName, hash],
      );
      console.log(`[seed] creato super amministratore ${config.seed.superadminEmail}`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
