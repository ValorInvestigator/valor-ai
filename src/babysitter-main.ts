import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  getBooleanFlag,
  getIntegerFlag,
  getStringFlag,
  parseCliArgs,
  requireNoUnexpectedPositionals,
} from './cli-flags';
import type { BabysitterDecision, BabysitterSnapshot } from './babysitter-types';

function printHelp(): void {
  console.log([
    'Valor AI Babysitter',
    '',
    'Usage:',
    '  npm run babysitter -- --snapshot-file <path> [--model mistral] [--temperature 0] [--max-tokens 512]',
    '',
    'Flags:',
    '  --snapshot-file <path>   JSON snapshot to evaluate',
    '  --model <name>           Model hint, default: mistral',
    '  --temperature <n>        Reserved for future model integration',
    '  --max-tokens <n>         Reserved for future model integration',
    '  --help                   Show this help text',
  ].join('\n'));
}

function decideAction(snapshot: BabysitterSnapshot): BabysitterDecision {
  const retriesUsed = snapshot.retriesUsed ?? 0;
  const retryBudget = snapshot.retryBudget ?? 2;

  if (retriesUsed >= retryBudget) {
    return {
      action: 'mark_stalled',
      reason: 'Retry budget exhausted.',
      priority: 'high',
      metadata: { retriesUsed, retryBudget },
    };
  }

  if (snapshot.partialOutputsPresent) {
    return {
      action: 'accept_partial_and_continue',
      reason: 'Partial evidence is present and should advance the investigation.',
      priority: 'normal',
    };
  }

  if ((snapshot.resultCount ?? -1) === 0 || snapshot.lastToolStatus === 'empty_results') {
    return {
      action: 'retry_with_rewritten_query',
      reason: 'Tool run completed but returned no useful results.',
      priority: 'normal',
    };
  }

  if (snapshot.externalRunId && (snapshot.heartbeatAgeSec ?? 0) >= 120) {
    return {
      action: 'resume_existing_run',
      reason: 'External run metadata exists and the assignment appears interrupted.',
      priority: 'high',
      metadata: {
        externalRunId: snapshot.externalRunId,
        datasetUrl: snapshot.datasetUrl,
      },
    };
  }

  if (snapshot.lastToolStatus === 'failed' && snapshot.lastError) {
    return {
      action: 'switch_tool',
      reason: `Last tool failed: ${snapshot.lastError}`,
      priority: 'normal',
    };
  }

  return {
    action: 'continue_waiting',
    reason: 'No intervention threshold was met.',
    priority: 'low',
  };
}

function main(): void {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (getBooleanFlag(parsed, 'help')) {
    printHelp();
    return;
  }

  requireNoUnexpectedPositionals(parsed, 'babysitter');

  const snapshotFile = getStringFlag(parsed, 'snapshot-file');
  if (!snapshotFile) {
    throw new Error('Missing required flag --snapshot-file.');
  }

  const model = getStringFlag(parsed, 'model') ?? 'mistral';
  const temperature = getIntegerFlag(parsed, 'temperature');
  const maxTokens = getIntegerFlag(parsed, 'max-tokens');
  const snapshotPath = resolve(snapshotFile);
  const snapshot = JSON.parse(
    readFileSync(snapshotPath, 'utf8').replace(/^\uFEFF/, ''),
  ) as BabysitterSnapshot;
  const decision = decideAction(snapshot);

  console.log(JSON.stringify({
    model,
    temperature,
    maxTokens,
    decision,
  }, null, 2));
}

main();
