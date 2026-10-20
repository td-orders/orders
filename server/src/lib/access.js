import { one } from '../db.js';
import { config } from '../config.js';
import { forbidden, notFound, HttpError } from './util.js';

// Costruttore di parametri posizionali per query dinamiche
export class Params {
  constructor() { this.values = []; }
  add(v) { this.values.push(v); return `$${this.values.length}`; }
}

export async function loadUser(req, _res, next) {
  try {
    const id = req.session?.userId;
    if (id) {
      const u = await one(
        `SELECT u.id, u.email, u.full_name, u.role, u.struttura_id, u.auth_provider, u.must_change_password, u.totp_enabled, u.active, u.is_referente,
                s.name AS struttura_name, s.code AS struttura_code, s.kind AS struttura_kind, s.stock_deadline_day
           FROM users u LEFT JOIN strutture s ON s.id = u.struttura_id WHERE u.id = $1`, [id]);
      if (u && u.active) req.user = u; else req.session.userId = null;
    }
    next();
  } catch (e) { next(e); }
}

const ONBOARDING_PATHS = ['/api/auth/me', '/api/auth/logout', '/api/auth/change-password', '/api/auth/totp/setup', '/api/auth/totp/enable'];

export function onboardingState(req) {
  const u = req.user;
  if (!u) return null;
  const local = req.session.authMethod === 'LOCAL';
  if (local && u.must_change_password) return 'PASSWORD_CHANGE_REQUIRED';
  if (local && config.requireTotpForAdmins && ['SUPERADMIN', 'PROCUREMENT'].includes(u.role) && !u.totp_enabled) return 'TOTP_SETUP_REQUIRED';
  return null;
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessione scaduta o non autenticata'));
  const st = onboardingState(req);
  if (st && !ONBOARDING_PATHS.includes(req.originalUrl.split('?')[0])) {
    const e = new HttpError(403, st === 'PASSWORD_CHANGE_REQUIRED' ? 'Cambio password obbligatorio' : 'Attivazione verifica in due passaggi obbligatoria');
    e.code = st;
    return next(e);
  }
  next();
}

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));

export const isSuper = (u) => u?.role === 'SUPERADMIN';
// Area Operations Management (profilo Procurement) e super amministratore: vedono e gestiscono tutto
export const isOps = (u) => ['SUPERADMIN', 'PROCUREMENT'].includes(u?.role);
// Profili di struttura: operano solo sulla propria struttura
export const isStruttura = (u) => ['CLIENTE', 'SEDE', 'LAB'].includes(u?.role);
export const OPS_ROLES = ['SUPERADMIN', 'PROCUREMENT'];

// Clausola SQL che limita le strutture visibili (alias della tabella strutture o colonna struttura_id)
export function strutturaScope(user, P, col = 's.id') {
  if (isOps(user)) return 'TRUE';
  return `${col} = ${P.add(user.struttura_id)}`;
}

export async function assertStruttura(user, strutturaId) {
  const s = await one('SELECT * FROM strutture WHERE id=$1', [strutturaId]);
  if (!s) throw notFound('Struttura non trovata');
  if (!isOps(user) && s.id !== user.struttura_id) throw forbidden('Struttura non autorizzata');
  return s;
}
