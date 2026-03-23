// Valor AI -- Core Types

export interface Investigation {
  id: string;
  target: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  assignments: Assignment[];
  finalReport?: string;
}

export interface Assignment {
  id: string;
  investigationId: string;
  workerId?: string;
  target: string;
  taskDescription: string;
  status: 'queued' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  priority: number; // 1 (highest) to 10 (lowest)
  createdAt: string;
  assignedAt?: string;
  completedAt?: string;
  result?: WorkerResult;
}

export interface WorkerResult {
  workerId: string;
  assignmentId: string;
  findings: Finding[];
  newLeads: Lead[];
  reportMarkdown: string;
  confidence: number; // 0.0 to 1.0
  tokensUsed: number;
  llmProvider: 'local' | 'xai' | 'claude';
  durationMs: number;
}

export interface Finding {
  id: string;
  fact: string;
  source: string;
  sourceUrl?: string;
  confidence: number;
  category: FindingCategory;
  entities: string[]; // people, orgs mentioned
  timestamp: string;
}

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

export interface Lead {
  id: string;
  name: string;
  type: 'person' | 'organization' | 'search_term' | 'document' | 'url';
  priority: number;
  source: string; // which worker/assignment generated this lead
  status: 'new' | 'queued' | 'investigated' | 'duplicate';
  embedding?: number[]; // for vector dedup via sqlite-vec
  createdAt: string;
}

export interface WorkerStatus {
  id: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  currentAssignment?: string;
  completedCount: number;
  failedCount: number;
  lastHeartbeat: string;
  uptime: number;
}

export interface LLMConfig {
  provider: 'local' | 'xai' | 'claude';
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface ValorAIConfig {
  workerCount: number;
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
}
