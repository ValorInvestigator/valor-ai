import * as dotenv from 'dotenv';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { getRedisEndpoint, closeRedisConnection } from '../src/queue/connection';

dotenv.config({ path: __dirname + '/../.env' });

async function injectLegalResearch() {
  const io = require('ioredis');
  const redis = new io(getRedisEndpoint(), { maxRetriesPerRequest: null });
  
  const iq = new Queue('investigations', { connection: redis });
  const aq = new Queue('assignments', { connection: redis });

  const investigationId = randomUUID();
  const target = "Research and index all open-source legal intelligence tools, APIs, journalist databases, and Github repositories for extracting federal and state court cases, statutes, and dockets.";

  await iq.add('investigation_created', {
    id: investigationId,
    target,
  });

  const vectors = [
    "Search Github and developer forums for APIs, open-source scrapers, and undocumented webhooks for extracting federal court cases directly from CourtListener and the RECAP project.",
    "Investigate existing GitHub repositories and Python/Node scripts used by journalists to parse PACER documents and bypass login gate fees using crowd-sourced databases.",
    "Research technical methodologies for extracting Oregon Revised Statutes (ORS) and state-level eCourt dockets without tripping anti-bot protections.",
    "Find methods to programmatically scrape or access legal bulk data from Cornell Legal Information Institute (LII) and Google Scholar Case Law.",
    "Analyze existing premium Apify legal actors or data brokers to map how they aggregate full-text legal opinions, docket updates, and federal statutes across multiple jurisdictions."
  ];

  const assignmentsToCreate = vectors.map(v => ({
    id: randomUUID(),
    investigationId,
    target: v,
    taskDescription: "Gather technical intelligence and API references to help us architect a master legal OSINT actor for Apify.",
    status: 'queued',
    priority: 1
  }));

  for (const assignment of assignmentsToCreate) {
    await aq.add('assignment_created', assignment);
    console.log(`[Queue] Pushed Vector -> ${assignment.target}`);
  }

  console.log(`\nSuccessfully injected Legal Actor R&D into the OODA loop!`);
  
  await closeRedisConnection();
  process.exit(0);
}

injectLegalResearch().catch(console.error);
