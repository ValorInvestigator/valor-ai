import * as dotenv from 'dotenv';
import { createSqliteStorageRepository } from '../src/storage';
import { enqueueAssignmentJob, closeQueues } from '../src/queue/queues';
import { closeRedisConnection } from '../src/queue/connection';

dotenv.config({ path: __dirname + '/../.env' });

async function run() {
  const db = createSqliteStorageRepository();
  await db.initialize();

  console.log('Spawning highly targeted ADAMA investigation...');

  const inv = await db.createInvestigation({
    target: "Investigate precise connections between Disability Rights Oregon, Emily Cooper, and UK-based academic publisher Adam Matthew Digital Ltd (aka Adama / Admiral Adama), due to +01:00 European timezone metadata found in US civil rights filings.",
    priority: 1
  });

  const vectors = [
    "Investigate The Carlyle Group Private Equity connections to SAGE Publishing or its subsidiary Adam Matthew Digital Ltd.",
    "Search web for Carlyle Group healthcare portfolio intersections with Optum, United Health Group, and SAGE Publishing legal or academic proxies.",
    "Extract financial disclosures linking Carlyle Group's backing of UHG/Optum to offshore UK legal research outsourcing via Adam Matthew Digital.",
    "Search SEC Edgar or public PE filings for Carlyle Group holding stakes in SAGE Publications or funding Civil Rights defense initiatives used by the Baum Family.",
    "Investigate deep connections between 'Disability Rights Oregon', 'Optum', 'Carlyle Group', and UK-based 'SAGE Publishing' (Adama) regarding guardianship precedents."
  ];

  const assignmentsToCreate = vectors.map(v => ({
    investigationId: inv.id,
    target: v,
    taskDescription: "Explore this specific vector connecting DRO to the UK publisher AMD to explain the timezone and metadata discrepancies.",
    priority: 1
  }));

  const createdAssignments = await db.createAssignments(assignmentsToCreate);

  for (const a of createdAssignments) {
    await enqueueAssignmentJob({
      investigationId: a.investigationId,
      assignmentId: a.id,
      target: a.target,
      taskDescription: a.taskDescription,
      priority: a.priority,
      enqueuedAt: new Date().toISOString(),
      retryCount: 0
    });
    console.log(`[Queue] Pushed Vector -> ${a.target}`);
  }

  await closeQueues();
  await closeRedisConnection();
  console.log('\nBoom! Operation Adama successfully injected directly into the live BullMQ cache.');
}

run().catch(console.error);
