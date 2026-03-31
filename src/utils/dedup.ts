// Valor AI -- Lead Deduplication Utility
// Owner: Claude Code | TASK-004
// Simple deterministic dedup by key. Vector similarity comes later via sqlite-vec.

import type { Lead } from '../agents/types';

/**
 * Generate a deterministic dedup key for a lead.
 * Normalizes name and type to catch near-duplicates.
 */
export function dedupeKey(lead: Lead): string {
  const normalized = lead.name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
  return `${normalized}:${lead.type}`;
}

/**
 * Deduplicate an array of leads. Keeps the highest-priority version of each.
 */
export function deduplicateLeads(leads: Lead[]): Lead[] {
  const seen = new Map<string, Lead>();

  for (const lead of leads) {
    const key = dedupeKey(lead);
    const existing = seen.get(key);

    if (!existing || lead.priority < existing.priority) {
      seen.set(key, lead);
    }
  }

  return Array.from(seen.values()).sort((left, right) => left.priority - right.priority);
}

/**
 * Check if a lead is a duplicate of any in the existing set.
 */
export function isDuplicate(lead: Lead, existingLeads: Lead[]): boolean {
  const key = dedupeKey(lead);
  return existingLeads.some((existingLead) => dedupeKey(existingLead) === key);
}
