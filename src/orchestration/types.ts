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

export interface BabysitterAction {
  action: BabysitterActionType;
  reasoning: string;
  payload?: any;
}

export interface OrchestrationEvent {
  id: string;
  investigationId: string;
  assignmentId?: string;
  eventType: string;
  createdAt: string;
  actor: 'jobsd' | 'mistral_babysitter';
  details: Record<string, unknown>;
}

export interface ToolRun {
  id: string;
  investigationId: string;
  assignmentId: string;
  workerId: string;
  toolName: string;
  query: string;
  status: 'started' | 'completed' | 'failed' | 'partial';
  startedAt: string;
  completedAt?: string;
  runId?: string;
  datasetUrl?: string;
  resultCount?: number;
  emptyResult?: boolean;
  failureStage?: string;
  failureReason?: string;
}
