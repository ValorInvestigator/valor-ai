import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import { createSqliteStorageRepository } from './storage';
import { enqueueAssignmentJob } from './queue/queues';
import {
  getBooleanFlag,
  getIntegerFlag,
  getStringFlag,
  parseCliArgs,
  requireNoUnexpectedPositionals,
} from './cli-flags';
import type { Assignment, Investigation, StorageRepository } from './agents/types';
import type { BabysitterSnapshot, BabysitterDecision } from './babysitter-types';

const execFileAsync = promisify(execFile);

dotenv.config();

interface JobsdOptions {
  watch: boolean;
  dryRun: boolean;
  retryStalled: boolean;
  pollIntervalSec: number;
  maxActions: number;
  investigationId?: string;
  assignmentId?: string;
  dbPath: string;
  snapshotDir: string;
}

function resolveDataRoot(): string {
  const configuredRoot = process.env.VALOR_DATA_DIR?.trim();
  if (configuredRoot) {
    return resolve(configuredRoot);
  }

  const localAppData = process.env.LOCALAPPDATA?.trim() || process.env.APPDATA?.trim();
  if (localAppData) {
    return resolve(localAppData, 'valor-ai');
  }

  return resolve(process.cwd(), 'data');
}

function printHelp(): void {
  console.log([
    'Valor AI jobsd',
    '',
    'Usage:',
    '  npm run jobsd -- --watch [--poll-interval 10] [--max-actions 25]',
    '  npm run jobsd -- --dry-run --investigation-id <id>',
    '',
    'Flags:',
    '  --watch                  Run continuously',
    '  --dry-run                Report actions without executing them',
    '  --retry-stalled          Include stalled investigations in review set',
    '  --poll-interval <sec>    Watch loop interval, default: 10',
    '  --max-actions <n>        Max snapshots to emit per pass, default: 25',
    '  --investigation-id <id>  Restrict to one investigation',
    '  --assignment-id <id>     Restrict to one assignment',
    '  --db-path <path>         Override SQLite path',
    '  --snapshot-dir <path>    Override snapshot output directory',
    '  --help                   Show this help text',
  ].join('\n'));
}

function parseOptions(): JobsdOptions {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (getBooleanFlag(parsed, 'help')) {
    printHelp();
    process.exit(0);
  }

  requireNoUnexpectedPositionals(parsed, 'jobsd');

  const dataRoot = resolveDataRoot();
  const dbPath = getStringFlag(parsed, 'db-path')
    ? resolve(getStringFlag(parsed, 'db-path') as string)
    : join(dataRoot, 'db', 'valor-ai.sqlite');
  const snapshotDir = getStringFlag(parsed, 'snapshot-dir')
    ? resolve(getStringFlag(parsed, 'snapshot-dir') as string)
    : join(dataRoot, 'snapshots');

  return {
    watch: getBooleanFlag(parsed, 'watch'),
    dryRun: getBooleanFlag(parsed, 'dry-run'),
    retryStalled: getBooleanFlag(parsed, 'retry-stalled'),
    pollIntervalSec: getIntegerFlag(parsed, 'poll-interval') ?? 10,
    maxActions: getIntegerFlag(parsed, 'max-actions') ?? 25,
    investigationId: getStringFlag(parsed, 'investigation-id'),
    assignmentId: getStringFlag(parsed, 'assignment-id'),
    dbPath,
    snapshotDir,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function buildSnapshot(investigation: Investigation, assignment?: Assignment): BabysitterSnapshot {
  const result = assignment?.result;

  return {
    investigationId: investigation.id,
    assignmentId: assignment?.id,
    target: assignment?.target ?? investigation.target,
    status: assignment?.status ?? investigation.status,
    retriesUsed: 0,
    retryBudget: 2,
    partialOutputsPresent: Boolean(result && (
      result.findings.length > 0 || result.newLeads.length > 0 || (result.artifactPaths?.length ?? 0) > 0
    )),
    resultCount: result ? result.findings.length + result.newLeads.length : undefined,
    lastToolStatus: result?.failure ? 'failed' : undefined,
    lastError: result?.failure?.reason,
    recentEvents: [
      `investigation:${investigation.status}`,
      assignment ? `assignment:${assignment.status}` : 'assignment:none',
    ],
  };
}

async function collectSnapshots(options: JobsdOptions): Promise<BabysitterSnapshot[]> {
  const storage = createSqliteStorageRepository(options.dbPath);
  await storage.initialize();

  try {
    const statuses: Array<Investigation['status']> = options.retryStalled
      ? ['pending', 'active', 'stalled']
      : ['pending', 'active'];
    const investigations = await storage.listInvestigations(statuses);
    const filteredInvestigations = options.investigationId
      ? investigations.filter((investigation) => investigation.id === options.investigationId)
      : investigations;

    const snapshots: BabysitterSnapshot[] = [];

    for (const investigation of filteredInvestigations) {
      const assignments = await storage.listAssignments(investigation.id);
      const filteredAssignments = options.assignmentId
        ? assignments.filter((assignment) => assignment.id === options.assignmentId)
        : assignments;

      if (filteredAssignments.length === 0) {
        snapshots.push(buildSnapshot(investigation));
      }

      for (const assignment of filteredAssignments) {
        snapshots.push(buildSnapshot(investigation, assignment));
      }
    }

    return snapshots.slice(0, options.maxActions);
  } finally {
    await storage.close();
  }
}

function writeSnapshots(snapshots: BabysitterSnapshot[], snapshotDir: string): string[] {
  mkdirSync(snapshotDir, { recursive: true });

  return snapshots.map((snapshot, index) => {
    const investigationPart = snapshot.investigationId ?? 'unknown-investigation';
    const assignmentPart = snapshot.assignmentId ?? `summary-${index + 1}`;
    const outputPath = join(snapshotDir, `${investigationPart}-${assignmentPart}.json`);
    writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf8');
    return outputPath;
  });
}

async function applyDecision(decision: BabysitterDecision, snapshotPath: string, storage: StorageRepository) {
  const content = readFileSync(snapshotPath, 'utf8');
  const snapshotData = JSON.parse(content.replace(/^\uFEFF/, '')) as BabysitterSnapshot;
  const invId = snapshotData.investigationId;
  const assignId = snapshotData.assignmentId;
  const target = snapshotData.target;
  
  if (!invId) return;

  if (decision.action === 'retry_with_rewritten_query' || decision.action === 'switch_tool' || decision.action === 'fan_out_queries') {
    const newTarget = (decision.metadata?.newQuery || target) as string;
    const [newAssignment] = await storage.createAssignments([{
      investigationId: invId,
      target: newTarget,
      taskDescription: `[Babysitter Override ${decision.action}]: Resume halted assignment`,
      priority: decision.priority === 'high' ? 0 : 1
    }]);

    await enqueueAssignmentJob({
      investigationId: invId,
      assignmentId: newAssignment.id,
      target: newAssignment.target,
      taskDescription: newAssignment.taskDescription,
      priority: newAssignment.priority,
      enqueuedAt: new Date().toISOString(),
      retryCount: 0
    });
    console.log(`   -> ✅ Queued variant target: "${newTarget}" into BullMQ`);
  } else if (decision.action === 'mark_stalled') {
    if (assignId) {
      await storage.updateAssignment(assignId, { status: 'failed', failure: { reason: decision.reason, retryable: false, stage: 'babysitter' as any, occurredAt: new Date().toISOString() }});
      console.log(`   -> 🛑 Marked assignment stalled in DB.`);
    }
  } else if (decision.action === 'accept_partial_and_continue') {
    if (assignId) {
      await storage.updateAssignment(assignId, { status: 'completed' });
      console.log(`   -> ✅ Accepted partial artifacts. Passed to next phase.`);
    }
  }
}

async function runPass(options: JobsdOptions): Promise<void> {
  const snapshots = await collectSnapshots(options);

  if (snapshots.length === 0) {
    console.log('[jobsd] No matching investigations or assignments found.');
    return;
  }

  const snapshotPaths = writeSnapshots(snapshots, options.snapshotDir);
  console.log(`[jobsd] Prepared ${snapshotPaths.length} babysitter snapshot(s).`);

  const storage = createSqliteStorageRepository(options.dbPath);
  await storage.initialize();

  for (const snapshotPath of snapshotPaths) {
    if (options.dryRun) {
      console.log(`[jobsd] Would evaluate ${snapshotPath}`);
      continue;
    }
    
    console.log(`[jobsd] Evaluating ${snapshotPath}...`);
    let decisionJson = '';
    try {
      const { stdout } = await execFileAsync('node', ['dist/babysitter-main.js', '--snapshot-file', snapshotPath], {
         cwd: process.cwd()
      });
      const outputLines = stdout.split('\n');
      const jsonStart = outputLines.findIndex(l => l.trim().startsWith('{'));
      decisionJson = jsonStart !== -1 ? outputLines.slice(jsonStart).join('\n') : stdout;
    } catch (e) {
      console.error(`[jobsd] Failed to evaluate ${snapshotPath}:`, e);
      continue;
    }

    try {
      const result = JSON.parse(decisionJson);
      const decision: BabysitterDecision = result.decision;
      console.log(`[jobsd] Babysitter Action: ${decision.action} (${decision.reason})`);
      await applyDecision(decision, snapshotPath, storage);
    } catch (parseError) {
      console.error(`[jobsd] Failed to parse babysitter JSON:`, parseError);
    }
  }
  
  await storage.close();
}

async function main(): Promise<void> {
  const options = parseOptions();

  do {
    await runPass(options);

    if (!options.watch) {
      break;
    }

    await sleep(options.pollIntervalSec * 1000);
  } while (true);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown jobsd failure';
  console.error(`[jobsd] Fatal error: ${message}`);
  process.exitCode = 1;
});
