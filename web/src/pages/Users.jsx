import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Field, Loading, ErrorBox, Empty, Badge, Modal, Card, Icon, useToast } from '../components/ui.jsx';
import { itDateTime, ROLE, ROLE_HELP, PROVIDER, KIND } from '../format.js';

const empty = { email: '', full_name: '', role: 'CLIENTE', struttura_id: '', auth_provider: 'LOCAL', studiolab_username: '', is_referente: false, active: true };
const NEEDS_STRUTTURA = ['CLIENTE', 'SEDE', 'LAB'];

export default function Users() {
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const toast = useToast();
  const { data, reload } = useApi('/users');
  const strutture = useApi('/strutture');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const [cred, setCred] = useState(null);
  const [roleF, setRoleF] = useState('');
  const save = async () => {
    setErr(null);
    const b = { ...edit, struttura_id: NEEDS_STRUTTURA.includes(edit.role) ? Number(edit.struttura_id) || null : null };
    ['id', 'struttura_name', 'struttura_kind', 'totp_enabled', 'must_change_password', 'last_login_at', 'locked_until'].forEach((k) => delete b[k]);
    try {
      const r = edit.id ? await api.put(`/users/${edit.id}`, b) : await api.post('/users', b);
      toast('Utente salvato'); setEdit(null); reload();
      if (r.temporaryPassword) setCred({ email: b.email, pwd: r.temporaryPassword });
    } catch (e) { setErr(e); }
  };
  const reset = async (u, what) => {
    const sendEmail = what === 'pwd' && !u.email.endsWith('@studiolab.local') && window.confirm(`Generare una nuova password temporanea per ${u.email}?\n\nOK: genera e invia anche via email alla casella dell'utente.\nAnnulla: interrompi.`);
    if (what === 'pwd' && !sendEmail) return;
    if (what === 'totp' && !window.confirm(`Azzerare la verifica in due passaggi di ${u.email}?`)) return;
    try {
      const r = await api.post(`/users/${u.id}/${what === 'pwd' ? 'reset-password' : 'reset-totp'}`, what === 'pwd' ? { sendEmail: true } : {});
      if (r.temporaryPassword) setCred({ email: u.email, pwd: r.temporaryPassword, mailed: r.mailed }); else toast('2FA azzerata'); reload();
    } catch (e) { setErr(e); }
  };
  const remove = async (u) => {
    if (!window.confirm(`Eliminare l'utente ${u.full_name} (${u.email})? L'operazione non si annulla. Se ha attività registrata verrà rifiutata: in quel caso disattivalo.`)) return;
    setErr(null);
    try { await api.del(`/users/${u.id}`); toast('Utente eliminato'); reload(); } catch (e) { setErr(e); }
  };
  const expectedKind = { CLIENTE: 'CLIENTE', SEDE: 'SEDE', LAB: 'LAB' }[edit?.role];
  const rows = (data || []).filter((u) => !roleF || u.role === roleF);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Utenti</h1><div className="sub">Personale interno con Microsoft 365, clienti e strutture con credenziali generate dall'app (o StudioLab per i clienti). I referenti di struttura sono gli utenti contrassegnati.</div></div>
        <div className="row"><Field label="Profilo"><select value={roleF} onChange={(e) => setRoleF(e.target.value)}><option value="">Tutti</option>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field><button className="btn" onClick={() => setEdit({ ...empty })}>+ Nuovo utente</button></div>
      </div>
      <ErrorBox error={err} />
      <Card flush>
        {!data ? <Loading /> : !rows.length ? <Empty>Nessun utente</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Nome</th><th>Email</th><th>Profilo</th><th>Struttura</th><th>Accesso</th><th>Ultimo accesso</th><th>Stato</th><th /></tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.id}>
                <td className="strong">{u.full_name}{u.is_referente && <> <Badge tone="teal">referente</Badge></>}</td>
                <td className="small">{u.email}{u.studiolab_username && <div className="muted">StudioLab: {u.studiolab_username}</div>}</td>
                <td>{ROLE[u.role]}</td>
                <td>{u.struttura_name ? <>{u.struttura_name}<div className="small muted">{KIND[u.struttura_kind]}</div></> : <span className="muted small">Toscana Diagnostica</span>}</td>
                <td className="small">{PROVIDER[u.auth_provider]}{!['ENTRA', 'STUDIOLAB'].includes(u.auth_provider) && <div>{u.totp_enabled ? <Badge tone="green">2FA attiva</Badge> : <Badge>2FA no</Badge>} {u.must_change_password && <Badge tone="mauve">password temporanea</Badge>}</div>}</td>
                <td className="small muted">{u.last_login_at ? itDateTime(u.last_login_at) : 'mai'}{u.locked_until && new Date(u.locked_until) > new Date() && <div className="red">bloccato</div>}</td>
                <td>{u.active ? <Badge tone="green">Attivo</Badge> : <Badge tone="red">Disattivo</Badge>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm ghost" onClick={() => setEdit({ ...empty, ...u, struttura_id: u.struttura_id || '' })}>Modifica</button>
                  {!['ENTRA', 'STUDIOLAB'].includes(u.auth_provider) && <>{' '}<button className="btn sm ghost" onClick={() => reset(u, 'pwd')}>Nuova password</button></>}
                  {sup && u.totp_enabled && <>{' '}<button className="btn sm ghost" onClick={() => reset(u, 'totp')}>Reset 2FA</button></>}
                  {u.id !== user.id && <>{' '}<button className="iconbtn" title="Elimina utente" aria-label="Elimina" onClick={() => remove(u)}><Icon name="trash" size={16} /></button></>}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      {edit && (
        <Modal title={edit.id ? `Modifica ${edit.full_name}` : 'Nuovo utente'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={!edit.email || !edit.full_name || (NEEDS_STRUTTURA.includes(edit.role) && !edit.struttura_id)} onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="form-grid">
            <Field label="Nome e cognome"><input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label="Email" help="Per l'accesso Microsoft deve coincidere con l'account Office 365"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Profilo"><select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value, struttura_id: '' })}>{sup && <option value="SUPERADMIN">Super amministratore</option>}<option value="PROCUREMENT">Area Operations (Procurement)</option><option value="CLIENTE">Cliente Service</option><option value="SEDE">Sede del network</option><option value="LAB">Laboratorio TD</option></select><span className="help">{ROLE_HELP[edit.role]}</span></Field>
            {NEEDS_STRUTTURA.includes(edit.role) && <Field label="Struttura"><select value={edit.struttura_id} onChange={(e) => setEdit({ ...edit, struttura_id: e.target.value })}><option value="">Scegli…</option>{(strutture.data || []).filter((s) => s.kind === expectedKind).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select></Field>}
            <Field label="Metodo di accesso"><select value={edit.auth_provider} onChange={(e) => setEdit({ ...edit, auth_provider: e.target.value })}>{Object.entries(PROVIDER).filter(([k]) => k !== 'STUDIOLAB' || edit.role === 'CLIENTE').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {edit.auth_provider === 'STUDIOLAB' && <Field label="Utente StudioLab"><input value={edit.studiolab_username || ''} onChange={(e) => setEdit({ ...edit, studiolab_username: e.target.value })} /></Field>}
          </div>
          {NEEDS_STRUTTURA.includes(edit.role) && <label className="f inline" style={{ marginTop: 12 }}><input type="checkbox" checked={!!edit.is_referente} onChange={(e) => setEdit({ ...edit, is_referente: e.target.checked })} />Referente della struttura</label>}
          {edit.id && <label className="f inline" style={{ marginTop: 8 }}><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Utente attivo</label>}
          {!edit.id && ['LOCAL', 'BOTH'].includes(edit.auth_provider) && <div className="small muted" style={{ marginTop: 12 }}>Alla creazione viene generata una password temporanea da consegnare all'utente, che la cambia al primo accesso.</div>}
        </Modal>
      )}
      {cred && (
        <Modal title="Credenziali di accesso" onClose={() => setCred(null)} footer={<button className="btn" onClick={() => setCred(null)}>Ho copiato la password</button>}>
          <p>Credenziali per <b>{cred.email}</b>{cred.mailed === 'INVIATA' ? ', inviate anche via email' : cred.mailed ? ` (invio email: ${cred.mailed})` : ''}. La password non sarà più visibile.</p>
          <div className="mono" style={{ fontSize: 22, padding: 14, background: 'var(--silk)', borderRadius: 10, textAlign: 'center', userSelect: 'all' }}>{cred.pwd}</div>
        </Modal>
      )}
    </div>
  );
}
