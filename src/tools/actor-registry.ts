// Valor AI -- Apify Actor Registry
// 132 investigation-relevant actors from the Apify platform.
// The Planner (Nemotron 4B) uses this registry to select the right actor
// for each OSINT assignment.
//
// Format: compact lines Nemotron can scan quickly.
// Each entry: actorId | short description | best-for keywords

export interface ActorEntry {
  id: string;
  label: string;
  category: string;
  /** When to pick this actor -- keywords the Planner matches against. */
  bestFor: string;
  isFree: boolean;
}

export const ACTOR_REGISTRY: ActorEntry[] = [
  // ===== WEB SCRAPING & CONTENT EXTRACTION (25) =====
  { id: 'apify/website-content-crawler', label: 'Website Content Crawler', category: 'web', bestFor: 'deep page extraction, full site crawl, markdown output, bulk URL scraping', isFree: true },
  { id: 'apify/web-scraper', label: 'Web Scraper', category: 'web', bestFor: 'JS-rendered pages, custom page function, dynamic content', isFree: true },
  { id: 'apify/cheerio-scraper', label: 'Cheerio Scraper', category: 'web', bestFor: 'fast HTML parsing, static pages, lightweight scraping', isFree: true },
  { id: 'apify/puppeteer-scraper', label: 'Puppeteer Scraper', category: 'web', bestFor: 'headless Chrome, screenshots, interactive pages', isFree: true },
  { id: 'drobnikj/gpt-scraper', label: 'GPT Scraper', category: 'web', bestFor: 'AI-powered extraction, unstructured data, natural language queries', isFree: false },
  { id: 'apify/playwright-scraper', label: 'Playwright Scraper', category: 'web', bestFor: 'Wix sites, AJAX forms, anti-bot pages, complex JS rendering', isFree: true },
  { id: 'misceres/seo-audit-tool', label: 'SEO Audit Tool', category: 'web', bestFor: 'site structure, broken links, metadata audit, domain analysis', isFree: true },
  { id: 'drobnikj/extended-gpt-scraper', label: 'Extended GPT Scraper', category: 'web', bestFor: 'AI extraction with custom instructions, schema output', isFree: true },
  { id: 'jancurn/extract-metadata', label: 'Metadata Extractor', category: 'web', bestFor: 'page metadata, Open Graph, Twitter cards, structured data', isFree: true },
  { id: 'eloquent_mountain/ai-web-scraper-extract-data-with-ease', label: 'AI Web Scraper', category: 'web', bestFor: 'no-code AI extraction, point-and-extract', isFree: false },
  { id: 'apify/beautifulsoup-scraper', label: 'BeautifulSoup Scraper', category: 'web', bestFor: 'Python-style parsing, simple HTML extraction', isFree: true },
  { id: 'quaking_pail/ai-website-content-markdown-scraper', label: 'AI Markdown Scraper', category: 'web', bestFor: 'LLM-ready markdown, clean text extraction', isFree: false },
  { id: 'apify/legacy-phantomjs-crawler', label: 'PhantomJS Crawler', category: 'web', bestFor: 'legacy sites, old JS frameworks', isFree: true },
  { id: 'jakub.kopecky/llmstxt-generator', label: 'llms.txt Generator', category: 'web', bestFor: 'site-wide text dump for LLM ingestion', isFree: true },
  { id: 'janbuchar/crawl4ai', label: 'Crawl4AI', category: 'web', bestFor: 'AI-optimized crawling, RAG pipeline input', isFree: true },
  { id: 'parsera-labs/parsera', label: 'Parsera', category: 'web', bestFor: 'structured data extraction, tables, lists', isFree: false },
  { id: 'onescales/bulk-image-downloader', label: 'Bulk Image Downloader', category: 'web', bestFor: 'download all images from page, photo evidence collection', isFree: false },
  { id: 'mstephen190/vanilla-js-scraper', label: 'Vanilla JS Scraper', category: 'web', bestFor: 'minimal JS scraping, simple pages', isFree: true },
  { id: 'datascoutapi/website-content-crawler-pro', label: 'Content Crawler Pro', category: 'web', bestFor: 'premium content extraction, paywalled sites', isFree: false },
  { id: 'josejet/dynamic-web-scraper', label: 'Dynamic Web Scraper', category: 'web', bestFor: 'single-page apps, React/Vue sites', isFree: false },
  { id: 'apify/camoufox-scraper', label: 'Camoufox Scraper', category: 'web', bestFor: 'anti-bot bypass, Cloudflare, captcha-protected sites', isFree: true },
  { id: 'making-data-meaningful/page-source-scraper', label: 'Page Source Scraper', category: 'web', bestFor: 'raw HTML source code, hidden elements', isFree: false },
  { id: 'apify/jsdom-scraper', label: 'JSDOM Scraper', category: 'web', bestFor: 'server-side DOM parsing, Node.js native', isFree: true },
  { id: 'superlativetech/http-api', label: 'HTTP API Client', category: 'web', bestFor: 'REST API calls, custom headers, authentication', isFree: false },
  { id: 'universal_scraping/universal-article-scraper', label: 'Universal Article Scraper', category: 'web', bestFor: 'news articles, blog posts, article body extraction', isFree: false },

  // ===== GOOGLE SEARCH / SERP (15) =====
  { id: 'apify/google-search-scraper', label: 'Google Search Scraper', category: 'search', bestFor: 'Google SERP results, organic search, web search queries', isFree: false },
  { id: 'scraperlink/google-search-results-serp-scraper', label: 'SERP Scraper (ScraperLink)', category: 'search', bestFor: 'Google results with snippets, featured snippets', isFree: false },
  { id: 'damilo/google-search-apify', label: 'Google Search Apify', category: 'search', bestFor: 'fast Google search, batch queries', isFree: false },
  { id: 'igolaizola/google-search-scraper-ppe', label: 'Google Search (cheap)', category: 'search', bestFor: 'bulk Google search at $0.15/1000 results', isFree: false },
  { id: 'datarava/google-search-results-scraper', label: 'Google Results Scraper', category: 'search', bestFor: 'Google organic results extraction', isFree: false },
  { id: 'apidojo/google-search-scraper', label: 'Google SERP Scraper (APIDojo)', category: 'search', bestFor: 'Google search with location targeting', isFree: false },
  { id: 'datascoutapi/google-search-results-scraper', label: 'Google Results (DataScout)', category: 'search', bestFor: 'Google search with metadata', isFree: false },
  { id: '6sigmag/fast-google-search-results-scraper', label: 'Fast Google Scraper', category: 'search', bestFor: 'speed-optimized Google search', isFree: false },
  { id: 'api-ninja/google-search-scraper', label: 'Google Search (API Ninja)', category: 'search', bestFor: 'simple Google search API', isFree: false },
  { id: 'gauravsaran/google-search-extractor', label: 'Google Search Extractor', category: 'search', bestFor: 'Google results with dates and URLs', isFree: false },
  { id: 's-r/free-google-search-results-serp---only-0-25-per-1-000-results', label: 'Budget Google SERP', category: 'search', bestFor: 'cheapest Google search option', isFree: false },
  { id: 'futurizerush/google-search-results-scraper', label: 'Google Results (Futurize)', category: 'search', bestFor: 'Google search with pagination', isFree: false },
  { id: 'lexis-solutions/google-ai-scraper', label: 'Google AI Mode Scraper', category: 'search', bestFor: 'Google AI Overview extraction, AI-generated answers', isFree: false },
  { id: 'lucrateresults/my-actor-2', label: 'SEO Google SERP Scraper', category: 'search', bestFor: 'Google ads + organic results for SEO analysis', isFree: false },
  { id: 'vtrdev/google-search-results-serp-scraper', label: 'Google SERP (VTR)', category: 'search', bestFor: 'pay-per-result Google search', isFree: false },

  // ===== SOCIAL MEDIA (38) =====
  { id: 'apify/instagram-profile-scraper', label: 'Instagram Profile Scraper', category: 'social', bestFor: 'Instagram bio, followers, posts count, profile data', isFree: false },
  { id: 'apify/instagram-reel-scraper', label: 'Instagram Reel Scraper', category: 'social', bestFor: 'Instagram reels, video content, engagement', isFree: false },
  { id: 'apify/instagram-post-scraper', label: 'Instagram Post Scraper', category: 'social', bestFor: 'Instagram posts, captions, comments, likes', isFree: false },
  { id: 'streamers/youtube-scraper', label: 'YouTube Scraper', category: 'social', bestFor: 'YouTube video data, views, descriptions, channel info', isFree: false },
  { id: 'streamers/youtube-shorts-scraper', label: 'YouTube Shorts Scraper', category: 'social', bestFor: 'YouTube Shorts content and engagement', isFree: false },
  { id: 'streamers/youtube-comments-scraper', label: 'YouTube Comments Scraper', category: 'social', bestFor: 'YouTube comment threads, sentiment, commenter info', isFree: false },
  { id: 'streamers/youtube-channel-scraper', label: 'YouTube Channel Scraper', category: 'social', bestFor: 'YouTube channel stats, video list, about info', isFree: false },
  { id: 'apify/instagram-search-scraper', label: 'Instagram Search Scraper', category: 'social', bestFor: 'Instagram hashtag search, location search, user discovery', isFree: false },
  { id: 'streamers/youtube-video-downloader', label: 'YouTube Video Downloader', category: 'social', bestFor: 'download YouTube videos for evidence preservation', isFree: false },
  { id: 'tri_angle/social-media-sentiment-analysis-tool', label: 'Social Media Sentiment Tool', category: 'social', bestFor: 'sentiment analysis across platforms, public opinion', isFree: false },
  { id: 'afanasenko/instagram-profile-scraper', label: 'Instagram Profile (Alt)', category: 'social', bestFor: 'Instagram profile backup scraper', isFree: false },
  { id: 'kaitoeasyapi/twitter-reply', label: 'Twitter Reply Scraper', category: 'social', bestFor: 'Twitter/X tweet replies, conversation threads', isFree: false },
  { id: 'novi/advanced-search-tiktok-api', label: 'TikTok Search API', category: 'social', bestFor: 'TikTok video search, user search, trending content', isFree: false },
  { id: 'apify/facebook-video-search-scraper', label: 'Facebook Video Search', category: 'social', bestFor: 'Facebook video content, public video search', isFree: false },
  { id: 'agentx/video-transcript', label: 'Video Transcript', category: 'social', bestFor: 'YouTube/video transcription, speech to text', isFree: false },
  { id: 'streamers/youtube-video-scraper-by-hashtag', label: 'YouTube Hashtag Scraper', category: 'social', bestFor: 'YouTube videos by hashtag, topic research', isFree: false },
  { id: 'tri_angle/yelp-review-scraper', label: 'Yelp Review Scraper', category: 'social', bestFor: 'Yelp reviews, business ratings, customer complaints', isFree: false },
  { id: 'apify/influencer-discovery-agent', label: 'Influencer Discovery', category: 'social', bestFor: 'find influencers, social media reach analysis', isFree: false },
  { id: 'scrape-creators/best-tiktok-video-scraper', label: 'TikTok Video Scraper', category: 'social', bestFor: 'TikTok video download, metadata, engagement', isFree: false },
  { id: 'manju4k/social-media-trend-scraper-6-in-1-ai-analysis', label: 'Social Trend Scraper 6-in-1', category: 'social', bestFor: 'multi-platform trend analysis with AI', isFree: false },
  { id: 'caprolok/all-social-media-posts-extractor-by-hashtag-and-username', label: 'All Social Posts Extractor', category: 'social', bestFor: 'cross-platform posts by hashtag or username', isFree: false },
  { id: 'akash9078/youtube-transcript-extractor', label: 'YouTube Transcript Extractor', category: 'social', bestFor: 'fast YouTube transcript extraction, captions', isFree: false },
  { id: 'apidojo/tiktok-scraper-api', label: 'TikTok Scraper API', category: 'social', bestFor: 'TikTok analytics, influencer data', isFree: false },
  { id: 'futurizerush/meta-threads-scraper-zh-tw', label: 'Meta Threads Scraper', category: 'social', bestFor: 'Meta Threads posts, user search', isFree: false },
  { id: 'devil_port369-owner/tiktok-profile-scraper', label: 'TikTok Profile Scraper', category: 'social', bestFor: 'TikTok user profile, follower count, bio', isFree: false },
  { id: 'insiteco/social-insight-scraper', label: 'Social Insight Scraper', category: 'social', bestFor: 'social media analytics, engagement metrics', isFree: false },
  { id: 'saswave/facebook-company-page-scraper', label: 'Facebook Page Scraper', category: 'social', bestFor: 'Facebook business pages, company info, posts', isFree: false },
  { id: 'davideareias1/google-maps-email-phone-and-social-media-extrator', label: 'Google Maps Contact Extractor', category: 'social', bestFor: 'business contact info from Google Maps listings', isFree: false },
  { id: 'caprolok/all-social-media-profile-details-extractor', label: 'All Social Profile Extractor', category: 'social', bestFor: 'cross-platform profile aggregation, identity research', isFree: false },
  { id: 'devninja/facebook-profiles-pages-scraper', label: 'Facebook Profile Scraper', category: 'social', bestFor: 'Facebook public profiles, pages, about info', isFree: false },
  { id: 'social_media_scraper/instagram-video-scraper', label: 'Instagram Video Scraper', category: 'social', bestFor: 'Instagram video download, reel archival', isFree: false },
  { id: 'muhammad_noman_riaz/instagram-post-super-scraper', label: 'Instagram Post Super Scraper', category: 'social', bestFor: 'bulk Instagram post extraction', isFree: false },
  { id: 'devninja/facebook-post-scraper', label: 'Facebook Post Scraper', category: 'social', bestFor: 'Facebook public posts, comments, reactions', isFree: false },
  { id: 'igview-owner/instagram-highlights-stories-viewer', label: 'Instagram Stories Viewer', category: 'social', bestFor: 'Instagram highlights, stories, ephemeral content', isFree: false },
  { id: 'igview-owner/tiktok-data-scarper', label: 'TikTok Trending Scraper', category: 'social', bestFor: 'TikTok trending videos, viral content', isFree: false },
  { id: 'igview-owner/facebook-page-photos-downloader', label: 'Facebook Photos Downloader', category: 'social', bestFor: 'Facebook page photo albums, image evidence', isFree: false },
  { id: 'easyapi/reddit-insights-analyzer', label: 'Reddit Insights Analyzer', category: 'social', bestFor: 'Reddit threads, subreddit analysis, user history', isFree: false },
  { id: 'twitterapi/twitter-get-followersids', label: 'Twitter Followers Scraper', category: 'social', bestFor: 'Twitter/X follower lists, network mapping', isFree: false },

  // ===== LINKEDIN (18) =====
  { id: 'dev_fusion/Linkedin-Company-Scraper', label: 'LinkedIn Company Scraper', category: 'linkedin', bestFor: 'LinkedIn company profiles, employee count, industry, no cookies needed', isFree: false },
  { id: 'harvestapi/linkedin-post-search', label: 'LinkedIn Post Search', category: 'linkedin', bestFor: 'LinkedIn post search, content discovery, no cookies', isFree: false },
  { id: 'harvestapi/linkedin-profile-posts', label: 'LinkedIn Profile Posts', category: 'linkedin', bestFor: 'LinkedIn user posts, activity feed, no cookies', isFree: false },
  { id: 'anchor/linkedin-profile-enrichment', label: 'LinkedIn Profile Enrichment', category: 'linkedin', bestFor: 'LinkedIn profile data, career history, skills, lead enrichment', isFree: false },
  { id: 'apimaestro/linkedin-company-detail', label: 'LinkedIn Company Detail', category: 'linkedin', bestFor: 'LinkedIn company details, specialties, headquarters, no cookies', isFree: false },
  { id: 'harvestapi/linkedin-company-posts', label: 'LinkedIn Company Posts', category: 'linkedin', bestFor: 'LinkedIn company feed, corporate communications', isFree: false },
  { id: 'pratikdani/linkedin-company-profile-scraper', label: 'LinkedIn Company Profile', category: 'linkedin', bestFor: 'LinkedIn company overview, funding, size', isFree: false },
  { id: 'boneswill/leads-generator', label: 'LinkedIn Leads Generator', category: 'linkedin', bestFor: 'LinkedIn leads with emails, Apollo alternative', isFree: false },
  { id: 'bestscrapers/fresh-linkedin-profile-data', label: 'Fresh LinkedIn Profile Data', category: 'linkedin', bestFor: 'up-to-date LinkedIn profiles, real-time data', isFree: false },
  { id: 'icypeas_official/linkedin-profile-scraper', label: 'LinkedIn Profile (IcyPeas)', category: 'linkedin', bestFor: 'LinkedIn profile extraction', isFree: false },
  { id: 'scrapeverse/linkedin-company-profile-id-to-slug-finder', label: 'LinkedIn ID to Slug', category: 'linkedin', bestFor: 'resolve LinkedIn company ID to URL slug', isFree: true },
  { id: 'icypeas_official/linkedin-company-scraper', label: 'LinkedIn Company (IcyPeas)', category: 'linkedin', bestFor: 'LinkedIn company data extraction', isFree: false },
  { id: 'riceman/linkedin-company-data-insights-scraper', label: 'LinkedIn Company Insights', category: 'linkedin', bestFor: 'LinkedIn company analytics, growth data, no cookies', isFree: false },
  { id: 'rigelbytes/linkedin-company-details', label: 'LinkedIn Company Details', category: 'linkedin', bestFor: 'LinkedIn company metadata', isFree: false },
  { id: 'emastra/linkedin-company-scraper', label: 'LinkedIn Company (Public)', category: 'linkedin', bestFor: 'LinkedIn public company data', isFree: false },
  { id: 'datadoping/linkedin-company-scraper', label: 'LinkedIn Company (DataDoping)', category: 'linkedin', bestFor: 'LinkedIn company details, no cookie required', isFree: false },
  { id: 'pratikdani/discover-linkedin-company-posts', label: 'LinkedIn Company Posts Discovery', category: 'linkedin', bestFor: 'discover LinkedIn company content, recent posts', isFree: false },
  { id: 'silentflow/linkedin-profiles-companies-scraper-ppr', label: 'LinkedIn Profiles+Companies', category: 'linkedin', bestFor: 'combined LinkedIn profiles and companies scraping', isFree: false },

  // ===== NEWS & ACADEMIC (5) =====
  { id: 'easyapi/google-news-scraper', label: 'Google News Scraper', category: 'news', bestFor: 'Google News articles, breaking news, topic monitoring', isFree: false },
  { id: 'scrapestorm/google-news-scraper-fast-cheap-pay-per-results', label: 'Google News (Fast/Cheap)', category: 'news', bestFor: 'bulk news scraping, budget news collection', isFree: false },
  { id: 'proscraper/newsarticlescraper', label: 'News Article Scraper (LLM)', category: 'news', bestFor: 'news articles formatted for LLM ingestion', isFree: false },
  { id: 'scrapestorm/pubmed-articles-scraper---pay-per-results', label: 'PubMed Scraper', category: 'news', bestFor: 'medical research, academic papers, PubMed', isFree: false },
  { id: 'inquisitive_sarangi/news-article-scraper', label: 'Tech News Scraper', category: 'news', bestFor: 'technology news, tech industry articles', isFree: false },

  // ===== OSINT / PEOPLE SEARCH (2) =====
  { id: 'peterasorensen/snacci', label: 'Deep People Search (Snacci)', category: 'osint', bestFor: 'email lookup, phone lookup, social media profiles, people search, OSINT', isFree: false },
  { id: 'easyapi/twitter-x-personality-analyzer', label: 'Twitter/X Personality Analyzer', category: 'osint', bestFor: 'personality profiling from Twitter activity', isFree: false },

  // ===== COURT & LEGAL (1) =====
  { id: 'lofomachines/epstein-files-scraper-api', label: 'Epstein Files Scraper', category: 'legal', bestFor: 'court document scraping, legal files download', isFree: false },

  // ===== EMAIL / PHONE / CONTACT FINDERS (13) =====
  { id: 'lukaskrivka/google-maps-with-contact-details', label: 'Google Maps Email Extractor', category: 'contact', bestFor: 'business emails from Google Maps, contact details, phone numbers', isFree: false },
  { id: 'code_crafter/leads-finder', label: 'Leads Finder', category: 'contact', bestFor: 'email addresses, leads with contact info, Apollo alternative', isFree: false },
  { id: 'microworlds/leads-generator', label: 'Leads Generator', category: 'contact', bestFor: 'bulk lead generation, email discovery', isFree: false },
  { id: 'danny.hub/all-in-social-media-phone-number', label: 'Social Media Phone Scraper', category: 'contact', bestFor: 'phone numbers from social media profiles', isFree: false },
  { id: 'icypeas_official/bulk-email-finder', label: 'Bulk Email Finder', category: 'contact', bestFor: 'find email addresses in bulk, domain email discovery', isFree: false },
  { id: 'danny.hub/all-in-social-media-email', label: 'Social Media Email Scraper', category: 'contact', bestFor: 'email addresses from social media accounts', isFree: false },
  { id: 'chitosibug3/social-media-email-scraper-2026', label: 'Social Email Scraper 2026', category: 'contact', bestFor: 'current social media email extraction', isFree: false },
  { id: 'dominic-quaiser/imprint-contact-scraper', label: 'Imprint Contact Scraper', category: 'contact', bestFor: 'corporate contact info, imprint pages, decision makers', isFree: false },
  { id: 'ryanclinton/website-contact-scraper', label: 'Website Contact Scraper', category: 'contact', bestFor: 'website contact pages, about us pages, team info', isFree: false },
  { id: 'direct_houseboat/all-in-one-social-media-email-scraper', label: 'All-in-One Email Scraper', category: 'contact', bestFor: 'cross-platform email extraction', isFree: false },
  { id: 'cdubiel/lead-scraper', label: 'LeadScraper', category: 'contact', bestFor: 'lead data with contact information', isFree: false },
  { id: 'expanditumarca/b2b-lead-data-scraper', label: 'B2B Lead Scraper', category: 'contact', bestFor: 'business-to-business contacts, company emails', isFree: false },
  { id: 'caprolok/all-social-media-emails-extractor-by-keyword', label: 'Social Email by Keyword', category: 'contact', bestFor: 'find social media emails by keyword search', isFree: false },

  // ===== BUSINESS & NONPROFIT RESEARCH (15) =====
  { id: 'michael.g/y-combinator-scraper', label: 'Y Combinator Scraper', category: 'business', bestFor: 'YC startups, funding data, company profiles', isFree: false },
  { id: 'davidsharadbhatt/crunchbase-scraper-extract-crunchbase-data-unlimited-no-api', label: 'Crunchbase Scraper', category: 'business', bestFor: 'Crunchbase company data, funding rounds, investors', isFree: false },
  { id: 'easyapi/company-research-intelligence-tool', label: 'Company Research Intel', category: 'business', bestFor: 'company intelligence, corporate research, background checks', isFree: false },
  { id: 'johnvc/startup-investors-data-scraper', label: 'Startup Investors Scraper', category: 'business', bestFor: 'investor data, VC firms, funding sources', isFree: false },
  { id: 'piotrv1001/clutch-listings-scraper', label: 'Clutch.co Scraper', category: 'business', bestFor: 'IT companies, service providers, B2B listings', isFree: false },
  { id: 'louisdeconinck/ai-company-researcher-agent', label: 'AI Company Researcher', category: 'business', bestFor: 'automated company research, AI-driven corporate analysis', isFree: false },
  { id: 'radeance/handelsregister-api', label: 'Handelsregister API', category: 'business', bestFor: 'German business registry, company registration', isFree: false },
  { id: 'saswave/europages-scraper', label: 'Europages Scraper', category: 'business', bestFor: 'European B2B directory, international companies', isFree: false },
  { id: 'naive_zing/skraper', label: 'Company Enrichment (Skraper)', category: 'business', bestFor: 'company data enrichment, business intelligence', isFree: false },
  { id: 'ecomdate/builtwith-domain-scraper', label: 'BuiltWith Domain Scraper', category: 'business', bestFor: 'technology stack detection, what sites are built with', isFree: false },
  { id: 'vivid_astronaut/company-enrichment', label: 'Company Enrichment', category: 'business', bestFor: 'company metadata enrichment, industry classification', isFree: false },
  { id: 'vulnv/crunchbase-scraper-pro', label: 'Crunchbase Pro Scraper', category: 'business', bestFor: 'advanced Crunchbase data, detailed funding history', isFree: false },
  { id: 'dhrumil/company-house-scraper', label: 'Companies House Scraper', category: 'business', bestFor: 'UK company registry, director filings, registered agents', isFree: false },
  { id: 'azzouzana/local-ch-search-results-scraper-ppr', label: 'Local.ch Scraper', category: 'business', bestFor: 'Swiss business directory, local companies', isFree: false },
  { id: 'davidsharadbhatt/global-venture-capital-vc-investors-database-50-000-firms', label: 'Global VC Database', category: 'business', bestFor: 'venture capital firms worldwide, investor database', isFree: false },
];

/**
 * Build a compact text block for injection into the Planner system prompt.
 * Groups actors by category with one line per actor.
 */
export function buildRegistryPromptBlock(): string {
  const categories = new Map<string, ActorEntry[]>();
  for (const actor of ACTOR_REGISTRY) {
    const list = categories.get(actor.category) ?? [];
    list.push(actor);
    categories.set(actor.category, list);
  }

  const CATEGORY_LABELS: Record<string, string> = {
    web: 'Web Scraping & Content Extraction',
    search: 'Google Search / SERP',
    social: 'Social Media',
    linkedin: 'LinkedIn',
    news: 'News & Academic',
    osint: 'OSINT / People Search',
    legal: 'Court & Legal',
    contact: 'Email / Phone / Contact Finders',
    business: 'Business & Nonprofit Research',
  };

  const sections: string[] = [];
  for (const [cat, actors] of categories.entries()) {
    const label = CATEGORY_LABELS[cat] ?? cat;
    const lines = actors.map(
      (a) => `  ${a.id} -- ${a.bestFor}${a.isFree ? ' [FREE]' : ''}`,
    );
    sections.push(`### ${label} (${actors.length})\n${lines.join('\n')}`);
  }

  return `## APIFY ACTOR REGISTRY (${ACTOR_REGISTRY.length} actors)\n\n` +
    'Pick the actor whose "bestFor" keywords match the assignment.\n' +
    'Set actorId to the actor ID. Prefer FREE actors when quality is equal.\n\n' +
    sections.join('\n\n');
}
