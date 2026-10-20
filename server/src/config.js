// Configurazione da variabili d'ambiente
const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || 'http://localhost:3000',
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
  // Integrazione StudioLab (gestionale di laboratorio): credenziali clienti e produzione mensile
  studiolab: {
    mode: env.STUDIOLAB_MODE || 'SIMULATO',      // SIMULATO | API
    baseUrl: env.STUDIOLAB_API_URL || '',
    apiKey: env.STUDIOLAB_API_KEY || '',
  },
  // Integrazione Silva PortaleOrdini (fornitore esterno che gestisce il magazzino)
  silva: {
    mode: env.SILVA_MODE || 'SIMULATO',          // SIMULATO | API | EMAIL
    baseUrl: env.SILVA_API_URL || 'https://silva.cloud/PortaleOrdini',
    apiKey: env.SILVA_API_KEY || '',
    email: env.SILVA_ORDER_EMAIL || '',
    customerCode: env.SILVA_CUSTOMER_CODE || '',
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
