export type Stage = 'Intake' | 'Build' | 'Verify' | 'Release';

export type Scope = 'client' | 'product';

export type AgentStatus = 'working' | 'waiting' | 'paused';

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  projectId: string;
  task: string;
  activityLabel: string;
  stage: Stage;
  position: { x: number; y: number };
  avatar: string;
  artifact: {
    label: string;
    kind: 'tests' | 'document' | 'design' | 'data';
  };
}

export interface Project {
  id: string;
  name: string;
  description: string;
  scope: Scope;
  stage: Stage;
  brief: string;
}

export interface Review {
  id: string;
  agentId: string;
  projectId: string;
  title: string;
  scope: string;
  details: string;
  status: 'pending' | 'approved' | 'declined';
}

export interface ActivityEvent {
  id: string;
  agentId: string;
  projectId: string;
  label: string;
  time: string;
}

export const stages: Stage[] = ['Intake', 'Build', 'Verify', 'Release'];

// Illustrative local data for the office prototype, not live agent telemetry.
export const initialProjects: Project[] = [
  {
    id: 'atlas',
    name: 'Atlas client portal',
    description: 'A secure portal for the Atlas customer team.',
    scope: 'client',
    stage: 'Verify',
    brief:
      'Deliver a staging portal with account access and billing history. Validate the API and role permissions before release review.',
  },
  {
    id: 'attendx',
    name: 'Workflow platform',
    description: 'Attendx’s own workspace for coordinated agent work.',
    scope: 'product',
    stage: 'Build',
    brief:
      'Build a clear onboarding flow and project activity view. Use sample data while documenting the event pipeline.',
  },
];

export const initialAgents: Agent[] = [
  {
    id: 'maya',
    name: 'Maya',
    role: 'Project lead',
    status: 'working',
    projectId: 'atlas',
    task: 'Plan the portal release',
    activityLabel: 'Planning release',
    stage: 'Intake',
    position: { x: 0.18, y: 0.22 },
    avatar: 'maya.png',
    artifact: { label: 'Release plan · Draft', kind: 'document' },
  },
  {
    id: 'theo',
    name: 'Theo',
    role: 'Software engineer',
    status: 'working',
    projectId: 'atlas',
    task: 'Validate the billing API',
    activityLabel: 'Running API tests',
    stage: 'Verify',
    position: { x: 0.44, y: 0.3 },
    avatar: 'theo.png',
    artifact: { label: 'Test run · 18 checks', kind: 'tests' },
  },
  {
    id: 'leo',
    name: 'Leo',
    role: 'Quality engineer',
    status: 'working',
    projectId: 'atlas',
    task: 'Review portal test results',
    activityLabel: 'Reviewing results',
    stage: 'Verify',
    position: { x: 0.18, y: 0.46 },
    avatar: 'leo.png',
    artifact: { label: 'QA checklist · 12 scenarios', kind: 'tests' },
  },
  {
    id: 'sera',
    name: 'Sera',
    role: 'Security reviewer',
    status: 'working',
    projectId: 'atlas',
    task: 'Verify staging access boundaries',
    activityLabel: 'Checking access',
    stage: 'Verify',
    position: { x: 0.44, y: 0.55 },
    avatar: 'sera.png',
    artifact: { label: 'Access report · Staging', kind: 'document' },
  },
  {
    id: 'nia',
    name: 'Nia',
    role: 'Product designer',
    status: 'working',
    projectId: 'attendx',
    task: 'Design the workspace welcome flow',
    activityLabel: 'Designing onboarding',
    stage: 'Build',
    position: { x: 0.8, y: 0.29 },
    avatar: 'nia.png',
    artifact: { label: 'Onboarding flow · 4 screens', kind: 'design' },
  },
  {
    id: 'iris',
    name: 'Iris',
    role: 'Research specialist',
    status: 'working',
    projectId: 'attendx',
    task: 'Document event integration requirements',
    activityLabel: 'Reading documentation',
    stage: 'Intake',
    position: { x: 0.8, y: 0.42 },
    avatar: 'iris.png',
    artifact: { label: 'Integration notes · 3 sources', kind: 'document' },
  },
  {
    id: 'ravi',
    name: 'Ravi',
    role: 'Data engineer',
    status: 'waiting',
    projectId: 'attendx',
    task: 'Validate the sample event pipeline',
    activityLabel: 'Waiting for data',
    stage: 'Build',
    position: { x: 0.8, y: 0.61 },
    avatar: 'ravi.png',
    artifact: { label: 'Event schema · Draft', kind: 'data' },
  },
];

export const initialReviews: Review[] = [
  {
    id: 'atlas-access-review',
    agentId: 'sera',
    projectId: 'atlas',
    title: 'Atlas access review',
    scope: 'Staging environment permissions',
    details:
      'Allow Sera to read the Atlas staging database schema to verify role permissions. Access covers schema metadata only, excludes row data and write operations, and grants no production access.',
    status: 'pending',
  },
];

export const initialEvents: ActivityEvent[] = [
  {
    id: 'event-01',
    agentId: 'theo',
    projectId: 'atlas',
    label: 'Started the billing API test run',
    time: '12s ago',
  },
  {
    id: 'event-02',
    agentId: 'nia',
    projectId: 'attendx',
    label: 'Saved the workspace welcome screen',
    time: '28s ago',
  },
  {
    id: 'event-03',
    agentId: 'sera',
    projectId: 'atlas',
    label: 'Requested read-only staging schema access',
    time: '46s ago',
  },
  {
    id: 'event-04',
    agentId: 'leo',
    projectId: 'atlas',
    label: 'Opened the portal regression report',
    time: '1m ago',
  },
  {
    id: 'event-05',
    agentId: 'theo',
    projectId: 'atlas',
    label: 'Loaded 18 billing API checks',
    time: '2m ago',
  },
  {
    id: 'event-06',
    agentId: 'iris',
    projectId: 'attendx',
    label: 'Opened the event API documentation',
    time: '3m ago',
  },
  {
    id: 'event-07',
    agentId: 'maya',
    projectId: 'atlas',
    label: 'Updated the staging release checklist',
    time: '4m ago',
  },
  {
    id: 'event-08',
    agentId: 'ravi',
    projectId: 'attendx',
    label: 'Paused validation until the sample event batch is available',
    time: '5m ago',
  },
  {
    id: 'event-09',
    agentId: 'nia',
    projectId: 'attendx',
    label: 'Added project selection to the onboarding draft',
    time: '6m ago',
  },
  {
    id: 'event-10',
    agentId: 'leo',
    projectId: 'atlas',
    label: 'Recorded 12 portal regression scenarios',
    time: '7m ago',
  },
  {
    id: 'event-11',
    agentId: 'sera',
    projectId: 'atlas',
    label: 'Opened the staging role policy manifest',
    time: '8m ago',
  },
  {
    id: 'event-12',
    agentId: 'theo',
    projectId: 'atlas',
    label: 'Verified the staging API connection',
    time: '9m ago',
  },
  {
    id: 'event-13',
    agentId: 'iris',
    projectId: 'attendx',
    label: 'Saved source links in the integration notes',
    time: '10m ago',
  },
  {
    id: 'event-14',
    agentId: 'maya',
    projectId: 'atlas',
    label: 'Added API validation to the release acceptance criteria',
    time: '12m ago',
  },
];
