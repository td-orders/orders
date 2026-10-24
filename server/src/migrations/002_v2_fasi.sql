-- v2: flusso a fasi separate, magazzino Silva, API di integrazione, HL7 StudioLab

-- Fase 0: articoli dal magazzino Silva, visibilità decisa dall'Area Operations
INSERT INTO categories (code, name, icon, sort) VALUES ('MAGAZZINO', 'Altri articoli del magazzino', 'kit', 99) ON CONFLICT (code) DO NOTHING;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS silva_code TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MOD252' CHECK (source IN ('MOD252','SILVA','MANUALE'));
ALTER TABLE articles ADD COLUMN IF NOT EXISTS visible_all BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS visible_sedi BOOLEAN NOT NULL DEFAULT FALSE;      -- punti prelievo e laboratorio TD
ALTER TABLE articles ADD COLUMN IF NOT EXISTS visible_service BOOLEAN NOT NULL DEFAULT FALSE;   -- clienti Service
CREATE UNIQUE INDEX IF NOT EXISTS articles_silva_code_uq ON articles (silva_code) WHERE silva_code IS NOT NULL;
-- il catalogo MOD252 resta visibile a tutti finché l'Area Operations non decide diversamente
UPDATE articles SET visible_all = TRUE WHERE source = 'MOD252';

-- Feed del magazzino (ogni invio è una fotografia completa delle giacenze del fornitore)
CREATE TABLE IF NOT EXISTS warehouse_feeds (
  id          SERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT NOT NULL DEFAULT 'API' CHECK (source IN ('API','IMPORT','MANUALE')),
  items       INT NOT NULL DEFAULT 0,
  new_articles INT NOT NULL DEFAULT 0,
  errors      JSONB
);
CREATE TABLE IF NOT EXISTS warehouse_stock (
  id          SERIAL PRIMARY KEY,
  feed_id     INT NOT NULL REFERENCES warehouse_feeds(id) ON DELETE CASCADE,
  article_id  INT NOT NULL REFERENCES articles(id),
  silva_code  TEXT NOT NULL,
  description TEXT,
  lot         TEXT,
  expiry      DATE,
  qty         NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit        TEXT,
  barcode     TEXT,
  current     BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS warehouse_stock_current_idx ON warehouse_stock (article_id) WHERE current;

-- Stati dell'ordine per fase: 3 in attesa del magazzino (APPROVATO), presa in carico, spedito, consegnato (4), immagazzinato (5), chiuso
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
UPDATE orders SET status = 'PRESO_IN_CARICO' WHERE status = 'TRASMESSO';
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('BOZZA','INVIATO','APPROVATO','PRESO_IN_CARICO','SPEDITO','CONSEGNATO','IMMAGAZZINATO','CHIUSO','ANNULLATO'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_at TIMESTAMPTZ;      -- presa in carico dal magazzino
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ddt_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stored_at TIMESTAMPTZ;      -- carico nel magazzino interno completato
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stored_by INT REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS polled_at TIMESTAMPTZ;      -- ultima lettura da parte del fornitore
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS qty_delivered INT;

-- Fase 7: righe fuori elenco nella giacenza mensile
CREATE TABLE IF NOT EXISTS stock_count_extras (
  id        SERIAL PRIMARY KEY,
  count_id  INT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  article_id INT REFERENCES articles(id),      -- articolo a catalogo non presente nell'elenco della struttura
  name      TEXT,                               -- oppure descrizione libera
  qty       INT NOT NULL DEFAULT 0,
  note      TEXT
);

-- StudioLab: catalogo esami sincronizzato da ServiceNET ed eventi HL7 ricevuti (produzione in tempo reale)
CREATE TABLE IF NOT EXISTS exam_catalog (
  code          TEXT PRIMARY KEY,
  description   TEXT,
  material_code TEXT,
  material_desc TEXT,
  sector        TEXT,
  is_service    BOOLEAN,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studiolab_events (
  id              SERIAL PRIMARY KEY,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  msg_control_id  TEXT,
  msg_type        TEXT,
  acceptance_id   TEXT,
  exam_placer_id  TEXT,
  client_code     TEXT,
  exam_code       TEXT,
  order_control   TEXT,
  order_status    TEXT,
  acc_date        DATE,
  counted         INT NOT NULL DEFAULT 0,       -- +1 esame conteggiato, -1 annullato, 0 ignorato
  UNIQUE (acceptance_id, exam_placer_id, order_control, order_status)
);
CREATE INDEX IF NOT EXISTS studiolab_events_client_idx ON studiolab_events (client_code, acc_date);

INSERT INTO app_settings (key, value) VALUES ('silva_mode', 'PULL') ON CONFLICT (key) DO NOTHING;
