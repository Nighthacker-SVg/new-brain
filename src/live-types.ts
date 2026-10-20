export interface LiveUser {
  id: string;
  name: string;
  email: string;
}
export interface LiveAgent {
  id: string;
  name: string;
  role: string;
  template?: string;
  persona?: string;
  status: string;
  projectId: string;
  task: string;
  activityLabel?: string;
  stage?: string;
  avatar?: string;
  position?: { x: number; y: number };
  budgetCents?: number;
  expiresAt?: string;
}
export interface LiveProject {
  id: string;
  name: string;
  description?: string;
  brief: string;
  scope: string;
  stage: string;
  status: string;
  acceptanceCriteria?: string[] | string;
  repoUrl?: string;
  budgetCents: number;
  spentCents: number;
  localCalls?: number;
  plan?: unknown;
  planApproved?: boolean;
  createdAt?: string;
}
export interface LiveTask {
  id: string;
  kind: string;
  projectId: string;
  agentId: string;
  status: string;
  error?: string;
  result?: unknown;
  createdAt?: string;
  updatedAt?: string;
}
export interface LiveMessage {
  id: string;
  projectId: string;
  agentId: string;
  role: string;
  content: string;
  evidenceIds?: string[];
  evidence?: string[];
  createdAt?: string;
}
export interface LiveArtifact {
  id: string;
  projectId: string;
  agentId?: string;
  name: string;
  kind: string;
  mime?: string;
  content?: string | unknown;
  createdAt?: string;
}
export interface LiveReview {
  id: string;
  projectId: string;
  agentId?: string;
  kind: string;
  title: string;
  details: string;
  status: string;
  payload?: unknown;
  createdAt?: string;
}
export interface LiveEvent {
  id: string;
  projectId?: string;
  agentId?: string;
  label: string;
  detail?: unknown;
  createdAt?: string;
  time?: string;
}
export interface LiveMemory {
  id: string;
  projectId: string;
  content: string;
  sourceArtifactId?: string;
  approved?: boolean;
  createdAt?: string;
}
export interface LiveKnowledgeItem {
  id: string;
  kind: string;
  name: string;
  snippet: string;
  score?: number;
  createdAt?: string;
}
export interface LiveSkill {
  id: string;
  projectId?: string;
  agentId: string;
  version: number;
  instructions: string;
  status: string;
  evaluation?: unknown;
  createdAt?: string;
}
export interface LiveSchedule {
  id: string;
  projectId: string;
  intervalMinutes: number;
  nextRun?: string;
  enabled: boolean;
}
export interface LiveProvider {
  id: string;
  label: string;
  type: "openai" | "anthropic";
  baseUrl: string;
  model: string;
  roles: string[];
  priority: number;
  enabled: boolean;
  keyPresent?: boolean;
  last4?: string;
  local?: boolean;
}
export interface LiveState {
  user: LiveUser;
  agents: LiveAgent[];
  projects: LiveProject[];
  reviews: LiveReview[];
  events: LiveEvent[];
  tasks: LiveTask[];
  messages: LiveMessage[];
  artifacts: LiveArtifact[];
  memories: LiveMemory[];
  skills: LiveSkill[];
  schedules: LiveSchedule[];
  capabilities: Record<string, unknown>;
  metrics: Record<string, unknown>;
  runtimePolicy?: {
    localOnly: boolean;
    workerConcurrency: number;
    localCallLimit: number;
    modelTimeoutMs: number;
    maxTokens: number;
  };
}
