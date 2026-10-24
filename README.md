# Toscana Diagnostica · Orders Management

Webapp per la gestione, il controllo e la trasmissione degli ordini di materiale di consumo, la verifica delle giacenze e la conferma di utilizzo del materiale. Destinata a orders.toscanadiagnostica.it (GitHub + Render). Stessa base tecnica e stessa grafica di Cash Management e Shipments.

## Cosa fa

Il flusso è diviso in otto fasi, ognuna con la propria pagina, il proprio stato e i propri attori. Nessuna fase avviene in aggiornamento sulla stessa pagina di un'altra: la barra laterale mostra il numero della fase e ogni pagina apre con la descrizione di cosa accade e qual è il passo successivo.

Fase 0, Magazzino Silva (Area Operations). Silva Group, gestore del magazzino, invia alle nostre API l'elenco degli articoli in magazzino con quantità, lotto e scadenza. L'Area Operations decide per ogni articolo chi lo vede nel catalogo: tutti, i punti prelievo e il laboratorio, i clienti Service. Le strutture vedono solo l'elenco degli articoli loro destinati, senza quantità, lotto e scadenza. Gli articoli del feed non presenti nel catalogo MOD252 nascono nascosti e si attivano da qui.

Fase 1, Ordine (struttura). Il cliente Service ordina dal catalogo a carrello e invia. La sede del network compila l'ordine generato dalla giacenza mensile (fase 7) o un ordine straordinario. Il laboratorio TD apre la bozza che l'Area Operations compila.

Fase 2, Verifica (Area Operations). Ogni riga è confrontata con la produzione media mensile della struttura (esami StudioLab correlati ai materiali: 140 emocromi al mese = 140 provette tappo viola = 1,4 confezioni da 100), con la distanza percentuale tra richiesta e produzione. L'Area Operations corregge solo le quantità difformi, approva o annulla. Il PDF dell'ordine resta archiviato.

Fase 3, Trasmissione al magazzino (API). Gli ordini approvati sono esposti sulle API che Silva interroga ogni cinque minuti: contenuto, sede di consegna, urgenza. Il fornitore comunica presa in carico, spedizione con DDT e consegna con confezioni, lotti, scadenze e codici a barre; in mancanza l'Area Operations registra gli stessi passaggi a mano.

Fase 4, Consegna. Alla consegna il cliente Service ha concluso: l'ordine si chiude e resta nel suo archivio. Per le strutture TD il flusso continua in una sezione separata.

Fase 5, Carico nel magazzino interno (strutture TD). Per ogni ordine consegnato la struttura legge il codice a barre di ogni confezione (lettore USB/Bluetooth, fotocamera o spunta): la confezione entra in giacenza con lotto e scadenza. Alla conferma le confezioni non lette sono segnalate come mancanti all'Area Operations con una difformità.

Fase 6, Scarico (strutture TD). Ogni volta che una confezione viene messa in uso la struttura la scansiona o la spunta: esce quella con la scadenza più vicina (FEFO) e la giacenza scende. Lo storico degli scarichi è visibile alla struttura e all'Area Operations.

Fase 7, Giacenza reale (strutture TD). Entro il 15 (sedi) o il 30 (laboratorio) la struttura inserisce la giacenza reale accanto a quella teorica calcolata dagli scarichi: le differenze vengono rettificate e si possono aggiungere articoli fuori elenco. Alla conferma nasce l'ordine del mese con la formula (produzione mensile − giacenza) × 1,5, arrotondata per eccesso a confezioni intere, mai negativa, fattore modificabile per articolo; il flusso riparte dalla fase 1.

Area Operations Management (profilo Procurement): cruscotto per fase, verifiche, trasmissione, consegne, scorte di tutta la rete, giacenze mensili mancanti, difformità, produzione StudioLab, correlazione esami e materiali, strutture, utenti, catalogo. Super amministratore: crea le strutture, definisce i referenti, gestisce il catalogo e le impostazioni.

Tracciabilità: ogni confezione ha lotto e scadenza (dal feed Silva, dal codice GS1-128 o inseriti a mano), coerente con ISO 15189:2022 §6.6. Ordine in PDF su carta intestata nel formato del MOD252 (sezioni A, B, D) con cronologia. Registro attività, registro invii, export Excel di ordini e giacenze.

Solleciti automatici via email (Microsoft Graph): promemoria 3 giorni prima della scadenza della giacenza e sollecito ogni 3 giorni dopo; ordini consegnati e non caricati dopo 5 giorni; riepilogo all'Area Operations degli ordini in attesa di verifica da oltre 2 giorni. Tutto parametrico in Impostazioni.

## Stati dell'ordine

BOZZA (fase 1) → INVIATO (fase 2, in verifica) → APPROVATO (fase 3, in attesa del magazzino, visibile alle API di Silva) → PRESO_IN_CARICO → SPEDITO → CONSEGNATO (fase 4) → per i clienti Service CHIUSO alla consegna; per le strutture TD IMMAGAZZINATO (fase 5, carico confermato) → CHIUSO. ANNULLATO con motivazione tracciata. Le confezioni hanno stati propri: ATTESO (consegnata, da caricare), RICEVUTO (in giacenza), IN_USO (scaricata), NON_RICEVUTO (mancante al carico, apre una difformità), RETTIFICATO (dalla giacenza mensile).

## Integrazioni esterne: contratti API

Le chiavi vanno solo nel pannello Render (Environment), mai nel repository. Tutte le chiamate dei fornitori usano l'header `X-API-KEY`; ogni richiesta è registrata in Impostazioni (ultimo feed, ultima lettura, ultimo messaggio HL7).

Silva Group (magazzino). Il contratto è definito da noi e va consegnato al fornitore con la chiave SILVA_INBOUND_KEY; gli schemi JSON sono in `server/src/routes/integrations.js`.

- `GET /api/integrations/silva/ping`: verifica della chiave.
- `POST /api/integrations/silva/stock` (fase 0): fotografia completa del magazzino, `{ "articoli": [ { "codiceArticolo", "descrizione", "quantita", "unita", "lotti": [ { "lotto", "scadenza": "AAAA-MM-GG", "quantita" } ], "gtin" } ] }`. Ogni invio sostituisce il precedente; gli articoli sono agganciati al catalogo tramite il codice articolo Silva (o il GTIN); quelli sconosciuti nascono nascosti.
- `GET /api/integrations/silva/orders` (fase 3, polling ogni 5 minuti): ordini in stato APPROVATO e PRESO_IN_CARICO con `numero`, `urgenza`, `motivoUrgenza`, `tipoDestinatario`, `destinazione` (nome, indirizzo, referente, telefono, orari), `righe` (codice, descrizione, confezioni, unità totali, codice Silva, GTIN) e `pdf`.
- `POST /api/integrations/silva/orders/:numero/presa-in-carico` `{ "riferimento" }`; `.../spedito` `{ "ddt", "data" }`; `.../consegnato` `{ "ddt", "righe": [ { "codiceArticolo", "confezioni", "lotto", "scadenza", "barcodes": [] } ] }`. Alla consegna nasce una riga per confezione con lotto, scadenza e codice, pronta per il carico (fase 5). Senza righe le confezioni sono create dalle quantità approvate.

In assenza di chiamate l'Area Operations registra presa in carico, spedizione e consegna dalla pagina Consegne. SILVA_ORDER_EMAIL è la casella a cui inviare il PDF dell'ordine all'approvazione come ripiego.

StudioLab ServiceNET (CB Sistemi). Due canali.

- REST in uscita, base `https://servicenet.toscanadiagnostica.it/API` (STUDIOLAB_API_URL), header `X-API-KEY` = STUDIOLAB_API_KEY, parametro `CodiceCliente` = STUDIOLAB_CLIENT_CODE (TD). Usato per `whoami` (prova di collegamento) e `esami` (sincronizzazione del catalogo esami, che alimenta la correlazione esami e materiali). Lo swagger pubblicato da ServiceNET non espone un endpoint di produzione per periodo: le API REST non bastano per la verifica delle fasi 2 e 7.
- HL7 in ingresso, `POST /api/integrations/studiolab/hl7` (corpo testuale, header `X-API-KEY` = STUDIOLAB_INBOUND_KEY, risposta ACK). StudioLab invia i messaggi di accettazione (OML^O21, ORM^O01) e le variazioni; ogni esame accettato incrementa la produzione del mese della struttura, ogni annullamento la decrementa; i messaggi sono idempotenti per accettazione ed esame. La struttura è individuata dal codice cliente del messaggio (ORC-13 o MSH-6), da confermare con CB Sistemi, abbinato al codice StudioLab dell'anagrafica Strutture. In alternativa la produzione si importa da file (CSV/XLSX, modello scaricabile) o si inserisce a mano.

Correlazione esame → materiale. Tabella gestita dall'app (pagina Correlazione esami e materiali): codice esame StudioLab, articolo, unità consumate per esame; circa 1.500 correlazioni precaricate dall'elenco esami fornito (codice esame, materiale). Senza correlazioni la verifica con la produzione mostra "–".

Confezionamento. Le unità per confezione nel catalogo (provette 100, aghi 50, tamponi 50, Transbag 100, kit singoli, formalina 50/25/10) sono un'ipotesi da validare con l'Area Operations: si correggono dalla pagina Catalogo articoli.

## Architettura

- server/: Node.js 22, Express, PostgreSQL 16. API REST con sessioni su database, protezione CSRF, rate limit sul login, audit log. PDF con pdfkit, codici a barre Code128 con bwip-js, export con exceljs.
- web/: React 18, Vite, Recharts. Interfaccia in italiano, palette aziendale, responsive; lettura codici a barre con BarcodeDetector (fotocamera) o lettore esterno.
- Docker Compose: app, PostgreSQL, Caddy (HTTPS automatico), backup giornaliero del database in ./backup con ritenzione 30 giorni.

Profili: SUPERADMIN, PROCUREMENT (Area Operations), CLIENTE, SEDE, LAB. Accesso con Microsoft 365 (Entra ID) per il personale interno, email e password con verifica in due passaggi obbligatoria per super amministratore e Procurement, credenziali generate dall'app per clienti e strutture (invio via email con un clic).

## Pubblicazione su GitHub e Render

1. Repository GitHub `orders-management` (privato), caricare tutto il contenuto di questa cartella.
2. Render: New > Blueprint > collega il repository. Il file render.yaml crea il database (basic-256mb, Francoforte) e il servizio web (starter, Docker). Nel pannello inserire SEED_SUPERADMIN_PASSWORD (min 12 caratteri) e, quando pronte, ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET (stessa procedura di Cash Management: registrazione app in Entra con redirect https://orders.toscanadiagnostica.it/api/auth/entra/callback e l'URL temporaneo onrender, permesso applicativo Mail.Send per la casella GRAPH_SENDER).
3. Dominio: in Render aggiungere orders.toscanadiagnostica.it al servizio e creare il CNAME sul DNS verso l'host onrender indicato. Il certificato HTTPS è automatico; BASE_URL è già impostato sul dominio ufficiale e reindirizza gli altri host.
4. Primo accesso: super amministratore con la password seed, cambio password e attivazione 2FA. Poi: Strutture (clienti, sedi; il laboratorio TD è precaricato), Utenti (referenti), Catalogo articoli (validare il confezionamento), Correlazione esami e materiali, Produzione (import).
5. Integrazioni nel pannello Render: SILVA_INBOUND_KEY (generata da noi, consegnata a Silva), STUDIOLAB_API_KEY (fornita da CB Sistemi), STUDIOLAB_INBOUND_KEY (generata da noi, consegnata a CB Sistemi con l'URL HL7), SILVA_ORDER_EMAIL opzionale. BASE_URL senza barra finale.

Aggiornamenti: push sul repository, Render ricostruisce. Le migrazioni si applicano da sole all'avvio.

## Prova in locale

Con Docker Desktop: `cp .env.example .env`, compilare, `docker compose up -d --build`, aprire http://localhost (DOMAIN=localhost in .env).

Senza Docker, con PostgreSQL locale: `cd web && npm ci && npm run build`, poi `cd ../server && npm ci && DATABASE_URL=postgres://... SEED_SUPERADMIN_EMAIL=... SEED_SUPERADMIN_PASSWORD=... WEB_DIR=../web/dist node src/index.js`.

## Test

`cd server && sh test/run-local.sh`: crea un database pulito, avvia un server di test sulla porta 3100 e lancia `test/e2e.test.js` (17 passi che coprono le otto fasi: feed Silva e visibilità, ordine del cliente, verifica con produzione, polling e avanzamento del fornitore, consegna con lotti e codici, carico con scansione e mancanti, scarico FEFO, giacenza mensile con rettifiche, articoli extra e formula di riordino, laboratorio, annullamenti, HL7 in ingresso, cruscotti, export, solleciti, registri). Ogni modifica al codice passa da questa suite.
