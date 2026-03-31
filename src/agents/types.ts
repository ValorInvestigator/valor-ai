// Valor AI -- Frozen Shared Contracts

export type Metadata = Record<string, unknown>;

export type InvestigationStatus = 'pending' | 'active' | 'completed' | 'failed' | 'stalled';
export type AssignmentStatus = 'queued' | 'assigned' | 'in_progress' | 'completed' | 'failed';
export type LeadStatus = 'new' | 'queued' | 'investigated' | 'duplicate';
export type WorkerState = 'idle' | 'busy' | 'error' | 'offline';
export type LLMProviderName = 'local' | 'mistral' | 'xai' | 'claude' | 'nemotron' | 'ollama';
export type LeadType = 'person' | 'organization' | 'search_term' | 'document' | 'url';
export type ToolArtifactType = 'webpage' | 'search_results' | 'document' | 'json' | 'text' | 'other';
export type ToolExecutionStatus = 'success' | 'partial' | 'failed';

export type FailureStage =
  | 'bootstrap'
  | 'decomposition'
  | 'assignment_queue'
  | 'research'
  | 'analysis'
  | 'report_synthesis'
  | 'storage'
  | 'tool'
  | 'llm'
  | 'api'
  | 'unknown';

export type FindingCategory =
  | 'financial'
  | 'legal'
  | 'corporate'
  | 'personal'
  | 'regulatory'
  | 'media'
  | 'social'
  | 'court_record'
  | 'public_record'
  | 'other';

export interface FailureMetadata {
  stage: FailureStage;
  reason: string;
  retryable: boolean;
  occurredAt: string;
  code?: string;
  provider?: string;
  details?: Metadata;
  rawError?: string;
}

export interface Finding {
  id: string;
  investigationId?: string;
  assignmentId?: string;
  fact: string;
  source: string;
  sourceUrl?: string;
  confidence: number;
  category: FindingCategory;
  entities: string[];
  timestamp: string;
  metadata?: Metadata;
}

export interface Lead {
  id: string;
  name: string;
  type: LeadType;
  priority: number;
  source: string;
  dedupeKey?: string;
  status: LeadStatus;
  embedding?: number[];
  createdAt: string;
  metadata?: Metadata;
}

export interface ReportSection {
  heading: string;
  summary: string;
  findingIds: string[];
  leadIds: string[];
}

export interface SynthesizedReport {
  id: string;
  investigationId: string;
  title: string;
  executiveSummary: string;
  sections: ReportSection[];
  markdown: string;
  artifactPath: string;
  generatedAt: string;
  llmProvider: LLMProviderName;
  assignmentIds: string[];
  leadIds: string[];
  failure?: FailureMetadata;
}

export interface WorkerResult {
  workerId: string;
  assignmentId: string;
  investigationId?: string;
  findings: Finding[];
  newLeads: Lead[];
  artifactPaths?: string[];
  reportMarkdown: string;
  confidence: number;
  tokensUsed: number;
  llmProvider: LLMProviderName;
  durationMs: number;
  completedAt?: string;
  failure?: FailureMetadata;
  supervisorId?: string;
  validation?: ValidationReport;
}

export interface Assignment {
  id: string;
  investigationId: string;
  workerId?: string;
  target: string;
  taskDescription: string;
  status: AssignmentStatus;
  priority: number;
  createdAt: string;
  updatedAt?: string;
  assignedAt?: string;
  completedAt?: string;
  result?: WorkerResult;
  failure?: FailureMetadata;
}

export interface Investigation {
  id: string;
  target: string;
  status: InvestigationStatus;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  assignments: Assignment[];
  finalReport?: SynthesizedReport;
  failure?: FailureMetadata;
  metadata?: Metadata;
}

export interface WorkerStatus {
  id: string;
  status: WorkerState;
  currentAssignment?: string;
  completedCount: number;
  failedCount: number;
  lastHeartbeat: string;
  uptime: number;
  failure?: FailureMetadata;
}

export interface ToolArtifact {
  type: ToolArtifactType;
  title: string;
  source: string;
  sourceUrl?: string;
  content: string;
  savedPath?: string;
  metadata?: Metadata;
}

export interface ToolExecutionInput {
  investigationId: string;
  assignmentId: string;
  target: string;
  query: string;
  maxResults?: number;
  metadata?: Metadata;
}

export interface ToolExecutionResult {
  adapter: string;
  status: ToolExecutionStatus;
  startedAt: string;
  completedAt: string;
  artifacts: ToolArtifact[];
  normalizedText?: string;
  metadata?: Metadata;
  failure?: FailureMetadata;
}

export interface ToolAdapter {
  name: string;
  description: string;
  isConfigured(): boolean;
  execute(input: ToolExecutionInput): Promise<ToolExecutionResult>;
}

export interface CreateInvestigationInput {
  target: string;
  priority?: number;
  metadata?: Metadata;
}

export interface CreateAssignmentInput {
  investigationId: string;
  target: string;
  taskDescription: string;
  priority: number;
}

export interface UpdateInvestigationStatusInput {
  status: InvestigationStatus;
  completedAt?: string;
  finalReport?: SynthesizedReport;
  failure?: FailureMetadata;
}

export interface UpdateAssignmentStatusInput {
  status: AssignmentStatus;
  workerId?: string;
  assignedAt?: string;
  completedAt?: string;
  result?: WorkerResult;
  failure?: FailureMetadata;
}

export interface StorageRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  createInvestigation(input: CreateInvestigationInput): Promise<Investigation>;
  getInvestigation(id: string): Promise<Investigation | null>;
  listInvestigations(statuses?: InvestigationStatus[]): Promise<Investigation[]>;
  updateInvestigation(id: string, input: UpdateInvestigationStatusInput): Promise<void>;
  createAssignments(assignments: CreateAssignmentInput[]): Promise<Assignment[]>;
  getAssignment(id: string): Promise<Assignment | null>;
  listAssignments(investigationId: string): Promise<Assignment[]>;
  updateAssignment(id: string, input: UpdateAssignmentStatusInput): Promise<void>;
  saveWorkerResult(result: WorkerResult): Promise<void>;
  saveFindings(investigationId: string, assignmentId: string, findings: Finding[]): Promise<void>;
  upsertLeads(investigationId: string, leads: Lead[]): Promise<Lead[]>;
  markLeadStatus(leadId: string, status: LeadStatus): Promise<void>;
  saveWorkerStatus(status: WorkerStatus): Promise<void>;
  listWorkerStatuses(): Promise<WorkerStatus[]>;
  saveSynthesizedReport(report: SynthesizedReport): Promise<void>;
  getSynthesizedReport(investigationId: string): Promise<SynthesizedReport | null>;
}

export interface InvestigationRequestedPayload {
  investigationId: string;
  target: string;
  priority: number;
  requestedAt: string;
  metadata?: Metadata;
}

export interface AssignmentJobPayload {
  investigationId: string;
  assignmentId: string;
  target: string;
  taskDescription: string;
  priority: number;
  enqueuedAt: string;
  retryCount: number;
}

export interface WorkerResultJobPayload {
  investigationId: string;
  assignmentId: string;
  workerId: string;
  completedAt: string;
  result: WorkerResult;
}

export interface LeadDiscoveredPayload {
  investigationId: string;
  assignmentId: string;
  leadId: string;
  dedupeKey: string;
  priority: number;
  discoveredAt: string;
}

export interface ReportSynthesisJobPayload {
  investigationId: string;
  assignmentIds: string[];
  requestedAt: string;
}

export interface QueueJobPayloadMap {
  investigation_requested: InvestigationRequestedPayload;
  assignment_execute: AssignmentJobPayload;
  worker_result_ingested: WorkerResultJobPayload;
  lead_discovered: LeadDiscoveredPayload;
  report_synthesis_requested: ReportSynthesisJobPayload;
}

export type QueueJobName = keyof QueueJobPayloadMap;

export type AgentMessageType =
  | QueueJobName
  | 'agent_status'
  | 'task_claimed'
  | 'task_completed'
  | 'error';

export interface AgentMessage<TPayload = Metadata> {
  id: string;
  type: AgentMessageType;
  from: string;
  to: string;
  createdAt: string;
  investigationId?: string;
  assignmentId?: string;
  payload: TPayload;
}

export interface ProviderAvailability {
  provider: LLMProviderName;
  available: boolean;
  model?: string;
  reason?: string;
}

export interface QueueSnapshot {
  assignmentsPending: number;
  assignmentsActive: number;
  leadsPending: number;
  reportsPending: number;
  deadLetters: number;
}

export interface InvestigateRequest {
  target: string;
  priority?: number;
  requestedBy?: string;
  notes?: string;
}

export interface InvestigateResponse {
  investigationId: string;
  status: InvestigationStatus;
  acceptedAt: string;
}

export interface InvestigationStatusResponse {
  investigation: Investigation;
}

export interface ReportsResponse {
  reports: SynthesizedReport[];
}

export interface LeadsResponse {
  leads: Lead[];
}

export interface WorkersResponse {
  workers: WorkerStatus[];
}

export interface StatusResponse {
  service: 'valor-ai';
  uptimeMs: number;
  providers: ProviderAvailability[];
  workers: WorkerStatus[];
  queues: QueueSnapshot;
}

export interface LLMConfig {
  provider: LLMProviderName;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface ValorAIConfig {
  workerCount: number;
  workerHeartbeatIntervalMs: number;
  llm: {
    primary: LLMConfig;
    fallback: LLMConfig[];
  };
  rateLimits: {
    apifyMinTimeMs: number;
    firecrawlMinTimeMs: number;
    braveMinTimeMs: number;
  };
  redis: {
    host: string;
    port: number;
  };
  dataPaths?: {
    dbDir?: string;
    reportDir?: string;
  };
  api?: {
    port: number;
  };
}

// --- Supervisor / Hallucination Detection Types ---

export type HallucinationSeverity = 'high' | 'medium' | 'low';

export interface HallucinationFlag {
  indicator: string;
  severity: HallucinationSeverity;
  detail: string;
}

export interface ValidationReport {
  assignmentId: string;
  workerId: string;
  valid: boolean;
  hallucinated: boolean;
  flags: HallucinationFlag[];
  validatedAt: string;
  retryCount: number;
  supervisorProvider?: LLMProviderName;
  rawDataSizeChars: number;
  claimedFindingsCount: number;
}
