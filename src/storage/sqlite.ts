import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  Assignment,
  AssignmentStatus,
  CreateAssignmentInput,
  CreateInvestigationInput,
  FailureMetadata,
  Finding,
  Investigation,
  InvestigationStatus,
  Lead,
  LeadStatus,
  Metadata,
  StorageRepository,
  SynthesizedReport,
  UpdateAssignmentStatusInput,
  UpdateInvestigationStatusInput,
  WorkerResult,
  WorkerStatus,
} from '../agents/types';

function nowIso(): string {
  return new Date().toISOString();
}

function sleepSync(ms: number) {
  const start = Date.now();
  while (Date.now() - start < ms) { /* blocking */ }
}

interface DBState {
  investigations: Record<string, Investigation>;
  assignments: Record<string, Assignment>;
  findings: Record<string, Finding>;
  leads: Record<string, Lead>;
  workerStatuses: Record<string, WorkerStatus>;
  reports: Record<string, SynthesizedReport>;
}

export class SqliteStorageRepository implements StorageRepository {
  private file: string;

  constructor(dbPath?: string) {
    this.file = dbPath?.replace('.sqlite', '.json') || path.join(process.cwd(), 'data', 'valor-ai-state.json');
  }

  async initialize(): Promise<void> {
    console.log(`[JSONStorage] Initialized Atomic Multi-Process JSON Store at ${this.file}`);
  }

  async close(): Promise<void> {}

  private readState(): DBState {
    if (!fs.existsSync(this.file)) {
      return { investigations: {}, assignments: {}, findings: {}, leads: {}, workerStatuses: {}, reports: {} };
    }
    for (let i = 0; i < 50; i++) {
       try { 
         const content = fs.readFileSync(this.file, 'utf8');
         if (!content.trim()) break; // empty file fallback
         return JSON.parse(content); 
       }
       catch (e) { sleepSync(5); }
    }
    return { investigations: {}, assignments: {}, findings: {}, leads: {}, workerStatuses: {}, reports: {} };
  }

  private writeState(state: DBState): void {
    const dir = path.dirname(this.file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    // Natively handle race conditions across worker terminals by asserting Atomic rename replacements
    const tempFile = `${this.file}.tmp.${randomUUID()}`;
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
    for (let i = 0; i < 50; i++) {
      try {
        fs.renameSync(tempFile, this.file);
        return;
      } catch (e) { sleepSync(5); }
    }
    // Deep fallback
    fs.writeFileSync(this.file, JSON.stringify(state, null, 2), 'utf8');
    try { fs.unlinkSync(tempFile); } catch(e){}
  }

  async createInvestigation(input: CreateInvestigationInput): Promise<Investigation> {
    const state = this.readState();
    const id = randomUUID();
    const inv: Investigation = {
      id,
      target: input.target,
      status: 'pending',
      createdAt: nowIso(),
      assignments: [],
      metadata: input.metadata,
    };
    state.investigations[id] = inv;
    this.writeState(state);
    return inv;
  }

  async getInvestigation(id: string): Promise<Investigation | null> {
    const state = this.readState();
    const base = state.investigations[id];
    if (!base) return null;
    
    const invAssignments = Object.values(state.assignments)
      .filter((a) => a.investigationId === id)
      .sort((a, b) => a.priority - b.priority);
    
    const report = Object.values(state.reports).find((r) => r.investigationId === id);

    return { ...base, assignments: invAssignments, finalReport: report };
  }

  async listInvestigations(statuses?: InvestigationStatus[]): Promise<Investigation[]> {
    const state = this.readState();
    let result = Object.values(state.investigations);
    if (statuses && statuses.length > 0) {
      result = result.filter((inv) => statuses.includes(inv.status));
    }
    
    const hydrated: Investigation[] = [];
    for (const inv of result) {
      const full = await this.getInvestigation(inv.id);
      if (full) hydrated.push(full);
    }
    
    return hydrated.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateInvestigation(id: string, input: UpdateInvestigationStatusInput): Promise<void> {
    const state = this.readState();
    const inv = state.investigations[id];
    if (!inv) throw new Error(`Investigation ${id} not found`);
    
    inv.status = input.status;
    inv.updatedAt = nowIso();
    if (input.completedAt) inv.completedAt = input.completedAt;
    
    if (input.finalReport) {
      state.reports[input.finalReport.id] = input.finalReport;
      inv.completedAt = inv.completedAt ?? input.finalReport.generatedAt;
    }
    
    if (input.failure) inv.failure = input.failure;
    
    state.investigations[id] = inv;
    this.writeState(state);
  }

  async createAssignments(assignments: CreateAssignmentInput[]): Promise<Assignment[]> {
    const state = this.readState();
    const created: Assignment[] = [];
    for (const req of assignments) {
      const a: Assignment = {
        id: randomUUID(),
        investigationId: req.investigationId,
        target: req.target,
        taskDescription: req.taskDescription,
        status: 'queued',
        priority: req.priority,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.assignments[a.id] = a;
      created.push(a);
    }
    this.writeState(state);
    return created;
  }

  async getAssignment(id: string): Promise<Assignment | null> {
    return this.readState().assignments[id] ?? null;
  }

  async listAssignments(investigationId: string): Promise<Assignment[]> {
    return Object.values(this.readState().assignments)
      .filter((a) => a.investigationId === investigationId)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  async updateAssignment(id: string, input: UpdateAssignmentStatusInput): Promise<void> {
    const state = this.readState();
    const a = state.assignments[id];
    if (!a) return;
    
    a.status = input.status;
    a.updatedAt = nowIso();
    if (input.workerId) a.workerId = input.workerId;
    if (input.assignedAt) a.assignedAt = input.assignedAt;
    if (input.completedAt) a.completedAt = input.completedAt;
    if (input.failure) a.failure = input.failure;
    if (input.result) a.result = input.result;
    
    state.assignments[id] = a;
    this.writeState(state);
  }

  async saveWorkerResult(result: WorkerResult): Promise<void> {
    const state = this.readState();
    const a = state.assignments[result.assignmentId];
    if (a) {
      a.status = result.failure ? 'failed' : 'completed';
      a.updatedAt = nowIso();
      a.completedAt = result.completedAt ?? nowIso();
      a.workerId = result.workerId;
      a.result = result;
      a.failure = result.failure;
      
      state.assignments[result.assignmentId] = a;
    }
    
    if (result.investigationId) {
      for (const f of result.findings) {
        f.investigationId = f.investigationId ?? result.investigationId;
        f.assignmentId = f.assignmentId ?? result.assignmentId;
        state.findings[f.id] = f;
      }
      for (const lead of result.newLeads) {
        const dedupeKey = lead.dedupeKey || `${lead.name.trim().toLowerCase()}:${lead.type}`;
        
        const existing = Object.values(state.leads).find(
          (l) => (l as any).investigationId === result.investigationId && l.dedupeKey === dedupeKey
        );
        
        if (existing) {
          existing.status = existing.status ?? lead.status;
          existing.priority = Math.min(existing.priority, lead.priority);
        } else {
          const created: Lead = {
            ...lead,
            id: lead.id || randomUUID(),
            dedupeKey,
            investigationId: result.investigationId,
          } as any;
          state.leads[created.id] = created;
        }
      }
    }
    this.writeState(state);
  }

  async saveFindings(
    investigationId: string,
    assignmentId: string,
    findings: Finding[],
  ): Promise<void> {
    const state = this.readState();
    for (const f of findings) {
      f.investigationId = f.investigationId ?? investigationId;
      f.assignmentId = f.assignmentId ?? assignmentId;
      state.findings[f.id] = f;
    }
    this.writeState(state);
  }

  async upsertLeads(investigationId: string, leads: Lead[]): Promise<Lead[]> {
    const state = this.readState();
    const stored: Lead[] = [];
    for (const lead of leads) {
      const dedupeKey = lead.dedupeKey || `${lead.name.trim().toLowerCase()}:${lead.type}`;
      
      const existing = Object.values(state.leads).find(
        (l) => (l as any).investigationId === investigationId && l.dedupeKey === dedupeKey
      );
      
      if (existing) {
        existing.status = existing.status ?? lead.status;
        existing.priority = Math.min(existing.priority, lead.priority);
        stored.push(existing);
      } else {
        const created: Lead = {
          ...lead,
          id: lead.id || randomUUID(),
          dedupeKey,
          investigationId,
        } as any;
        state.leads[created.id] = created;
        stored.push(created);
      }
    }
    this.writeState(state);
    return stored;
  }

  async markLeadStatus(leadId: string, status: LeadStatus): Promise<void> {
    const state = this.readState();
    const l = state.leads[leadId];
    if (l) {
      l.status = status;
      this.writeState(state);
    }
  }

  async saveWorkerStatus(status: WorkerStatus): Promise<void> {
    const state = this.readState();
    state.workerStatuses[status.id] = status;
    this.writeState(state);
  }

  async listWorkerStatuses(): Promise<WorkerStatus[]> {
    return Object.values(this.readState().workerStatuses);
  }

  async saveSynthesizedReport(report: SynthesizedReport): Promise<void> {
    const state = this.readState();
    state.reports[report.id] = report;
    
    const inv = state.investigations[report.investigationId];
    if (inv) {
      inv.updatedAt = nowIso();
      inv.completedAt = inv.completedAt ?? report.generatedAt;
    }
    this.writeState(state);
  }

  async getSynthesizedReport(investigationId: string): Promise<SynthesizedReport | null> {
    return Object.values(this.readState().reports).find((r) => r.investigationId === investigationId) ?? null;
  }
}

export function createSqliteStorageRepository(dbPath?: string): SqliteStorageRepository {
  return new SqliteStorageRepository(dbPath);
}

export const sqliteStorageRepository = new SqliteStorageRepository();
