-- Toscana Diagnostica · Orders Management
-- Schema iniziale

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Azienda emittente (carta intestata dei PDF)
CREATE TABLE company (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  vat_number        TEXT,
  address           TEXT, zip TEXT, city TEXT, province TEXT,
  phone             TEXT, email TEXT, pec TEXT, website TEXT,
  letterhead_footer TEXT,
  logo              BYTEA,
  logo_mime         TEXT
);

-- Catalogo chiuso del MOD252 sezione B
CREATE TABLE categories (
  code  TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  icon  TEXT NOT NULL DEFAULT 'kit',
  sort  INT NOT NULL DEFAULT 0
);

CREATE TABLE articles (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  category_code   TEXT NOT NULL REFERENCES categories(code),
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL,                       -- unità di consumo del modulo (n. provette, n. KIT...)
  pack_size       INT NOT NULL DEFAULT 1 CHECK (pack_size > 0), -- unità per confezione
  pack_label      TEXT NOT NULL,                       -- descrizione della confezione
  color           TEXT,                                -- colore per la grafica dell'oggetto
  gtin            TEXT,                                -- codice a barre del produttore (facoltativo)
  coverage_factor NUMERIC(5,2) NOT NULL DEFAULT 1.5,   -- fattore di copertura per l'ordine automatico
  min_stock_packs INT NOT NULL DEFAULT 0,              -- soglia di attenzione in confezioni
  lab_only        BOOLEAN NOT NULL DEFAULT FALSE,      -- visibile solo al laboratorio TD
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  sort            INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Strutture: clienti Service (CLIENTE), sedi del network (SEDE), laboratorio di analisi TD (LAB)
CREATE TABLE strutture (
  id                 SERIAL PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('CLIENTE','SEDE','LAB')),
  code               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  address            TEXT, zip TEXT, city TEXT, province TEXT,
  phone              TEXT, email TEXT, pec TEXT,
  referente          TEXT,                -- referente per le richieste
  referente_phone    TEXT,
  studiolab_code     TEXT,                -- codice cliente su StudioLab (per produzione e credenziali)
  delivery_notes     TEXT,
  delivery_mode      TEXT NOT NULL DEFAULT 'GIRO' CHECK (delivery_mode IN ('GIRO','RITIRO')),
  stock_deadline_day INT NOT NULL DEFAULT 15 CHECK (stock_deadline_day BETWEEN 1 AND 31),
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('SUPERADMIN','PROCUREMENT','CLIENTE','SEDE','LAB')),
  struttura_id         INT REFERENCES strutture(id),
  is_referente         BOOLEAN NOT NULL DEFAULT FALSE,
  auth_provider        TEXT NOT NULL DEFAULT 'LOCAL' CHECK (auth_provider IN ('LOCAL','ENTRA','BOTH','STUDIOLAB')),
  studiolab_username   TEXT,
  password_hash        TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  totp_secret          TEXT,
  totp_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  entra_oid            TEXT,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  failed_logins        INT NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role IN ('SUPERADMIN','PROCUREMENT') OR struttura_id IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE UNIQUE INDEX users_studiolab_uq ON users (lower(studiolab_username)) WHERE studiolab_username IS NOT NULL;

-- Correlazione esame StudioLab -> materiale consumato
CREATE TABLE exam_mappings (
  id           SERIAL PRIMARY KEY,
  exam_code    TEXT NOT NULL,
  exam_name    TEXT,
  article_id   INT NOT NULL REFERENCES articles(id),
  qty_per_exam NUMERIC(8,3) NOT NULL DEFAULT 1 CHECK (qty_per_exam > 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (exam_code, article_id)
);

-- Produzione mensile per struttura (da StudioLab, import o inserimento manuale)
CREATE TABLE production (
  id           SERIAL PRIMARY KEY,
  struttura_id INT NOT NULL REFERENCES strutture(id),
  month        DATE NOT NULL,              -- primo giorno del mese
  exam_code    TEXT NOT NULL,
  exam_name    TEXT,
  qty          INT NOT NULL CHECK (qty >= 0),
  source       TEXT NOT NULL DEFAULT 'MANUALE' CHECK (source IN ('STUDIOLAB','IMPORT','MANUALE')),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (struttura_id, month, exam_code)
);

CREATE TABLE order_counters (year INT PRIMARY KEY, last INT NOT NULL DEFAULT 0);

CREATE TABLE orders (
  id                  SERIAL PRIMARY KEY,
  number              TEXT NOT NULL UNIQUE,
  struttura_id        INT NOT NULL REFERENCES strutture(id),
  kind                TEXT NOT NULL CHECK (kind IN ('CLIENTE','SEDE','LAB')),
  origin              TEXT NOT NULL CHECK (origin IN ('CLIENTE','SISTEMA','OPERATIONS')),
  status              TEXT NOT NULL DEFAULT 'BOZZA'
                      CHECK (status IN ('BOZZA','INVIATO','APPROVATO','TRASMESSO','CONSEGNATO','CHIUSO','ANNULLATO')),
  urgent              BOOLEAN NOT NULL DEFAULT FALSE,
  urgent_reason       TEXT,
  notes               TEXT,                -- note del richiedente
  ops_notes           TEXT,                -- note dell'Area Operations
  client_ref          TEXT,                -- riferimento interno del cliente
  stock_count_id      INT,                 -- giacenza mensile da cui nasce (ordini di sede e laboratorio)
  requested_by        INT REFERENCES users(id),
  submitted_at        TIMESTAMPTZ,
  approved_by         INT REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  transmitted_at      TIMESTAMPTZ,
  silva_mode          TEXT,
  silva_reference     TEXT,
  silva_payload       JSONB,
  received_at         TIMESTAMPTZ,
  received_by         INT REFERENCES users(id),
  closed_by           INT REFERENCES users(id),
  closed_at           TIMESTAMPTZ,
  cancelled_by        INT REFERENCES users(id),
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  pdf                 BYTEA,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_struttura_idx ON orders (struttura_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (status);

CREATE TABLE order_lines (
  id             SERIAL PRIMARY KEY,
  order_id       INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  article_id     INT NOT NULL REFERENCES articles(id),
  qty_requested  INT NOT NULL DEFAULT 0 CHECK (qty_requested >= 0),  -- confezioni richieste dal cliente
  qty_proposed   INT,                                               -- confezioni proposte dal sistema (ordini di sede)
  qty_approved   INT,                                               -- confezioni approvate dall'Area Operations
  prod_units_avg NUMERIC(12,2),                                     -- consumo medio mensile (unità) dalla produzione
  prod_packs_avg NUMERIC(12,2),                                     -- idem in confezioni
  delta_pct      NUMERIC(8,1),                                      -- distanza % tra ordine e produzione
  stock_packs    INT,                                               -- giacenza al momento (confezioni)
  last_order_qty INT,                                               -- quantità dell'ultimo ordine approvato
  qty_received   INT NOT NULL DEFAULT 0,
  note_client    TEXT,
  note_ops       TEXT,
  UNIQUE (order_id, article_id)
);

-- Ogni confezione consegnata è una riga: si riceve, si mette in uso, si traccia lotto e scadenza
CREATE TABLE packages (
  id           SERIAL PRIMARY KEY,
  struttura_id INT NOT NULL REFERENCES strutture(id),
  article_id   INT NOT NULL REFERENCES articles(id),
  order_id     INT REFERENCES orders(id) ON DELETE CASCADE,
  line_id      INT REFERENCES order_lines(id) ON DELETE CASCADE,
  seq          INT NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'ATTESO' CHECK (status IN ('ATTESO','RICEVUTO','IN_USO','NON_RICEVUTO','RETTIFICATO')),
  origin       TEXT NOT NULL DEFAULT 'ORDINE' CHECK (origin IN ('ORDINE','INIZIALE','RETTIFICA')),
  barcode      TEXT,
  lot          TEXT,
  expiry       DATE,
  received_at  TIMESTAMPTZ,
  received_by  INT REFERENCES users(id),
  used_at      TIMESTAMPTZ,
  used_by      INT REFERENCES users(id),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX packages_stock_idx ON packages (struttura_id, article_id, status);
CREATE INDEX packages_order_idx ON packages (order_id);

-- Giacenza mensile dichiarata dalle strutture (sedi entro il 15, laboratorio entro il 30)
CREATE TABLE stock_counts (
  id           SERIAL PRIMARY KEY,
  struttura_id INT NOT NULL REFERENCES strutture(id),
  month        DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'BOZZA' CHECK (status IN ('BOZZA','CONFERMATO')),
  confirmed_by INT REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  order_id     INT REFERENCES orders(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (struttura_id, month)
);

CREATE TABLE stock_count_lines (
  count_id       INT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  article_id     INT NOT NULL REFERENCES articles(id),
  last_order_qty INT NOT NULL DEFAULT 0,   -- colonna 1: ultimo ordine (immodificabile)
  system_qty     INT NOT NULL DEFAULT 0,   -- colonna 2: giacenza da scarichi (immodificabile)
  counted_qty    INT NOT NULL DEFAULT 0,   -- colonna 3: giacenza effettiva
  PRIMARY KEY (count_id, article_id)
);

CREATE TABLE order_events (
  id       SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id  INT REFERENCES users(id),
  event    TEXT NOT NULL,
  data     JSONB
);

-- Difformità segnalate alla ricezione (mancanze, danni) e loro chiusura
CREATE TABLE issues (
  id           SERIAL PRIMARY KEY,
  order_id     INT REFERENCES orders(id) ON DELETE CASCADE,
  struttura_id INT NOT NULL REFERENCES strutture(id),
  kind         TEXT NOT NULL CHECK (kind IN ('MANCANTE','DANNEGGIATO','ERRATO','ALTRO')),
  description  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'APERTA' CHECK (status IN ('APERTA','CHIUSA')),
  opened_by    INT REFERENCES users(id),
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  response     TEXT,
  closed_by    INT REFERENCES users(id),
  closed_at    TIMESTAMPTZ
);

CREATE TABLE email_log (
  id              SERIAL PRIMARY KEY,
  struttura_id    INT REFERENCES strutture(id),
  kind            TEXT NOT NULL,
  ref_key         TEXT,
  to_addr         TEXT NOT NULL,
  cc_addr         TEXT,
  subject         TEXT NOT NULL,
  body            TEXT,
  attachment_name TEXT,
  status          TEXT NOT NULL,
  error           TEXT,
  sent_by         INT REFERENCES users(id),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_log_ref_idx ON email_log (ref_key);

CREATE TABLE audit_log (
  id        SERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id   INT,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  data      JSONB,
  ip        TEXT
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

CREATE TABLE "session" (
  sid    VARCHAR NOT NULL PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX session_expire_idx ON "session" (expire);

INSERT INTO app_settings (key, value) VALUES
  ('reorder_formula', 'DIFF_X_FACTOR'),      -- DIFF_X_FACTOR: (produzione - giacenza) x fattore; TARGET_MINUS_STOCK: produzione x fattore - giacenza
  ('production_months', '3'),                -- mesi di produzione per la media
  ('alerts_enabled', 'true'),
  ('alert_hour', '9'),
  ('receipt_reminder_days', '5'),
  ('verify_reminder_days', '2');
