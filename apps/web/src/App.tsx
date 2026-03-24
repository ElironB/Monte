import { Suspense, lazy } from "react";
import type { ElementType } from "react";
import {
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  ActivityLogIcon,
  ArchiveIcon,
  ArrowRightIcon,
  BarChartIcon,
  DashboardIcon,
  MixerHorizontalIcon,
  PersonIcon,
  RocketIcon,
} from "@radix-ui/react-icons";
import { LoadingPanel } from "./components/Ui";

const OverviewPage = lazy(async () => ({
  default: (await import("./pages/OverviewPage")).OverviewPage,
}));
const PersonaPage = lazy(async () => ({
  default: (await import("./pages/PersonaPage")).PersonaPage,
}));
const SimulationsPage = lazy(async () => ({
  default: (await import("./pages/SimulationsPage")).SimulationsPage,
}));
const LiveRunsPage = lazy(async () => ({
  default: (await import("./pages/LiveRunsPage")).LiveRunsPage,
}));
const ResultsPage = lazy(async () => ({
  default: (await import("./pages/ResultsPage")).ResultsPage,
}));
const EvidencePage = lazy(async () => ({
  default: (await import("./pages/EvidencePage")).EvidencePage,
}));
const SourcesPage = lazy(async () => ({
  default: (await import("./pages/SourcesPage")).SourcesPage,
}));

type NavigationItem = {
  to: string;
  label: string;
  index: string;
  icon: ElementType;
  eyebrow: string;
  caption: string;
  note: string;
};

const navigationItems: NavigationItem[] = [
  {
    to: "/",
    index: "01",
    label: "Overview",
    icon: DashboardIcon,
    eyebrow: "Control room",
    caption: "Recent runs, source health, and decision readiness.",
    note: "Use this page as the demo opener. It explains Monte quickly and shows whether the engine, persona, and intake layer are all alive.",
  },
  {
    to: "/persona",
    index: "02",
    label: "Persona",
    icon: PersonIcon,
    eyebrow: "Behavioral model",
    caption:
      "Nine dimensions, compressed psychology, and scenario sensitivity.",
    note: "The persona view should feel legible to a human reviewer, not just technically correct. This is where the model earns trust.",
  },
  {
    to: "/simulations",
    index: "03",
    label: "Simulations",
    icon: RocketIcon,
    eyebrow: "Run desk",
    caption: "Launch scenarios and review the queue without leaving the UI.",
    note: "Keep the creation flow plain and fast. The dashboard should remove friction, not hide the underlying mechanics.",
  },
  {
    to: "/live",
    index: "04",
    label: "Live Run",
    icon: ActivityLogIcon,
    eyebrow: "Execution stream",
    caption: "Phase-aware progress, frontier activity, and ETA.",
    note: "Monte already exposes richer progress than a spinner. This surface turns that into something a teammate can follow in real time.",
  },
  {
    to: "/results",
    index: "05",
    label: "Results",
    icon: BarChartIcon,
    eyebrow: "Outcome readout",
    caption: "Distributions, telemetry, narrative output, and rerun deltas.",
    note: "This is the payoff screen. The framing should feel analytical and calm, not flashy.",
  },
  {
    to: "/evidence",
    index: "06",
    label: "Evidence",
    icon: MixerHorizontalIcon,
    eyebrow: "Feedback loop",
    caption: "Capture observations, compare reruns, and watch the thesis move.",
    note: "The evidence loop is one of Monte’s strongest differentiators, so the form and audit trail need to read as credible workflow tooling.",
  },
  {
    to: "/sources",
    index: "07",
    label: "Sources",
    icon: ArchiveIcon,
    eyebrow: "Observation index",
    caption: "Inspect ingested sources and preview the extracted signals.",
    note: "This tab shows the raw material underneath the persona. It should feel like a neat archive, not a noisy log dump.",
  },
];

function AppShell() {
  const location = useLocation();
  const activeItem =
    navigationItems.find((item) =>
      item.to === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(item.to),
    ) ?? navigationItems[0];

  return (
    <div className="app-canvas">
      <div className="app-frame">
        <aside className="sidebar">
          <div className="sidebar__masthead">
            <div className="brand-lockup">
              <span className="brand-lockup__mark">M</span>
              <div>
                <p className="sidebar__eyebrow">Monte / Decision Lab</p>
                <h1>Monte</h1>
              </div>
            </div>
            <p className="sidebar__lede">
              Persona, simulations, telemetry, and evidence loops arranged like
              a working interface instead of a terminal recording.
            </p>
          </div>

          <section className="sidebar__section">
            <p className="sidebar__section-label">Navigation</p>
            <nav className="sidebar__nav" aria-label="Primary">
              {navigationItems.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink
                    key={item.to}
                    className={({ isActive }) =>
                      `nav-item${isActive ? " nav-item--active" : ""}`
                    }
                    to={item.to}
                    end={item.to === "/"}
                  >
                    <span className="nav-item__index">{item.index}</span>
                    <span className="nav-item__copy">
                      <span className="nav-item__label-row">
                        <span className="nav-item__label">{item.label}</span>
                        <Icon className="nav-item__icon" />
                      </span>
                      <span className="nav-item__caption">{item.caption}</span>
                    </span>
                  </NavLink>
                );
              })}
            </nav>
          </section>

          <section className="sidebar__section sidebar__section--muted">
            <p className="sidebar__section-label">Current section</p>
            <p className="sidebar__feature-title">
              {activeItem.index}. {activeItem.label}
            </p>
            <p className="sidebar__feature-copy">{activeItem.note}</p>
          </section>

          <section className="sidebar__section sidebar__section--muted">
            <p className="sidebar__section-label">Runtime</p>
            <div className="status-line">
              <span className="status-dot status-dot--live" />
              <span>Fastify API on :3000</span>
            </div>
            <div className="status-line">
              <span className="status-dot status-dot--warm" />
              <span>React dashboard on :3001</span>
            </div>
          </section>
        </aside>

        <main className="main-panel">
          <div className="window-bar">
            <div className="window-bar__chrome" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="window-bar__meta">
              <span>Local showcase build</span>
              <span>Fastify + React</span>
            </div>
          </div>

          <header className="page-header">
            <div className="page-header__lead">
              <p className="page-header__eyebrow">{activeItem.eyebrow}</p>
              <h2>{activeItem.label}</h2>
            </div>
            <p className="page-header__summary">{activeItem.caption}</p>
            <div className="page-header__actions">
              <Link className="ghost-button" to="/simulations">
                <span>New simulation</span>
                <ArrowRightIcon />
              </Link>
              <Link className="ghost-button ghost-button--filled" to="/results">
                <span>Latest results</span>
                <BarChartIcon />
              </Link>
            </div>
          </header>

          <Suspense
            fallback={
              <div className="loading-shell">
                <LoadingPanel label="Loading dashboard view..." />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
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
