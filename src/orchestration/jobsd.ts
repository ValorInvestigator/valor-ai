import type { StorageRepository } from '../agents/types';
import { jsonCompletion } from '../llm/client';
import { enqueueAssignmentJob } from '../queue/queues';
import type { BabysitterAction } from './types';

const processedAssignments = new Set<string>();

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startDaemon(storage: StorageRepository) {
  console.log('[jobsd] Mistral Babysitter Daemon initialized.');
  console.log('[jobsd] Scanning persistent JSON state DB every 5 seconds for triage opportunities...');
  
  while (true) {
    try {
      await poll(storage);
    } catch (e) {
      console.error('[jobsd] Outer Loop Evaluation Error:', e);
    }
    await sleep(5000);
  }
}

async function poll(storage: StorageRepository) {
  const investigations = await storage.listInvestigations(['pending', 'active']);
  
  for (const inv of investigations) {
    const assignments = await storage.listAssignments(inv.id);
    
    for (const a of assignments) {
      if (processedAssignments.has(a.id)) continue;
      
      // Babysitter Triages Terminal (completed/failed) or interrupted states
      if (a.status === 'failed' || a.status === 'completed') {
        
        console.log(`\n[jobsd] Triage Activated: Assignment ${a.id} (Status: ${a.status})`);
        
        // Pass to local Mistral / Qwen for evaluation
        const prompt = `
You are the Orchestration Babysitter for an autonomous OSINT research platform.
We just successfully (or unsuccessfully) executed an external internet scraping assignment. Here is the metadata:

Target Query: ${a.target}
Task Context: ${a.taskDescription}
End Status: ${a.status}
Execution Result: ${a.result ? a.result.findings.map((f)=>JSON.stringify(f)).join('; ') : 'No valid artifacts returned'}
Failure Reason (if any): ${a.failure ? a.failure.reason : 'None'}

Your job is to decide the next action based on this outcome. 
If the external run succeeded and produced good data, choose 'continue_waiting' or 'accept_partial_and_continue'.
If it failed, hit a captcha wall, or returned 0 organic results, choose 'retry_with_rewritten_query' or 'switch_tool'.
If we should completely give up due to 404s, choose 'mark_stalled'.

Respond exclusively with a JSON object matching this TypeScript interface:
{
  "action": "continue_waiting" | "retry_same_tool" | "retry_with_rewritten_query" | "switch_tool" | "accept_partial_and_continue" | "mark_stalled",
  "reasoning": "string explaining why",
  "payload": { "newQuery": "string (if rewitten)", "newTool": "string (if switched)" }
}
`;
        
        const response = await jsonCompletion<BabysitterAction>([
          { role: 'user', content: prompt }
        ], { preferredProvider: 'local', temperature: 0.2 });
        
        if (response && response.data) {
          const action = response.data.action;
          console.log(`[jobsd] Mistral Classification: ${action}`);
          console.log(`[jobsd] Mistral Reasoning: ${response.data.reasoning}`);
          
          if (action === 'retry_with_rewritten_query' || action === 'switch_tool') {
             // Mistral recommends trying again with a better query! Push it natively back to Redis.
             const newTarget = response.data.payload?.newQuery || a.target;
             const [newAssignment] = await storage.createAssignments([{
               investigationId: a.investigationId,
               target: newTarget,
               taskDescription: `[Mistral Babysitter Strategy: ${action}]: ${a.taskDescription}`,
               priority: Math.max(a.priority - 1, 0)
             }]);
             
             await enqueueAssignmentJob({
               investigationId: inv.id,
               assignmentId: newAssignment.id,
               target: newAssignment.target,
               taskDescription: newAssignment.taskDescription,
               priority: newAssignment.priority,
               enqueuedAt: new Date().toISOString(),
               retryCount: 0
             });
             
             console.log(`[jobsd] Enqueued new Mistral-augmented target: "${newTarget}" seamlessly into BullMQ!`);
          } else if (action === 'mark_stalled') {
             console.log(`[jobsd] Execution branch pruned naturally. Proceeding.`);
          }
        } else {
          console.error(`[jobsd] Local Mistral connection timeout or severe parsing fault.`);
        }
        
        processedAssignments.add(a.id);
      }
    }
  }
}
