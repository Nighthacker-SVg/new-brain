import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowCounterClockwise, ArrowRight, ArrowSquareOut, Bell, CaretDown, CaretRight,
  ChartBar, Check, CheckCircle, Clock, Code, Cube, Database, DownloadSimple,
  FileText, FolderSimple, Gear, HouseLine, IconContext, List, MagnifyingGlass,
  PaintBrush, Pause, Play, Plus, Pulse, ShieldCheck, SquaresFour, UsersThree, X,
} from '@phosphor-icons/react';
import {
  initialAgents, initialEvents, initialProjects, initialReviews, stages,
  type Agent, type ActivityEvent, type Project, type Review, type Scope, type Stage,
} from './model';
import { createPreviewId } from './preview-id';

type View = 'Office' | 'Projects' | 'Agents' | 'Activity';
type Dialog = 'project' | 'artifact' | 'review' | null;
const asset = (name: string) => `${import.meta.env.BASE_URL}assets/${name}`;
const stageIcons = { Intake: FileText, Build: Code, Verify: Gear, Release: Cube };
const navigation = [
  { name: 'Office' as View, icon: HouseLine }, { name: 'Projects' as View, icon: FolderSimple },
  { name: 'Agents' as View, icon: UsersThree }, { name: 'Activity' as View, icon: ChartBar },
];

function Avatar({ agent, size = 'small' }: { agent: Agent; size?: 'small' | 'large' | 'tiny' }) {
  return <img className={`avatar avatar-${size}`} src={asset(agent.avatar)} alt="" />;
}

function Status({ agent }: { agent: Agent }) {
  const label = agent.status === 'working' ? 'Working' : agent.status === 'paused' ? 'Paused' : 'Waiting for data';
  const Icon = agent.status === 'working' ? Pulse : agent.status === 'paused' ? Pause : Clock;
  return <span className={`status status-${agent.status}`}><span className={`status-dot dot-${agent.status}`} />{label}<Icon size={17} aria-hidden="true" /></span>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current!;
    const background = document.querySelector<HTMLElement>('.app')!;
    const wasInert = background.inert;
    background.inert = true;
    const selectors = 'button:not([disabled]), input, select, textarea, a[href], [tabindex="0"]';
    (element.querySelector<HTMLInputElement>('input') ?? element.querySelector<HTMLElement>(selectors) ?? element).focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(element.querySelectorAll<HTMLElement>(selectors)).filter(item => !item.hidden);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      background.inert = wasInert;
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''}`}>
        <header className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X /></button></header>
        {children}
      </div>
    </div>, document.body,
  );
}

function ProjectForm({ agents, onClose, onSubmit }: { agents: Agent[]; onClose: () => void; onSubmit: (project: Project, team: string[]) => void }) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('client');
  const [brief, setBrief] = useState('');
  const [team, setTeam] = useState<string[]>(['maya', 'theo']);
  const [error, setError] = useState('');
  const create = () => {
    if (!name.trim() || !brief.trim()) { setError('Add a project name and brief.'); return; }
    if (!team.length) { setError('Choose at least one agent for this project.'); return; }
    onSubmit({ id: `project-${createPreviewId()}`, name: name.trim(), description: brief.trim(), brief: brief.trim(), scope, stage: 'Intake' }, team);
  };
  return <Modal title="Assign a new project" onClose={onClose} wide>
    <p className="modal-intro">Give your team a clear brief and a place to get started.</p>
    <form onSubmit={event => {
      event.preventDefault();
      create();
    }}>
      <label className="field">Project name<input value={name} onChange={event => setName(event.target.value)} required maxLength={70} placeholder="e.g. Meridian customer portal" /></label>
      <fieldset className="scope-options"><legend>Workspace</legend>
        <label><input type="radio" name="scope" value="client" checked={scope === 'client'} onChange={() => setScope('client')} /><FolderSimple /> Client project</label>
        <label><input type="radio" name="scope" value="product" checked={scope === 'product'} onChange={() => setScope('product')} /><Cube /> Own product</label>
      </fieldset>
      <label className="field">Project brief<textarea value={brief} onChange={event => setBrief(event.target.value)} required maxLength={2000} rows={3} placeholder="What should the team deliver? What does success look like?" /></label>
      <fieldset className="team-picker"><legend>Choose your team <span>{team.length} selected</span></legend>
        <p className="field-help">Selected agents will move to this project in the sample workspace.</p>
        <div className="team-grid">{agents.map(agent => <label className={team.includes(agent.id) ? 'team-option checked' : 'team-option'} key={agent.id}>
          <input type="checkbox" checked={team.includes(agent.id)} onChange={() => setTeam(old => old.includes(agent.id) ? old.filter(id => id !== agent.id) : [...old, agent.id])} />
          <Avatar agent={agent} /><span><strong>{agent.name}</strong><small>{agent.role}</small></span>
        </label>)}</div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit" onClick={event => {
        // This action only changes sample state; no native form submission is needed.
        event.preventDefault();
        if (event.currentTarget.form?.reportValidity()) create();
      }}><Plus /> Create project</button></footer>
    </form>
  </Modal>;
}

function Empty({ title, children, onClear }: { title: string; children?: ReactNode; onClear?: () => void }) {
  return <div className="empty-state"><MagnifyingGlass size={30} /><h3>{title}</h3><p>{children ?? 'Try another name, project, or task.'}</p>{onClear && <button className="button secondary" onClick={onClear}>Clear filters</button>}</div>;
}

export default function App() {
  const [agents, setAgents] = useState(initialAgents);
  const [resumeStatuses, setResumeStatuses] = useState<Record<string, 'working' | 'waiting'>>({});
  const [projects, setProjects] = useState(initialProjects);
  const [reviews, setReviews] = useState(initialReviews);
  const [events, setEvents] = useState(initialEvents);
  const [view, setView] = useState<View>('Office');
  const [scope, setScope] = useState<Scope | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<Stage | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('theo');
  const [officeMode, setOfficeMode] = useState<'office' | 'list'>(() => window.innerWidth < 900 ? 'list' : 'office');
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 900);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menu, setMenu] = useState<'workspace' | 'notifications' | 'profile' | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const closeDialog = useCallback(() => setDialog(null), []);

  const selectedAgent = agents.find(agent => agent.id === selectedId) ?? agents[1];
  const selectedProject = projects.find(project => project.id === selectedAgent.projectId)!;
  const activeReview = reviews.find(review => review.id === reviewId);
  const pendingReviews = reviews.filter(review => review.status === 'pending');
  const normalizedQuery = query.toLocaleLowerCase().trim();
  const visibleAgents = useMemo(() => agents.filter(agent => {
    const project = projects.find(item => item.id === agent.projectId)!;
    return (scope === 'all' || project.scope === scope)
      && (!projectFilter || agent.projectId === projectFilter)
      && (!stageFilter || agent.stage === stageFilter)
      && (!normalizedQuery || `${agent.name} ${agent.role} ${agent.task} ${agent.activityLabel} ${project.name}`.toLocaleLowerCase().includes(normalizedQuery));
  }), [agents, projects, scope, projectFilter, stageFilter, normalizedQuery]);
  const visibleIds = visibleAgents.map(agent => agent.id).join(',');
  useEffect(() => {
    if (view !== 'Office' && view !== 'Agents') return;
    if (visibleAgents.length && !visibleAgents.some(agent => agent.id === selectedId)) setSelectedId(visibleAgents[0].id);
  }, [visibleIds, selectedId, view]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(null); setSidebarOpen(false); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const addEvent = (agentId: string, projectId: string, label: string) => {
    const event: ActivityEvent = { id: createPreviewId(), agentId, projectId, label, time: 'Just now' };
    setEvents(old => [event, ...old]);
  };
  const clearFilters = () => { setQuery(''); setScope('all'); setProjectFilter(null); setStageFilter(null); };
  const navigate = (next: View) => { setView(next); setSidebarOpen(false); setStageFilter(null); setProjectFilter(null); };
  const selectAgent = (agent: Agent) => { setSelectedId(agent.id); setInspectorOpen(true); setMenu(null); };
  const selectScope = (next: Scope | 'all') => { setScope(next); setProjectFilter(null); setStageFilter(null); setMenu(null); setSidebarOpen(false); };
  const openReview = (review: Review) => { setReviewId(review.id); setDialog('review'); setMenu(null); };
  const togglePause = () => {
    const paused = selectedAgent.status === 'paused';
    if (!paused) setResumeStatuses(old => ({ ...old, [selectedId]: selectedAgent.status as 'working' | 'waiting' }));
    setAgents(old => old.map(agent => agent.id === selectedId ? { ...agent, status: paused ? (resumeStatuses[selectedId] ?? 'working') : 'paused' } : agent));
    addEvent(selectedId, selectedAgent.projectId, paused ? 'Resumed the sample task' : 'Paused the sample task');
    setToast(`${selectedAgent.name}’s sample task ${paused ? 'resumed' : 'paused'}.`);
  };
  const resolveReview = (status: 'approved' | 'declined') => {
    if (!activeReview) return;
    setReviews(old => old.map(review => review.id === activeReview.id ? { ...review, status } : review));
    addEvent(activeReview.agentId, activeReview.projectId, `${status === 'approved' ? 'Approved' : 'Declined'} the sample staging access request`);
    setDialog(null);
    setToast(`Sample request ${status}. No external permissions were changed.`);
  };
  const createProject = (project: Project, team: string[]) => {
    setProjects(old => [...old, project]);
    setAgents(old => old.map(agent => team.includes(agent.id) ? { ...agent, projectId: project.id, stage: 'Intake', status: 'working', task: `Review the brief for ${project.name}`, activityLabel: 'Reviewing project brief', artifact: { label: 'Project brief · New', kind: 'document' } } : agent));
    const assignments = team.map(agentId => ({ id: createPreviewId(), agentId, projectId: project.id, label: `Assigned to ${project.name}`, time: 'Just now' }));
    setEvents(old => [...assignments, ...old]);
    setDialog(null); setView('Projects'); setScope('all'); setQuery(''); setProjectFilter(null); setStageFilter(null); setSelectedId(team[0]); setInspectorOpen(true);
    setToast(`${project.name} added to the sample workspace.`);
  };
  const reset = () => {
    setAgents(initialAgents); setResumeStatuses({}); setProjects(initialProjects); setReviews(initialReviews); setEvents(initialEvents);
    clearFilters(); setSelectedId('theo'); setView('Office'); setMenu(null); setInspectorOpen(true);
    setToast('Sample workspace reset.');
  };
  const selectedEvents = events.filter(event => event.agentId === selectedId && event.projectId === selectedAgent.projectId).slice(0, 3);
  const visibleProjects = projects.filter(project => (scope === 'all' || scope === project.scope) && (!normalizedQuery || `${project.name} ${project.description}`.toLocaleLowerCase().includes(normalizedQuery)));
  const visibleEvents = events.filter(event => {
    const project = projects.find(item => item.id === event.projectId)!;
    const agent = agents.find(item => item.id === event.agentId)!;
    return (scope === 'all' || project.scope === scope) && (!normalizedQuery || `${agent.name} ${project.name} ${event.label}`.toLocaleLowerCase().includes(normalizedQuery));
  });

  const agentRows = () => <div className="agent-list" role="list">{visibleAgents.map(agent => {
    const project = projects.find(item => item.id === agent.projectId)!;
    return <div role="listitem" key={agent.id}><button className={`agent-row ${selectedId === agent.id ? 'selected' : ''}`} onClick={() => selectAgent(agent)} aria-label={`View ${agent.name}, ${agent.role}`}>
      <Avatar agent={agent} /><span className="agent-row-person"><strong>{agent.name}</strong><small>{agent.role}</small></span>
      <span className="agent-row-task"><strong>{agent.status === 'paused' ? 'Task paused' : agent.activityLabel}</strong><small>{project.name}</small></span>
      <Status agent={agent} /><CaretRight className="row-chevron" />
    </button></div>;
  })}</div>;

  return <IconContext.Provider value={{ size: 21, weight: 'regular' }}>
    <a href="#main-content" className="skip-link">Skip to workspace</a>
    <div className={`app ${inspectorOpen ? '' : 'inspector-closed'}`}>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} aria-label="Main navigation">
        <button className="wordmark" onClick={() => { navigate('Office'); clearFilters(); }} aria-label="Attendx home">ATTEND<span>X</span></button>
        <nav>{navigation.map(item => <button key={item.name} className={`nav-item ${view === item.name ? 'active' : ''}`} onClick={() => navigate(item.name)} aria-current={view === item.name ? 'page' : undefined}><item.icon /><span>{item.name}</span></button>)}</nav>
        <div className="workspace-nav"><p>Workspaces</p><button className={scope === 'client' ? 'scope-active' : ''} onClick={() => selectScope(scope === 'client' ? 'all' : 'client')} aria-pressed={scope === 'client'}><FolderSimple /><span>Client projects</span></button><button className={scope === 'product' ? 'scope-active' : ''} onClick={() => selectScope(scope === 'product' ? 'all' : 'product')} aria-pressed={scope === 'product'}><Cube /><span>Own products</span></button></div>
        <div className="sidebar-bottom"><ShieldCheck /><span>Interactive preview<small>Sample workspace</small></span></div>
      </aside>

      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><List /></button>
        <div className="workspace-picker menu-anchor"><span className="sample-label" title="Interactive preview with sample data. No live agents or infrastructure are connected.">Sample workspace</span>
          <button onClick={() => setMenu(menu === 'workspace' ? null : 'workspace')} aria-expanded={menu === 'workspace'} className="workspace-title">{scope === 'client' ? 'Client projects' : scope === 'product' ? 'Own products' : 'Company office'}<CaretDown size={17} /></button>
          {menu === 'workspace' && <div className="popover workspace-menu"><button onClick={() => selectScope('all')}><HouseLine /> Company office{scope === 'all' && <Check size={16} />}</button><button onClick={() => selectScope('client')}><FolderSimple /> Client projects</button><button onClick={() => selectScope('product')}><Cube /> Own products</button></div>}
        </div>
        <label className="search-box"><MagnifyingGlass aria-hidden="true" /><input aria-label="Search agents, projects or tasks" placeholder="Search agents, projects or tasks…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={15} /></button>}</label>
        <button className="button primary assign-button" aria-label="Assign project" onClick={() => { setMenu(null); setDialog('project'); }}><Plus size={23} /><span>Assign project</span></button>
        <div className="menu-anchor"><button className="icon-button notification-button" aria-label={`Notifications, ${pendingReviews.length} pending review${pendingReviews.length === 1 ? '' : 's'}`} aria-expanded={menu === 'notifications'} onClick={() => setMenu(menu === 'notifications' ? null : 'notifications')}><Bell />{pendingReviews.length > 0 && <span className="notification-dot" />}</button>
          {menu === 'notifications' && <div className="popover notification-menu"><strong>Needs your attention</strong>{pendingReviews.length ? pendingReviews.map(review => <button key={review.id} onClick={() => openReview(review)}><ShieldCheck /><span>{review.title}<small>{review.scope}</small></span><CaretRight size={16} /></button>) : <p className="muted">You’re all caught up.</p>}</div>}
        </div>
        <div className="menu-anchor profile-anchor"><button className="profile-button" aria-label="Workspace menu" aria-expanded={menu === 'profile'} onClick={() => setMenu(menu === 'profile' ? null : 'profile')}><img src={asset('theo.png')} alt="" /><CaretDown size={16} /></button>{menu === 'profile' && <div className="popover profile-menu"><strong>Sample workspace</strong><p>Changes are kept for this visit.</p><button onClick={reset}><ArrowCounterClockwise /> Reset sample workspace</button></div>}</div>
      </header>

      <main id="main-content" className={`workspace view-${view.toLowerCase()}`}>
        <div className="page-heading"><div><h1>{view === 'Office' ? 'Your company, at work.' : view === 'Projects' ? 'Good work starts here.' : view === 'Agents' ? 'Meet your team.' : 'The work, as it happens.'}</h1><p>{view === 'Office' ? 'Client teams and Attendx products, working together.' : view === 'Projects' ? 'Every client project and product, in one place.' : view === 'Agents' ? 'A specialist for every part of the project.' : 'Observed actions and handoffs across your sample workspace.'}</p></div>
          {view === 'Office' && <div className="view-toggle" aria-label="Office view"><button aria-label="Office view" className={officeMode === 'office' ? 'active' : ''} aria-pressed={officeMode === 'office'} onClick={() => setOfficeMode('office')}><SquaresFour /><span>Office</span></button><button aria-label="List view" className={officeMode === 'list' ? 'active' : ''} aria-pressed={officeMode === 'list'} onClick={() => setOfficeMode('list')}><List /><span>List</span></button></div>}
        </div>

        {(scope !== 'all' || projectFilter || stageFilter || query) && <div className="filter-bar"><span>{projectFilter ? projects.find(project => project.id === projectFilter)?.name : scope === 'client' ? 'Client projects' : scope === 'product' ? 'Own products' : 'All workspaces'}{stageFilter && ` / ${stageFilter}`}{query && ` / “${query}”`}</span><button onClick={clearFilters}><X size={14} />Clear filters</button></div>}

        {view === 'Office' && <>
          <div className="workflow"><div className="workflow-project"><FolderSimple size={25} /><strong>{selectedProject.id === 'atlas' ? 'Atlas delivery' : selectedProject.name === 'Workflow platform' ? 'Product delivery' : selectedProject.name}</strong></div>
            <div className="workflow-stages">{stages.map((stage, index) => { const Icon = stageIcons[stage]; return <div className="workflow-step" key={stage}><button className={(stageFilter ?? selectedAgent.stage) === stage ? 'stage-active' : ''} aria-pressed={stageFilter === stage} title={`Filter agents in ${stage}`} onClick={() => setStageFilter(old => old === stage ? null : stage)}><Icon /><span>{stage}</span></button>{index < stages.length - 1 && <ArrowRight className="stage-arrow" size={20} />}</div>; })}</div>
          </div>
          {visibleAgents.length === 0 ? <Empty title="No agents match your filters" onClear={clearFilters} /> : officeMode === 'office' ? <div className="office-scroll"><div className="office-scene" data-testid="office-scene">
            <img className="office-image" src={asset('office.png')} alt="Isometric gray-and-yellow office with separate glass-walled client and product studios" />
            {visibleAgents.map(agent => { const Icon = agent.status === 'paused' ? Pause : stageIcons[agent.stage]; return <button key={agent.id} className={`agent-marker ${selectedId === agent.id && inspectorOpen ? 'selected' : ''} ${agent.status === 'paused' ? 'paused' : ''}`} style={{ left: `${agent.position.x * 100}%`, top: `${agent.position.y * 100}%` }} aria-label={`View ${agent.name}, ${agent.role}`} aria-pressed={selectedId === agent.id && inspectorOpen} onClick={() => selectAgent(agent)}>
              <Avatar agent={agent} /><span className="marker-copy"><strong><span className={`status-dot dot-${agent.status}`} />{agent.name}</strong><small><Icon size={14} />{agent.status === 'paused' ? 'Task paused' : agent.activityLabel}</small></span>
            </button>; })}
            <div className="scene-caption">Select a teammate to see their work<ArrowSquareOut size={14} /></div>
          </div></div> : <div className="content-area">{agentRows()}</div>}
        </>}

        {view === 'Agents' && <div className="content-area"><div className="section-heading"><h2>{visibleAgents.length} teammates</h2><span>{agents.filter(agent => agent.status === 'working').length} working · {agents.filter(agent => agent.status === 'waiting').length} waiting</span></div>{visibleAgents.length ? agentRows() : <Empty title="No matching teammates" onClear={clearFilters} />}</div>}

        {view === 'Projects' && <div className="content-area projects-area">{visibleProjects.length ? visibleProjects.map(project => {
          const team = agents.filter(agent => agent.projectId === project.id);
          const Icon = project.scope === 'client' ? FolderSimple : Cube;
          return <article className="project-card" key={project.id}><header><span className="project-type"><Icon />{project.scope === 'client' ? 'Client project' : 'Own product'}</span><span className="project-stage">{project.stage}</span></header><h2>{project.name}</h2><p>{project.description}</p><div className="project-team"><div className="avatar-stack">{team.map(agent => <Avatar agent={agent} key={agent.id} />)}</div><span>{team.length} {team.length === 1 ? 'agent' : 'agents'}</span></div><button className="button secondary" onClick={() => { setProjectFilter(project.id); setStageFilter(null); setView('Office'); setOfficeMode('list'); setQuery(''); if (team[0]) selectAgent(team[0]); }}>Open project<ArrowRight size={17} /></button></article>;
        }) : <Empty title="No matching projects" onClear={clearFilters} />}<button className="new-project-tile" onClick={() => setDialog('project')}><Plus size={28} /><strong>Start something new</strong><span>Assign a project to your team</span></button></div>}

        {view === 'Activity' && <div className="content-area"><div className="section-heading"><h2>Workspace activity</h2><span>Sample events</span></div>{visibleEvents.length ? <div className="activity-feed">{visibleEvents.map(event => { const agent = agents.find(item => item.id === event.agentId)!; const project = projects.find(item => item.id === event.projectId)!; return <button className="feed-event" key={event.id} onClick={() => selectAgent(agent)}><Avatar agent={agent} /><span><strong>{agent.name} <span>{event.label.charAt(0).toLowerCase() + event.label.slice(1)}</span></strong><small>{project.name}</small></span><time>{event.time}</time></button>; })}</div> : <Empty title="No matching activity" onClear={clearFilters} />}</div>}
      </main>

      {inspectorOpen && <aside className="inspector" aria-label="Agent details" data-testid="agent-inspector">
        <button className="icon-button close-inspector" aria-label="Close agent details" onClick={() => setInspectorOpen(false)}><X /></button>
        {visibleAgents.length || view === 'Projects' || view === 'Activity' ? <>
          <div className="agent-identity"><div className="large-avatar-wrap"><Avatar agent={selectedAgent} size="large" /><span className={`status-dot dot-${selectedAgent.status}`} /></div><h2>{selectedAgent.name}</h2><p>{selectedAgent.role}</p><Status agent={selectedAgent} /></div>
          <div className="inspector-project"><FolderSimple /><span>{selectedProject.id === 'atlas' ? <><strong>Atlas</strong><span className="separator">·</span>Client portal</> : selectedProject.name}</span></div>
          <section className="detail-section task-section"><h3><CheckCircle />Task</h3><p>{selectedAgent.task}</p></section>
          <section className="detail-section recent-section"><h3><Clock />Recent activity</h3><ol className="timeline">{selectedEvents.map((event, index) => <li key={event.id}><time>{event.time}</time>{index === 0 ? <Play size={15} /> : index === 1 ? <Code size={15} /> : <FileText size={15} />}<span>{event.label}</span></li>)}</ol></section>
          <section className="detail-section artifact-section"><h3><FileText />Latest artifact</h3><button className="artifact-link" onClick={() => setDialog('artifact')}><FileText /><span>{selectedAgent.artifact.label}</span><CaretRight size={16} /></button><button className="button secondary pause-button" onClick={togglePause}>{selectedAgent.status === 'paused' ? <Play weight="fill" /> : <Pause weight="fill" />}{selectedAgent.status === 'paused' ? 'Resume task' : 'Pause task'}</button></section>
          <div className="reviews-section">{pendingReviews.length ? <><h3><span className="review-dot" />{pendingReviews.length} review waiting</h3>{pendingReviews.map(review => { const reviewer = agents.find(agent => agent.id === review.agentId)!; return <button className="review-summary" key={review.id} onClick={() => openReview(review)}><Avatar agent={reviewer} /><span><strong>{reviewer.name}</strong><small>{review.title}</small><small>{review.scope}</small><span className="text-link">View request</span></span><CaretRight size={16} /></button>; })}</> : <div className="reviews-complete"><CheckCircle /><span>All reviews complete<small>No pending requests</small></span></div>}</div>
        </> : <Empty title="No agent selected">Clear your filters to find a teammate.</Empty>}
      </aside>}
    </div>

    {dialog === 'project' && <ProjectForm agents={agents} onClose={closeDialog} onSubmit={createProject} />}
    {dialog === 'artifact' && <Modal title={selectedAgent.artifact.label} onClose={closeDialog}><p className="eyebrow">{selectedProject.name} / {selectedAgent.name}</p>{selectedAgent.artifact.kind === 'tests' ? <><div className="artifact-result"><CheckCircle size={32} /><div><h3>Sample checks passed</h3><p>Illustrative test evidence for this preview.</p></div></div><ul className="check-list">{['Response matches the API contract', 'Account access is scoped correctly', 'Invalid requests return useful errors', 'Billing totals match the sample data', 'Staging configuration is isolated'].map(label => <li key={label}><CheckCircle />{label}</li>)}</ul></> : <div className="document-preview"><h3>{selectedAgent.task}</h3><p>{selectedProject.brief}</p><h4>Acceptance criteria</h4><ul><li>Keep work within the assigned project.</li><li>Document the result and its supporting evidence.</li><li>Review changes before release.</li></ul></div>}<footer className="modal-actions"><button className="button secondary" onClick={() => { const body = JSON.stringify({ sample: true, agent: selectedAgent.name, project: selectedProject.name, artifact: selectedAgent.artifact.label, task: selectedAgent.task, activity: selectedEvents }, null, 2); const url = URL.createObjectURL(new Blob([body], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `attendx-${selectedAgent.id}-sample.json`; link.click(); URL.revokeObjectURL(url); setToast('Sample artifact downloaded.'); }}><DownloadSimple />Download sample</button><button className="button primary" onClick={closeDialog}>Done</button></footer></Modal>}
    {dialog === 'review' && activeReview && <Modal title="Review access request" onClose={closeDialog}><div className="review-person"><Avatar agent={agents.find(agent => agent.id === activeReview.agentId)!} /><div><strong>{agents.find(agent => agent.id === activeReview.agentId)!.name}</strong><p>{activeReview.title}</p></div><ShieldCheck size={28} /></div><dl className="review-facts"><div><dt>Project</dt><dd>{projects.find(project => project.id === activeReview.projectId)!.name}</dd></div><div><dt>Scope</dt><dd>{activeReview.scope}</dd></div><div><dt>Requested access</dt><dd>{activeReview.details}</dd></div></dl><p className="preview-note">This is a sample request. Your decision updates this preview only.</p><footer className="modal-actions"><button className="button secondary" onClick={() => resolveReview('declined')}>Decline</button><button className="button primary" onClick={() => resolveReview('approved')}><Check />Approve request</button></footer></Modal>}
    {toast && <div className="toast" role="status"><CheckCircle size={20} /><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16} /></button></div>}
  </IconContext.Provider>;
}
