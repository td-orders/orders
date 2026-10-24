const numFmt = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' });
export const num = (n) => numFmt.format(Number(n || 0));
export const dec = (n, d = 1) => (n == null ? '–' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export const pct = (n) => (n == null ? '–' : `${Number(n) > 0 ? '+' : ''}${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%`);
export const itDate = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
export const currentMonth = () => today().slice(0, 7);
export const monthLabel = (m) => { if (!m) return ''; const [y, mm] = String(m).slice(0, 7).split('-'); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }); };

export const STATUS = {
  BOZZA: { label: 'Bozza', tone: 'grey' },
  INVIATO: { label: 'In verifica', tone: 'blue' },
  APPROVATO: { label: 'In attesa del magazzino', tone: 'teal' },
  PRESO_IN_CARICO: { label: 'In preparazione', tone: 'mauve' },
  SPEDITO: { label: 'Spedito', tone: 'mauve' },
  CONSEGNATO: { label: 'Consegnato', tone: 'green' },
  IMMAGAZZINATO: { label: 'Caricato', tone: 'green' },
  CHIUSO: { label: 'Chiuso', tone: 'grey' },
  ANNULLATO: { label: 'Annullato', tone: 'red' },
};
export const STATUS_LONG = {
  BOZZA: 'Bozza, non ancora inviata', INVIATO: 'Fase 2: in verifica all\'Area Operations', APPROVATO: 'Fase 3: approvato, in attesa che il magazzino lo prenda in carico',
  PRESO_IN_CARICO: 'Fase 3: preso in carico dal magazzino, in preparazione', SPEDITO: 'Fase 4: spedito, in consegna', CONSEGNATO: 'Fase 4: consegnato; fase 5 da fare (carico nel magazzino interno)',
  IMMAGAZZINATO: 'Fase 5: caricato nel magazzino interno', CHIUSO: 'Processo concluso', ANNULLATO: 'Annullato',
};
// Fasi del flusso: numero, etichetta, stati che vi appartengono
export const PHASES = [
  { n: 1, key: 'ordine', label: 'Ordine', statuses: ['BOZZA'] },
  { n: 2, key: 'verifica', label: 'Verifica TD', statuses: ['INVIATO'] },
  { n: 3, key: 'magazzino', label: 'Al magazzino', statuses: ['APPROVATO', 'PRESO_IN_CARICO'] },
  { n: 4, key: 'consegna', label: 'Consegna', statuses: ['SPEDITO', 'CONSEGNATO'] },
  { n: 5, key: 'carico', label: 'Carico interno', statuses: ['IMMAGAZZINATO'], tdOnly: true },
  { n: 9, key: 'chiuso', label: 'Chiuso', statuses: ['CHIUSO'] },
];
export const phaseOf = (status) => PHASES.find((p) => p.statuses.includes(status)) || null;
export const KIND = { CLIENTE: 'Cliente Service', SEDE: 'Sede del network', LAB: 'Laboratorio TD' };
export const ORIGIN = { CLIENTE: 'Richiesta del cliente', SISTEMA: 'Generato dalla giacenza', OPERATIONS: 'Area Operations' };
export const ROLE = { SUPERADMIN: 'Super amministratore', PROCUREMENT: 'Area Operations (Procurement)', CLIENTE: 'Cliente', SEDE: 'Sede TD', LAB: 'Laboratorio TD' };
export const ROLE_HELP = {
  SUPERADMIN: 'Crea strutture, utenti e catalogo; vede e fa tutto.',
  PROCUREMENT: 'Area Operations Management: verifica e approva gli ordini, li trasmette al fornitore, controlla giacenze e difformità, gestisce produzione e correlazioni.',
  CLIENTE: 'Cliente Service: ordina dal catalogo, conferma la ricezione, consulta il proprio archivio.',
  SEDE: 'Struttura del network: giacenza mensile entro il 15, ricezione e messa in uso del materiale.',
  LAB: 'Laboratorio di analisi TD: giacenza mensile entro il 30, ricezione e messa in uso; l\'ordine lo compila l\'Area Operations.',
};
export const PKG_STATUS = { ATTESO: { label: 'Da caricare', tone: 'grey' }, RICEVUTO: { label: 'In giacenza', tone: 'green' }, IN_USO: { label: 'In uso', tone: 'blue' }, NON_RICEVUTO: { label: 'Non ricevuto', tone: 'red' }, RETTIFICATO: { label: 'Rettificato', tone: 'mauve' } };
export const ISSUE_KIND = { MANCANTE: 'Materiale mancante', DANNEGGIATO: 'Materiale danneggiato', ERRATO: 'Articolo errato', ALTRO: 'Altro' };
export const PROVIDER = { LOCAL: 'Email e password', ENTRA: 'Solo Microsoft 365', BOTH: 'Microsoft 365 o password', STUDIOLAB: 'Credenziali StudioLab' };
