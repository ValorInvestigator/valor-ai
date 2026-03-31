import * as dotenv from 'dotenv';
import { ApifyClient } from 'apify-client';
import { chatCompletion } from '../src/llm/client';

dotenv.config({ path: __dirname + '/../.env' });

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

const TARGET_USERNAME = "adammatthewdigital";
const KEYWORDS = '"Emily Cooper" OR "Disability Rights Oregon"';

async function chaseLead() {
  console.log(`\n======================================================`);
  console.log(`🕵️ VALOR AI: OPERATION ADAMA INITIATED`);
  console.log(`======================================================`);
  console.log(`Targeting: ${TARGET_USERNAME}\n`);

  console.log(`[1/3] Triggering Broad Deep Google Search...`);
  const googleRun = await client.actor('apify/google-search-scraper').call({
    queries: `${TARGET_USERNAME}\n${TARGET_USERNAME} "Disability Rights Oregon"\n${TARGET_USERNAME} "Emily Cooper"`,
    resultsPerPage: 10
  });

  const googleDataset = await client.dataset(googleRun.defaultDatasetId).listItems();
  const searchHits: any[] = googleDataset.items.length > 0 && googleDataset.items[0].organicResults 
    ? (googleDataset.items[0].organicResults as any[]) 
    : [];

  let compiledIntel = `--- GOOGLE SEARCH INTEL ---\n`;
  if (searchHits.length > 0) {
    console.log(`🔥 Paydirt! Found ${searchHits.length} immediate search connections.`);
    for (const h of searchHits) {
      compiledIntel += `Title: ${h.title}\nURL: ${h.url}\nSnippet: ${h.description}\n\n`;
    }
  } else {
    console.log(`No simple public Google correlations found. Digging deeper...`);
    compiledIntel += "No direct Google hits linking the username to DRO/Emily Cooper.\n";
  }

  // Next, target the top Sherlock URLs (Slack, Wordpress, Pinterest)
  const knownLinks = [
    "https://adammatthewdigital.wordpress.com/",
    "https://adammatthewdigital.slack.com",
    "https://www.pinterest.com/adammatthewdigital/"
  ];

  console.log(`\n[2/3] Deploying Web Scraper to known Sherlock identity footprints...`);
  const webRun = await client.actor('apify/website-content-crawler').call({
    startUrls: knownLinks.map(url => ({ url })),
    maxCrawlDepth: 1,
    maxCrawlPages: 3
  });

  const webDataset = await client.dataset(webRun.defaultDatasetId).listItems();
  compiledIntel += `\n--- PROFILE SCRAPE INTEL ---\n`;
  for (const page of webDataset.items) {
      const extractedText = (page as any).text || (page as any).markdown || '';
      compiledIntel += `Target: ${page.url}\nContent Snippet: ${String(extractedText).substring(0, 500)}...\n\n`;
      console.log(`Scraped footprint at: ${page.url}`);
  }

  console.log(`\n[3/3] Firing raw intel to Nemotron for instant synthesis...`);
  
  const systemPrompt = `You are a forensic investigator examining the footprint of the digital entity / username "${TARGET_USERNAME}". This entity appeared in the metadata of filings from Emily Cooper (Disability Rights Oregon). Your job is to analyze the scraped footprints and determine EXACTLY what this entity is. Be highly objective. Is it a person? A software service? A template company? A publishing alias? Synthesize the intelligence into a fast, aggressive, objective brief detailing what this identity is and how it might practically connect to legal filings.`;

  const response = await chatCompletion([
    { role: 'user', content: compiledIntel }
  ], {
    systemPrompt,
    preferredProvider: 'nemotron',
    temperature: 0.2
  });

  console.log(`\n======================================================`);
  console.log(`🚨 NEMOTRON TACTICAL BRIEF: ADAMA`);
  console.log(`======================================================\n`);
  console.log(response?.content || "Nemotron failed to generate a brief.");

}

chaseLead().catch(console.error);
