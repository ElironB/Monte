import { Suspense, lazy } from 'react';
import { Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import {
  Activity,
  BrainCircuit,
  Database,
  Gauge,
  Microscope,
  PlayCircle,
  Sparkles,
} from 'lucide-react';

const OverviewPage = lazy(async () => ({ default: (await import('./pages/OverviewPage')).OverviewPage }));
const PersonaPage = lazy(async () => ({ default: (await import('./pages/PersonaPage')).PersonaPage }));
const SimulationsPage = lazy(async () => ({ default: (await import('./pages/SimulationsPage')).SimulationsPage }));
const LiveRunsPage = lazy(async () => ({ default: (await import('./pages/LiveRunsPage')).LiveRunsPage }));
const ResultsPage = lazy(async () => ({ default: (await import('./pages/ResultsPage')).ResultsPage }));
const EvidencePage = lazy(async () => ({ default: (await import('./pages/EvidencePage')).EvidencePage }));
const SourcesPage = lazy(async () => ({ default: (await import('./pages/SourcesPage')).SourcesPage }));

type NavigationItem = {
  to: string;
  label: string;
  icon: typeof Sparkles;
  caption: string;
};

const navigationItems: NavigationItem[] = [
  { to: '/', label: 'Overview', icon: Sparkles, caption: 'Monte in one glance' },
  { to: '/persona', label: 'Persona', icon: BrainCircuit, caption: 'Dimensions and psychology' },
  { to: '/simulations', label: 'Simulations', icon: PlayCircle, caption: 'Run and review scenarios' },
  { to: '/live', label: 'Live Run', icon: Activity, caption: 'Track phase-aware execution' },
  { to: '/results', label: 'Results', icon: Gauge, caption: 'Outcomes, telemetry, and narrative' },
  { to: '/evidence', label: 'Evidence', icon: Microscope, caption: 'Record signals and rerun' },
  { to: '/sources', label: 'Sources', icon: Database, caption: 'Observations and signal inventory' },
];

function AppShell() {
  const location = useLocation();
  const activeItem = navigationItems.find((item) => item.to === location.pathname) ?? navigationItems[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__glow sidebar__glow--top" />
        <div className="sidebar__glow sidebar__glow--bottom" />

        <div className="brand-card">
          <span className="brand-card__eyebrow">MONTE UI</span>
          <h1>Decision Lab</h1>
          <p>Show the persona, simulation engine, and telemetry without asking anyone to watch a CLI recording.</p>
        </div>

        <nav className="sidebar__nav" aria-label="Primary">
          {navigationItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.to}
                className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
                to={item.to}
                end={item.to === '/'}
              >
                <span className="nav-item__icon">
                  <Icon size={18} />
                </span>
                <span className="nav-item__copy">
                  <span className="nav-item__label">{item.label}</span>
                  <span className="nav-item__caption">{item.caption}</span>
                </span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__footer-label">Runtime</div>
          <div className="status-line">
            <span className="status-dot status-dot--live" />
            Fastify API on :3000
          </div>
          <div className="status-line">
            <span className="status-dot status-dot--warm" />
            React dashboard on :3001
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="page-header">
          <div>
            <p className="page-header__eyebrow">{activeItem.label}</p>
            <h2>{activeItem.caption}</h2>
          </div>
          <div className="page-header__actions">
            <Link className="ghost-button" to="/simulations">
              New simulation
            </Link>
            <Link className="ghost-button ghost-button--filled" to="/results">
              Open latest results
            </Link>
          </div>
        </header>

        <Suspense fallback={<div className="loading-panel"><span className="loading-panel__dot" />Loading dashboard view...</div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="/persona" element={<PersonaPage />} />
        <Route path="/simulations" element={<SimulationsPage />} />
        <Route path="/live" element={<LiveRunsPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/evidence" element={<EvidencePage />} />
        <Route path="/sources" element={<SourcesPage />} />
      </Route>
    </Routes>
  );
}

export default App;
