// Valor AI -- Tool Registry
// Owner: Claude Code | TASK-007
// Integrated by Codex with the frozen ToolAdapter contract.

import type { ToolAdapter } from '../agents/types';
import { apify, ApifyAdapter } from './apify';
import { braveSearch } from './brave-search';
import { firecrawl } from './firecrawl';
import { courtListener } from './courtlistener';

const registry = new Map<string, ToolAdapter>();

export function registerTool(adapter: ToolAdapter): void {
  registry.set(adapter.name, adapter);
  console.log(
    `[ToolRegistry] Registered: ${adapter.name} (${adapter.isConfigured() ? 'available' : 'disabled'})`,
  );
}

export function getTool(name: string): ToolAdapter | undefined {
  return registry.get(name);
}

export function getAvailableTools(): ToolAdapter[] {
  return Array.from(registry.values()).filter((tool) => tool.isConfigured());
}

export function getRegisteredTools(): string[] {
  return Array.from(registry.keys());
}

// Register all tools — order matters for fallback priority
registerTool(braveSearch);
// Temporarily disabled due to LLM hallucinations
// registerTool(courtListener);
// Temporarily disabled due to out of credits
// registerTool(firecrawl);
registerTool(apify);

export { ApifyAdapter };
