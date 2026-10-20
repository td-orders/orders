import React, { useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { ToastProvider, Icon, Loading, useApi, BusyBar } from './components/ui.jsx';
import { ROLE } from './format.js';
import Login from './pages/Login.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Catalog from './pages/Catalog.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
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
  const toVerify = useApi(ops ? '/orders?status=INVIATO' : null, [loc.pathname]);
  const toReceive = useApi(!ops ? '/orders?status=TRASMESSO' : null, [loc.pathname]);
  const issues = useApi(ops ? '/stock/issues?status=APERTA' : null, [loc.pathname]);
  const L = ({ to, icon, children, count, end }) => (
    <NavLink to={to} end={end}><Icon name={icon} />{children}{count ? <span className="count">{count}</span> : null}</NavLink>
  );
  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand"><img src="/logo-light.svg" alt="Toscana Diagnostica" /><div className="app">Orders Management</div></div>
        <nav>
          <L to="/" icon="home" end>Cruscotto</L>
          {!ops && <>
            <div className="group">{kind === 'CLIENTE' ? 'Ordini' : 'Materiale'}</div>
            {kind === 'CLIENTE' && <L to="/catalogo" icon="cart">Nuovo ordine</L>}
            <L to="/ordini" icon="clipboard" count={toReceive.data?.length}>I miei ordini</L>
            <L to="/giacenza" icon="layers">Giacenza e messa in uso</L>
            {kind !== 'CLIENTE' && <L to="/giacenze" icon="check">Giacenza mensile</L>}
            {kind !== 'LAB' && <L to="/produzione" icon="chart">Produzione</L>}
            <L to="/difformita" icon="alert">Difformità</L>
          </>}
          {ops && <>
            <div className="group">Area Operations</div>
            <L to="/verifica" icon="check" count={toVerify.data?.length}>Ordini da verificare</L>
            <L to="/ordini" icon="clipboard">Tutti gli ordini</L>
            <L to="/catalogo" icon="cart">Nuovo ordine per una struttura</L>
            <L to="/difformita" icon="alert" count={issues.data?.length}>Difformità</L>
            <div className="group">Scorte e produzione</div>
            <L to="/rete" icon="layers">Scorte della rete</L>
            <L to="/giacenze" icon="list">Giacenze mensili</L>
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
          <Route path="/catalogo" element={(ops || kind === 'CLIENTE') ? <Catalog /> : <Navigate to="/" replace />} />
          <Route path="/ordini" element={<Orders />} />
          {ops && <Route path="/verifica" element={<Orders verify />} />}
          <Route path="/ordini/:id" element={<OrderDetail />} />
          <Route path="/giacenza" element={<Stock />} />
          <Route path="/giacenze" element={<StockCounts />} />
          <Route path="/giacenze/:id" element={<StockCount />} />
          <Route path="/produzione" element={<Production />} />
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
