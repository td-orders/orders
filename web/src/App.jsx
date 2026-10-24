import React, { useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { ToastProvider, Icon, Loading, useApi, BusyBar } from './components/ui.jsx';
import { ROLE } from './format.js';
import Login from './pages/Login.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Warehouse from './pages/Warehouse.jsx';
import Catalog from './pages/Catalog.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Supplier from './pages/Supplier.jsx';
import Deliveries from './pages/Deliveries.jsx';
import LoadingPage from './pages/Loading.jsx';
import Unload from './pages/Unload.jsx';
import Stock from './pages/Stock.jsx';
import StockCount from './pages/StockCount.jsx';
import StockCounts from './pages/StockCounts.jsx';
import Production from './pages/Production.jsx';
import Issues from './pages/Issues.jsx';
import NetworkStock from './pages/NetworkStock.jsx';
import Strutture from './pages/Strutture.jsx';
import Users from './pages/Users.jsx';
import Articles from './pages/Articles.jsx';
import Mappings from './pages/Mappings.jsx';
import Settings from './pages/Settings.jsx';
import Audit from './pages/Audit.jsx';
import EmailLog from './pages/EmailLog.jsx';
import Profile from './pages/Profile.jsx';

const isOps = (u) => ['SUPERADMIN', 'PROCUREMENT'].includes(u?.role);

function Shell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  React.useEffect(() => setOpen(false), [loc.pathname]);
  const ops = isOps(user);
  const sup = user.role === 'SUPERADMIN';
  const kind = user.struttura_kind;
  const td = !ops && kind !== 'CLIENTE';
  const counts = useApi(ops ? '/orders?status=INVIATO,APPROVATO,PRESO_IN_CARICO,SPEDITO,CONSEGNATO' : '/orders?status=CONSEGNATO,SPEDITO', [loc.pathname]);
  const n = (...st) => (counts.data || []).filter((o) => st.includes(o.status)).length;
  const issues = useApi(ops ? '/stock/issues?status=APERTA' : null, [loc.pathname]);
  const L = ({ to, icon, children, count, end, phase }) => (
    <NavLink to={to} end={end}>{phase != null ? <span className="ph">{phase}</span> : <Icon name={icon} />}{children}{count ? <span className="count">{count}</span> : null}</NavLink>
  );
  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand"><img src="/logo-light.svg" alt="Toscana Diagnostica" /><div className="app">Orders Management</div></div>
        <nav>
          <L to="/" icon="home" end>Cruscotto</L>
          {ops && <>
            <div className="group">Flusso ordini</div>
            <L to="/magazzino" phase="0">Magazzino Silva</L>
            <L to="/catalogo" phase="1">Nuovo ordine per una struttura</L>
            <L to="/verifica" phase="2" count={n('INVIATO')}>Verifica richieste</L>
            <L to="/fornitore" phase="3" count={n('APPROVATO', 'PRESO_IN_CARICO')}>Trasmissione al magazzino</L>
            <L to="/consegne" phase="4" count={n('SPEDITO', 'CONSEGNATO')}>Consegne</L>
            <L to="/ordini" icon="clipboard">Archivio ordini</L>
            <L to="/difformita" icon="alert" count={issues.data?.length}>Difformità</L>
            <div className="group">Scorte e produzione</div>
            <L to="/rete" icon="layers">Scorte della rete</L>
            <L to="/giacenze" phase="7">Giacenze mensili</L>
            <L to="/giacenza" icon="box">Giacenza per struttura</L>
            <L to="/produzione" icon="chart">Produzione StudioLab</L>
            <L to="/correlazioni" icon="link">Correlazione esami e materiali</L>
            <div className="group">Anagrafiche</div>
            <L to="/strutture" icon="building">Strutture</L>
            <L to="/utenti" icon="users">Utenti</L>
            <L to="/articoli" icon="flask">Catalogo articoli</L>
            <L to="/invii" icon="mail">Registro invii</L>
            <L to="/audit" icon="shield">Registro attività</L>
            {sup && <L to="/impostazioni" icon="gear">Impostazioni</L>}
          </>}
          {!ops && kind === 'CLIENTE' && <>
            <div className="group">Ordini</div>
            <L to="/catalogo" phase="1">Nuovo ordine</L>
            <L to="/ordini" icon="clipboard" count={n('SPEDITO')}>I miei ordini</L>
            <L to="/giacenza" icon="layers">Materiale ricevuto</L>
            <L to="/difformita" icon="alert">Difformità</L>
          </>}
          {td && <>
            <div className="group">Flusso materiale</div>
            {kind === 'SEDE' && <L to="/ordini" icon="clipboard">Ordini della sede</L>}
            {kind === 'LAB' && <L to="/ordini" icon="clipboard">Ordini del laboratorio</L>}
            <L to="/carico" phase="5" count={n('CONSEGNATO')}>Carico magazzino</L>
            <L to="/scarico" phase="6">Scarico materiale</L>
            <L to="/giacenze" phase="7">Giacenza mensile</L>
            <L to="/giacenza" icon="layers">Giacenza attuale</L>
            <L to="/produzione" icon="chart">Produzione</L>
            <L to="/difformita" icon="alert">Difformità</L>
          </>}
        </nav>
        <div className="me">
          <div className="name">{user.full_name}</div>
          <div>{ROLE[user.role]}{user.struttura_name ? ` · ${user.struttura_name}` : ''}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <NavLink to="/profilo" className="btn sm ghost" style={{ color: 'var(--teal)' }}>Profilo</NavLink>
            <button className="btn sm dark" onClick={logout}>Esci</button>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar"><button onClick={() => setOpen(!open)} aria-label="Menu">☰</button><img src="/logo-light.svg" alt="" /></div>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {ops && <Route path="/magazzino" element={<Warehouse />} />}
          <Route path="/catalogo" element={(ops || kind === 'CLIENTE') ? <Catalog /> : <Navigate to="/" replace />} />
          <Route path="/ordini" element={<Orders />} />
          {ops && <Route path="/verifica" element={<Orders verify />} />}
          {ops && <Route path="/fornitore" element={<Supplier />} />}
          {ops && <Route path="/consegne" element={<Deliveries />} />}
          <Route path="/ordini/:id" element={<OrderDetail />} />
          {td && <Route path="/carico" element={<LoadingPage />} />}
          {td && <Route path="/carico/:id" element={<LoadingPage />} />}
          {td && <Route path="/scarico" element={<Unload />} />}
          <Route path="/giacenza" element={<Stock />} />
          {(ops || td) && <Route path="/giacenze" element={<StockCounts />} />}
          {(ops || td) && <Route path="/giacenze/:id" element={<StockCount />} />}
          {(ops || td) && <Route path="/produzione" element={<Production />} />}
          <Route path="/difformita" element={<Issues />} />
          {ops && <Route path="/rete" element={<NetworkStock />} />}
          {ops && <Route path="/correlazioni" element={<Mappings />} />}
          {ops && <Route path="/strutture" element={<Strutture />} />}
          {ops && <Route path="/utenti" element={<Users />} />}
          {ops && <Route path="/articoli" element={<Articles />} />}
          {ops && <Route path="/invii" element={<EmailLog />} />}
          {ops && <Route path="/audit" element={<Audit />} />}
          {sup && <Route path="/impostazioni" element={<Settings />} />}
          <Route path="/profilo" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Gate() {
  const { loading, user, onboarding } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  if (onboarding) return <Onboarding />;
  return <Shell />;
}

export default function App() {
  return (
    <ToastProvider>
      <BusyBar />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
