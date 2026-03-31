export type BabysitterActionType =
  | 'continue_waiting'
  | 'retry_same_tool'
  | 'retry_with_rewritten_query'
  | 'switch_tool'
  | 'fan_out_queries'
  | 'resume_existing_run'
  | 'requeue_assignment'
  | 'accept_partial_and_continue'
  | 'mark_stalled'
  | 'escalate_to_primary_model';

export interface BabysitterSnapshot {
  investigationId?: string;
  assignmentId?: string;
  target?: string;
  status?: string;
  retriesUsed?: number;
  retryBudget?: number;
  heartbeatAgeSec?: number;
  lastToolStatus?: string;
  lastError?: string;
  partialOutputsPresent?: boolean;
  resultCount?: number;
  externalRunId?: string;
  datasetUrl?: string;
  recentEvents?: string[];
}

export interface BabysitterDecision {
  action: BabysitterActionType;
  reason: string;
  priority: 'low' | 'normal' | 'high';
  metadata?: Record<string, unknown>;
}
