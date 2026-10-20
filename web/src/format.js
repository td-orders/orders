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
  APPROVATO: { label: 'Approvato', tone: 'teal' },
  TRASMESSO: { label: 'In consegna', tone: 'mauve' },
  CONSEGNATO: { label: 'Ricevuto', tone: 'green' },
  CHIUSO: { label: 'Chiuso', tone: 'grey' },
  ANNULLATO: { label: 'Annullato', tone: 'red' },
};
export const STATUS_LONG = {
  BOZZA: 'Bozza, non ancora inviata', INVIATO: 'Inviato: in verifica all\'Area Operations', APPROVATO: 'Approvato, trasmissione al fornitore in corso', TRASMESSO: 'Trasmesso al magazzino: in consegna',
  CONSEGNATO: 'Ricezione confermata dalla struttura', CHIUSO: 'Processo concluso', ANNULLATO: 'Annullato',
};
export const STEPS = ['BOZZA', 'INVIATO', 'APPROVATO', 'TRASMESSO', 'CONSEGNATO', 'CHIUSO'];
export const STEP_LABEL = { BOZZA: 'Carrello', INVIATO: 'Inviato', APPROVATO: 'Approvato', TRASMESSO: 'In consegna', CONSEGNATO: 'Ricevuto', CHIUSO: 'Chiuso' };
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
export const PKG_STATUS = { ATTESO: { label: 'Da ricevere', tone: 'grey' }, RICEVUTO: { label: 'In giacenza', tone: 'green' }, IN_USO: { label: 'In uso', tone: 'blue' }, NON_RICEVUTO: { label: 'Non ricevuto', tone: 'red' }, RETTIFICATO: { label: 'Rettificato', tone: 'mauve' } };
export const ISSUE_KIND = { MANCANTE: 'Materiale mancante', DANNEGGIATO: 'Materiale danneggiato', ERRATO: 'Articolo errato', ALTRO: 'Altro' };
export const PROVIDER = { LOCAL: 'Email e password', ENTRA: 'Solo Microsoft 365', BOTH: 'Microsoft 365 o password', STUDIOLAB: 'Credenziali StudioLab' };
