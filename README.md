# Toscana Diagnostica · Orders Management

Webapp per la gestione, il controllo e la trasmissione degli ordini di materiale di consumo, la verifica delle giacenze e la conferma di utilizzo del materiale. Destinata a orders.toscanadiagnostica.it (GitHub + Render). Stessa base tecnica e stessa grafica di Cash Management e Shipments.

## Cosa fa

Tre profili di struttura e un'Area Operations che governa tutta la filiera.

Cliente Service (profilo Cliente). Accede con le credenziali generate dall'app (o con quelle StudioLab, quando l'API sarà collegata). Ordina dal catalogo a carrello: l'elenco chiuso del modulo TD-SGI-MOD252 sezione B (48 articoli in 9 categorie), con la grafica dell'oggetto e il confezionamento. Approva e invia. L'Area Operations verifica ogni riga contro la produzione media mensile del cliente (esami StudioLab correlati ai materiali: 140 emocromi al mese = 140 provette tappo viola = 1,4 confezioni da 100), vede la distanza percentuale tra richiesta e produzione, corregge solo le quantità difformi nella colonna Approvato (precompilata con la richiesta), approva e trasmette al fornitore del magazzino (Silva PortaleOrdini). Alla consegna il cliente conferma la ricezione confezione per confezione: una riga per ogni confezione, lettura del codice a barre (lettore USB/Bluetooth o fotocamera) o spunta, Seleziona tutto, Conferma. Le confezioni non spuntate aprono in automatico una difformità all'Area Operations, che la gestisce e conclude il processo. Ogni cliente ha il proprio archivio degli ordini approvati.

Sede del network (profilo Sede TD). Entro il 15 di ogni mese inserisce la giacenza: prima colonna l'ultimo ordine (immodificabile), seconda la giacenza calcolata dagli scarichi (immodificabile), terza la giacenza effettiva, precompilata con la seconda e modificabile solo con numeri. Alla conferma le differenze vengono rettificate a sistema e nasce l'ordine potenziale del mese con la formula (produzione mensile − giacenza) × 1,5, senza decimali, arrotondata per eccesso, mai negativa, fattore modificabile per articolo. L'Area Operations lo verifica, corregge nella colonna accanto, approva e trasmette. La sede riceve con lo stesso meccanismo a righe per confezione. Ogni volta che mette in uso una confezione la scansiona o la spunta: esce la confezione con la scadenza più vicina (FEFO) e la giacenza scende. La giacenza è visibile alla sede e, a distanza, all'Area Operations.

Laboratorio di analisi TD (profilo Laboratorio TD). Come la sede ma senza controllo con la produzione: giacenza entro il 30 del mese; dalla conferma si apre una bozza d'ordine che l'Area Operations compila e approva direttamente.

Area Operations Management (profilo Procurement): cruscotto della filiera, ordini da verificare, scorte di tutta la rete, giacenze mensili mancanti, difformità, produzione StudioLab, correlazione esami e materiali, strutture, utenti, catalogo. Super amministratore: crea le strutture, ne completa l'anagrafica, definisce i referenti (dagli utenti), gestisce il catalogo e le impostazioni.

Tracciabilità: ogni confezione ha lotto e scadenza (letti dal codice GS1-128 quando presente, altrimenti inseriti a mano), coerente con ISO 15189:2022 §6.6. Ordine in PDF su carta intestata nel formato del MOD252 (sezioni A, B, D) con cronologia. Registro attività, registro invii, export Excel di ordini e giacenze.

Solleciti automatici via email (Microsoft Graph): promemoria 3 giorni prima della scadenza della giacenza e sollecito ogni 3 giorni dopo; ordini trasmessi senza conferma di ricezione dopo 5 giorni; riepilogo all'Area Operations degli ordini in attesa di verifica da oltre 2 giorni. Tutto parametrico in Impostazioni.

## Stati dell'ordine

BOZZA (carrello) → INVIATO (in verifica) → APPROVATO → TRASMESSO (in consegna) → CONSEGNATO (ricezione confermata) → CHIUSO (processo concluso). ANNULLATO con motivazione tracciata.

## Integrazioni esterne: cosa è reale e cosa è ipotizzato

StudioLab. Il contratto API non è documentato in questo progetto. L'adattatore `server/src/lib/studiolab.js` ipotizza due chiamate (verifica credenziali, produzione mensile per codice esame) da allineare alla documentazione del fornitore. Con STUDIOLAB_MODE=SIMULATO (default) la produzione si carica dalla pagina Produzione: import del file esportato dal gestionale (CSV o XLSX: codice struttura o codice StudioLab, mese AAAA-MM, codice esame, descrizione, quantità; modello scaricabile) oppure inserimento manuale. I clienti accedono con le credenziali generate dall'app. Con STUDIOLAB_MODE=API si attivano il pulsante "Sincronizza da StudioLab" e il login "Accedi con le credenziali StudioLab" (utente creato al primo accesso e collegato alla struttura con lo stesso codice StudioLab).

Silva PortaleOrdini. Tre modalità: SIMULATO (riferimento fittizio SIM-numero ordine, nessuna chiamata), EMAIL (ordine PDF su carta intestata alla casella SILVA_ORDER_EMAIL), API (POST con chiave API verso SILVA_API_URL, contratto ipotizzato in `server/src/lib/silva.js`). Il payload trasmesso resta archiviato sull'ordine. Se la trasmissione fallisce l'ordine resta APPROVATO e si ritrasmette con un pulsante.

Correlazione esame → materiale. Tabella gestita dall'app (pagina Correlazione esami e materiali): codice esame StudioLab, articolo, unità consumate per esame. Senza correlazioni la verifica con la produzione mostra "–".

Confezionamento. Le unità per confezione nel catalogo (provette 100, aghi 50, tamponi 50, Transbag 100, kit singoli, formalina 50/25/10) sono un'ipotesi da validare con l'Area Operations: si correggono dalla pagina Catalogo articoli. Il codice a barre GTIN del produttore, se inserito, consente la lettura in ricezione e in messa in uso.

## Architettura

- server/: Node.js 22, Express, PostgreSQL 16. API REST con sessioni su database, protezione CSRF, rate limit sul login, audit log. PDF con pdfkit, codici a barre Code128 con bwip-js, export con exceljs.
- web/: React 18, Vite, Recharts. Interfaccia in italiano, palette aziendale, responsive; lettura codici a barre con BarcodeDetector (fotocamera) o lettore esterno.
- Docker Compose: app, PostgreSQL, Caddy (HTTPS automatico), backup giornaliero del database in ./backup con ritenzione 30 giorni.

Profili: SUPERADMIN, PROCUREMENT (Area Operations), CLIENTE, SEDE, LAB. Accesso con Microsoft 365 (Entra ID) per il personale interno, email e password con verifica in due passaggi obbligatoria per super amministratore e Procurement, credenziali generate dall'app per clienti e strutture (invio via email con un clic), credenziali StudioLab per i clienti quando l'API è collegata.

## Pubblicazione su GitHub e Render

1. Repository GitHub `orders-management` (privato), caricare tutto il contenuto di questa cartella.
2. Render: New > Blueprint > collega il repository. Il file render.yaml crea il database (basic-256mb, Francoforte) e il servizio web (starter, Docker). Nel pannello inserire SEED_SUPERADMIN_PASSWORD (min 12 caratteri) e, quando pronte, ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET (stessa procedura di Cash Management: registrazione app in Entra con redirect https://orders.toscanadiagnostica.it/api/auth/entra/callback e l'URL temporaneo onrender, permesso applicativo Mail.Send per la casella GRAPH_SENDER).
3. Dominio: in Render aggiungere orders.toscanadiagnostica.it al servizio e creare il CNAME sul DNS verso l'host onrender indicato. Il certificato HTTPS è automatico; BASE_URL è già impostato sul dominio ufficiale e reindirizza gli altri host.
4. Primo accesso: super amministratore con la password seed, cambio password e attivazione 2FA. Poi: Strutture (clienti, sedi; il laboratorio TD è precaricato), Utenti (referenti), Catalogo articoli (validare il confezionamento), Correlazione esami e materiali, Produzione (import).
5. Integrazioni: SILVA_MODE e STUDIOLAB_MODE nel pannello Render, con le credenziali dei fornitori.

Aggiornamenti: push sul repository, Render ricostruisce. Le migrazioni si applicano da sole all'avvio.

## Prova in locale

Con Docker Desktop: `cp .env.example .env`, compilare, `docker compose up -d --build`, aprire http://localhost (DOMAIN=localhost in .env).

Senza Docker, con PostgreSQL locale: `cd web && npm ci && npm run build`, poi `cd ../server && npm ci && DATABASE_URL=postgres://... SEED_SUPERADMIN_EMAIL=... SEED_SUPERADMIN_PASSWORD=... WEB_DIR=../web/dist node src/index.js`.

## Test

`cd server && sh test/run-local.sh`: crea un database pulito, avvia un server di test sulla porta 3100 e lancia `test/e2e.test.js` (18 passi che coprono i tre processi: cliente, sede, laboratorio; verifica con produzione, approvazione e trasmissione simulata, ricezione per confezione con scansione GS1 e difformità, giacenza mensile con rettifiche e formula di riordino, messa in uso FEFO, annullamenti, cruscotti, export, solleciti, registri). Ogni modifica al codice passa da questa suite.
