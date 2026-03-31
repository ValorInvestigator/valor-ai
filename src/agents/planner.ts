// Valor AI -- Nemotron Planner
// Uses Nemotron 4B to route research tasks to the correct tool and actor.
// Consults the 132-actor Apify registry to pick the best actor for each task.

import { v4 as uuid } from 'uuid';
import { jsonCompletion } from '../llm/client';
import type { Assignment } from './types';
import { getAvailableTools } from '../tools';
import { buildRegistryPromptBlock } from '../tools/actor-registry';

export interface PlannerDecision {
  tool: string;
  actorId?: string;
  query: string;
  rationale: string;
}

export class Planner {
  readonly id: string;
  private readonly registryBlock: string;

  constructor() {
    this.id = `planner-${uuid().slice(0, 8)}`;
    this.registryBlock = buildRegistryPromptBlock();
    console.log(`[Planner ${this.id}] initialized with Nemotron routing and ${this.registryBlock.split('\n').length}-line actor registry.`);
  }

  /**
   * Evaluates the current assignment and context to decide the next tool execution step.
   * Nemotron picks strictly from the full 132-actor Apify registry.
   */
  async planNextStep(assignment: Assignment, investigationContext: string): Promise<PlannerDecision | null> {
    const tools = getAvailableTools().map(t => `- ${t.name}: ${t.description}`).join('\n');

    const systemPrompt = `You are the Lead Investigator (Manager) for an OSINT system.
Your goal is to choose the most cost-effective and appropriate tool to investigate the given target.

Available Tools:
${tools}

ROUTING RULES (Follow Strictly in Order):
1. Use the "brave" tool as your primary tool for 95% of generic web searches, phone numbers, contact info, general business investigations, court/legal matters, and URLs.
2. Use the "apify" tool for highly specialized OSINT tasks (LinkedIn, people search, social media, corporate registries, deep web crawling, anti-bot scraping). You are ENCOURAGED to use Apify actors from the registry to get the highest quality proprietary data. 
3. If you choose the "apify" tool, you MUST select the exact Actor ID from the registry below that best matches the target.

${this.registryBlock}

Return your decision strictly as JSON:
{
  "tool": "<brave | apify>",
  "actorId": "<if tool is apify, the full actor ID like apify/linkedin-scraper, else omit>",
  "query": "<exact search query or URL to pass to the tool>",
  "rationale": "<brief reason for this choice>"
}`;

    const prompt = `--- INVESTIGATION CONTEXT ---\n${investigationContext}\n\n--- ASSIGNMENT TARGET ---\n${assignment.target}\n\n--- TASK ---\n${assignment.taskDescription}`;

    const response = await jsonCompletion<PlannerDecision>(
      [{ role: 'user', content: prompt }],
      {
        systemPrompt,
        preferredProvider: 'nemotron',
        temperature: 0.1,
      }
    );

    if (!response) {
      console.warn(`[Planner ${this.id}] Nemotron unavailable or failed to route. Falling back to default.`);
      return null;
    }

    console.log(`[Planner ${this.id}] Chose tool: ${response.data.tool} (Actor: ${response.data.actorId || 'N/A'}) -- ${response.data.rationale}`);
    return response.data;
  }
}

export const planner = new Planner();
