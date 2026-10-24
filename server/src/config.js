// Configurazione da variabili d'ambiente
const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, ''),   // senza barra finale: il redirect URI verso Entra deve coincidere esattamente
  databaseUrl: env.DATABASE_URL || 'postgres://postgres@localhost:5432/orders',
  sessionSecret: env.SESSION_SECRET || 'dev-only-change-me',
  secureCookies: env.NODE_ENV === 'production',
  sessionHours: Number(env.SESSION_HOURS || 10),
  requireTotpForAdmins: (env.REQUIRE_TOTP_FOR_ADMINS || 'true') === 'true',
  entra: {
    tenantId: env.ENTRA_TENANT_ID || '',
    clientId: env.ENTRA_CLIENT_ID || '',
    clientSecret: env.ENTRA_CLIENT_SECRET || '',
    get enabled() { return Boolean(this.tenantId && this.clientId && this.clientSecret); },
  },
  // Integrazione StudioLab ServiceNET (CB Sistemi): REST con header X-API-KEY (catalogo esami, materiali, whoami) e
  // ricezione HL7 over HTTPS (notifiche di accettazione, da cui si ricava la produzione per cliente)
  studiolab: {
    baseUrl: (env.STUDIOLAB_API_URL || 'https://servicenet.toscanadiagnostica.it/API').trim().replace(/\/+$/, ''),
    apiKey: env.STUDIOLAB_API_KEY || '',             // chiave fornita da CB Sistemi: solo nel pannello Render
    clientCode: env.STUDIOLAB_CLIENT_CODE || 'TD',   // CodiceCliente da passare alle chiamate
    inboundKey: env.STUDIOLAB_INBOUND_KEY || '',     // chiave che StudioLab usa per inviarci i messaggi HL7
    get enabled() { return Boolean(this.apiKey); },
  },
  // Integrazione Silva Group (gestore del magazzino): il fornitore interroga le nostre API ogni 5 minuti con la chiave
  // SILVA_INBOUND_KEY (feed giacenze in ingresso, ordini da preparare in uscita, avanzamento consegne). EMAIL: ripiego.
  silva: {
    inboundKey: env.SILVA_INBOUND_KEY || '',
    email: env.SILVA_ORDER_EMAIL || '',
    customerCode: env.SILVA_CUSTOMER_CODE || 'TOSCANA-DIAGNOSTICA',
  },
  seed: {
    superadminEmail: env.SEED_SUPERADMIN_EMAIL || '',
    superadminName: env.SEED_SUPERADMIN_NAME || 'Super Amministratore',
    superadminPassword: env.SEED_SUPERADMIN_PASSWORD || '',
  },
  appName: 'Toscana Diagnostica · Orders Management',
};

if (env.NODE_ENV === 'production' && config.sessionSecret === 'dev-only-change-me') {
  throw new Error('SESSION_SECRET obbligatorio in produzione');
}
