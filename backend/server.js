import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Parser from "rss-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const PORT = Number(process.env.PORT || 3000);

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "AkolisTechStudio/0.4" }
});

const DEFAULT_SOURCES = [
  { id: "techcrunch", name: "TechCrunch", url: "https://techcrunch.com/feed/", type: "rss", topic: "AI", active: true },
  { id: "hacker-news", name: "Hacker News", url: "https://news.ycombinator.com/rss", type: "rss", topic: "Developer", active: true },
  { id: "the-verge", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", type: "rss", topic: "Hardware", active: true },
  { id: "ars-technica", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", type: "rss", topic: "Developer", active: true },
  { id: "github-blog", name: "GitHub Blog", url: "https://github.blog/feed/", type: "rss", topic: "Developer", active: true }
];

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(DATA_FILE); }
  catch {
    await writeStore({
      sources: DEFAULT_SOURCES.map(s => ({ ...s, addedAt: new Date().toISOString() })),
      stories: []
    });
  }
}

async function readStore() {
  return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
}
async function writeStore(store) {
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, DATA_FILE);
}
function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function fingerprint(title, source) {
  return `${source}|${title}`.toLowerCase().normalize("NFKD")
    .replace(/[^\w\s|.-]/g, "").replace(/\s+/g, " ").trim();
}
function inferTopic(text = "") {
  const t = text.toLowerCase();
  if (/\b(ai|artificial intelligence|llm|model|agent)\b/.test(t)) return "AI";
  if (/\b(github|developer|coding|software|programming|javascript|python)\b/.test(t)) return "Developer";
  if (/\b(startup|funding|venture|founder)\b/.test(t)) return "Startups";
  if (/\b(cloud|aws|azure|infrastructure)\b/.test(t)) return "Cloud";
  if (/\b(security|cyber|hack|malware)\b/.test(t)) return "Cybersecurity";
  if (/\b(phone|chip|gpu|device|hardware|apple)\b/.test(t)) return "Hardware";
  return "Developer";
}
function scoreStory({ title = "", summary = "" }) {
  const t = `${title} ${summary}`.toLowerCase();
  let score = 55;
  for (const [pattern, boost] of [
    [/openai|anthropic|google|microsoft|apple|meta|github/, 9],
    [/launch|release|announc|new|breakthrough|acquire/, 8],
    [/developer|coding|software|api|agent/, 8],
    [/ai|llm|model|artificial intelligence/, 8],
    [/open source|github/, 6]
  ]) if (pattern.test(t)) score += boost;
  return Math.min(99, score);
}
function normalizeItem(item, source) {
  const title = String(item.title || "Untitled story").trim();
  const summary = String(item.contentSnippet || item.content || item.summary || "")
    .replace(/\s+/g, " ").trim().slice(0, 1800);
  return {
    id: crypto.randomUUID(),
    title,
    source: source.name,
    sourceId: source.id,
    url: String(item.link || item.guid || "").trim(),
    publishedAt: item.isoDate || item.pubDate || null,
    topic: source.topic || inferTopic(`${title} ${summary}`),
    summary,
    angle: "",
    score: scoreStory({ title, summary }),
    status: "New",
    fingerprint: fingerprint(title, source.name),
    importedAt: new Date().toISOString(),
    research: {
      status: "not-started",
      sourceCount: 0,
      claimCount: 0,
      angles: [],
      approvedAngle: "",
      brief: {}
    },
    researchSources: [],
    claims: []
  };
}

async function refreshFeeds() {
  const store = await readStore();
  const existing = new Map(store.stories.map(s => [s.fingerprint, s]));
  const results = [], errors = [];

  for (const source of store.sources.filter(s => s.active)) {
    try {
      const feed = await parser.parseURL(source.url);
      const items = (feed.items || []).slice(0, 30);
      let added = 0;
      for (const item of items) {
        const story = normalizeItem(item, source);
        if (!existing.has(story.fingerprint)) {
          existing.set(story.fingerprint, story);
          added++;
        }
      }
      results.push({ sourceId: source.id, source: source.name, fetched: items.length, added, ok: true });
    } catch (error) {
      errors.push({ sourceId: source.id, source: source.name, ok: false,
        error: error instanceof Error ? error.message : String(error) });
    }
  }

  const stories = [...existing.values()].sort(
    (a, b) => new Date(b.publishedAt || b.importedAt) - new Date(a.publishedAt || a.importedAt)
  );
  await writeStore({ ...store, stories });
  return { added: results.reduce((n, r) => n + r.added, 0), results, errors, stories, sources: store.sources };
}

function getStoryOrThrow(store, id) {
  const story = store.stories.find(s => s.id === id);
  if (!story) throw new Error("Story not found");
  story.research ||= { status: "not-started", sourceCount: 0, claimCount: 0, angles: [], approvedAngle: "", brief: {} };
  story.researchSources ||= [];
  story.claims ||= [];
  return story;
}

async function fetchSourceMetadata(url) {
  // Best-effort metadata only. It is deliberately not used as a full article scraper.
  try {
    const feed = await parser.parseURL(url);
    return {
      title: feed.title || "",
      description: feed.description || ""
    };
  } catch {
    return { title: "", description: "" };
  }
}

async function generateResearchDraft(story) {
  const sources = story.researchSources || [];
  const primary = sources.filter(s => s.role === "primary").map(s => s.url);
  const secondary = sources.filter(s => s.role === "secondary").map(s => s.url);

  /*
    Provider-agnostic V4:
    - If AI_PROVIDER_URL and AI_MODEL are configured, a later adapter can call it.
    - For now, this endpoint produces a useful structured draft without requiring
      an API key. This keeps the app fully usable while the research UI is built.
  */
  const fallbackBrief = {
    whatHappened: story.summary || `${story.title} was detected from ${story.source}. Verify the original announcement before publication.`,
    whyMatters: `Explain the practical significance of ${story.title}, then connect it to the needs of the target audience rather than repeating the headline.`,
    developerImpact: "Identify changes to tools, APIs, workflows, cost, performance, security or developer experience. Confirm each claim against a primary source.",
    caveats: "Distinguish verified facts from interpretation. Check dates, availability, pricing, regional limitations, benchmarks and marketing claims."
  };

  const angleTemplates = [
    {
      title: "What this actually changes",
      description: `Move beyond the announcement and explain what ${story.title} changes for developers or tech users in practice.`
    },
    {
      title: "The developer impact",
      description: `Focus on workflow, tooling, APIs, productivity and limitations. Show a concrete use case and who benefits.`
    },
    {
      title: "Hype vs reality",
      description: `Separate the strongest verified facts from marketing language and explain what remains uncertain or limited.`
    }
  ];

  story.research = {
    ...(story.research || {}),
    status: "draft",
    aiGenerated: false,
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    claimCount: (story.claims || []).length,
    brief: story.research?.brief && Object.keys(story.research.brief).length
      ? story.research.brief
      : fallbackBrief,
    angles: story.research?.angles?.length ? story.research.angles : angleTemplates,
    sourceSummary: { primary: primary.length, secondary: secondary.length }
  };

  return story;
}

async function generateAngles(story) {
  story.research ||= { status: "draft", angles: [], brief: {} };
  story.research.angles = [
    {
      title: "Explain the real change",
      description: `Translate ${story.title} into a simple before-and-after story and demonstrate what is different.`
    },
    {
      title: "What developers should do now",
      description: `Turn the news into practical decisions: who should test it, who should wait, and what to watch.`
    },
    {
      title: "The overlooked limitation",
      description: `Focus on an important limitation, dependency or unanswered question that a headline summary would miss.`
    },
    {
      title: "How it compares",
      description: `Compare the new development with the most relevant existing approach and explain the trade-offs.`
    }
  ];
  story.research.status = "draft";
  return story;
}


function draftScriptPackage(story) {
  const research=story.research||{};
  const brief=research.brief||{};
  const angle=research.approvedAngle||story.angle||`Explain what ${story.title} means in practice.`;
  const target=Number(story.script?.settings?.targetMinutes||7);
  const tone=story.script?.settings?.tone||"clear-analytical";
  const audience=story.script?.settings?.audience||"Developers and tech enthusiasts";
  const hook=`Something important just happened in tech, but the headline is only half the story. Today we're breaking down ${story.title.toLowerCase()}, what actually changed, and why it matters for ${audience.toLowerCase()}.`;
  const narration=[
    `Let's start with what happened. ${brief.whatHappened||story.summary||`The story centers on ${story.title}.`}`,
    `The reason this matters is simple: ${brief.whyMatters||`the development could change how people build, use, or think about technology.`}`,
    `For developers, the practical question is what changes in the workflow. ${brief.developerImpact||`That means looking at the tools involved, the available APIs or products, the cost and performance trade-offs, and what can actually be tested today.`}`,
    `There is also a second question: what are we not being told by the headline? ${brief.caveats||`That means separating verified facts from marketing language and being clear about limitations, availability and unanswered questions.`}`,
    `Our angle for this video is: ${angle}`,
    `So rather than treating this as just another technology launch, the useful takeaway is to understand what changes now, what does not, and what developers should watch next.`
  ].join("\n\n");
  const outro=`If this breakdown helped you understand what changed and why it matters, subscribe for more practical AI and developer technology explainers.`;
  return {status:"draft",aiGenerated:false,generatedAt:new Date().toISOString(),settings:{...(story.script?.settings||{}),targetMinutes:target,tone,audience,approvedAngle:angle},title:story.title,hook,narration,outro,durationMinutes:target,scenes:buildScenes(story,{hook,narration,outro,target})};
}
function buildScenes(story,script) {
  const chunks=[
    {title:"The hook",type:"cinematic",voiceover:script.hook,visual:`Fast, cinematic introduction to ${story.title}; modern technology newsroom mood; no text baked into the image.`,onscreen:"WHAT JUST CHANGED?",assetSource:"Flow"},
    {title:"What happened",type:"explainer",voiceover:(story.research?.brief?.whatHappened||story.summary||script.narration.split("\n\n")[0]),visual:`Clean technology explainer visuals for ${story.title}; use abstract product and developer imagery, avoid invented UI details.`,onscreen:"WHAT HAPPENED",assetSource:"Flow"},
    {title:"Why it matters",type:"analysis",voiceover:story.research?.brief?.whyMatters||"Explain the practical significance.",visual:`Developer-focused visual showing the practical consequence of the technology; realistic workstation and software workflow.`,onscreen:"WHY IT MATTERS",assetSource:"Flow"},
    {title:"Developer impact",type:"demo",voiceover:story.research?.brief?.developerImpact||"Show the concrete developer impact.",visual:`Actual screen recording or official product demonstration should be used here where available.`,onscreen:"FOR DEVELOPERS",assetSource:"Creator footage / official source"},
    {title:"Limits and caveats",type:"analysis",voiceover:story.research?.brief?.caveats||"Explain limitations and uncertainty.",visual:`Minimal, serious visual metaphor for limitations, trade-offs and uncertainty.`,onscreen:"THE CATCH",assetSource:"Flow"},
    {title:"What to do next",type:"conclusion",voiceover:script.outro,visual:`Confident closing shot of a developer finishing a technology project; subtle cinematic motion.`,onscreen:"WHAT SHOULD YOU DO?",assetSource:"Flow"}
  ];
  return chunks.map((scene,i)=>({
    id:crypto.randomUUID(),title:scene.title,type:scene.type,duration:i===0?"0:00–0:15":`Scene ${i+1}`,
    voiceover:scene.voiceover,visual:scene.visual,onscreen:scene.onscreen,assetSource:scene.assetSource,
    assetRequirements:[{id:"visual",type:scene.assetSource.includes("Creator")?"screen-recording":"b-roll",description:scene.visual,source:scene.assetSource,required:true,completed:false}],
    flowPrompts:scene.assetSource.includes("Flow")?[`Cinematic technology video shot for a faceless YouTube explainer: ${scene.visual}. Realistic, polished, professional, no logos unless provided, no fabricated readable UI text, 16:9, natural motion, clean composition.`]:[]
  }));
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS"
    });
    return res.end();
  }

  if (req.method === "GET" && pathname === "/api/health")
    return json(res, 200, { ok: true, service: "akolis-tech-studio-api", version: "0.4.0", time: new Date().toISOString() });

  const store = await readStore();

  if (req.method === "GET" && pathname === "/api/sources") return json(res, 200, store.sources);

  if (req.method === "POST" && pathname === "/api/sources") {
    const data = await body(req);
    if (!data.name || !data.url) return json(res, 400, { error: "name and url are required" });
    if (store.sources.some(s => s.url === data.url)) return json(res, 409, { error: "Source URL already exists." });
    const source = {
      id: crypto.randomUUID(),
      name: String(data.name).trim(),
      url: String(data.url).trim(),
      type: data.type || "rss",
      topic: data.topic || inferTopic(data.name),
      active: true,
      addedAt: new Date().toISOString()
    };
    store.sources.unshift(source);
    await writeStore(store);
    return json(res, 201, source);
  }

  const sourceMatch = pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (sourceMatch) {
    const id = decodeURIComponent(sourceMatch[1]);
    const index = store.sources.findIndex(s => s.id === id);
    if (index < 0) return json(res, 404, { error: "Source not found" });

    if (req.method === "PATCH") {
      const data = await body(req);
      store.sources[index] = { ...store.sources[index], ...data };
      await writeStore(store);
      return json(res, 200, store.sources[index]);
    }
    if (req.method === "DELETE") {
      const deleted = store.sources.splice(index, 1)[0];
      await writeStore(store);
      return json(res, 200, deleted);
    }
  }

  if (req.method === "GET" && pathname === "/api/stories") {
    const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
    return json(res, 200, store.stories.slice(0, limit));
  }

  const storyMatch = pathname.match(/^\/api\/stories\/([^/]+)$/);
  if (storyMatch && req.method === "GET") {
    const story = getStoryOrThrow(store, decodeURIComponent(storyMatch[1]));
    return json(res, 200, story);
  }
  if (storyMatch && req.method === "PATCH") {
    const story = getStoryOrThrow(store, decodeURIComponent(storyMatch[1]));
    const data = await body(req);
    if (typeof data.angle === "string") story.angle = data.angle;
    if (data.research) story.research = { ...story.research, ...data.research };
    if (data.script) story.script = { ...(story.script || {}), ...data.script };
    if (typeof data.status === "string") story.status = data.status;
    await writeStore(store);
    return json(res, 200, story);
  }

  const sourceAttachMatch = pathname.match(/^\/api\/stories\/([^/]+)\/sources$/);
  if (sourceAttachMatch && req.method === "POST") {
    const story = getStoryOrThrow(store, decodeURIComponent(sourceAttachMatch[1]));
    const data = await body(req);
    if (!data.url) return json(res, 400, { error: "url is required" });

    let meta = {};
    try { meta = await fetchSourceMetadata(data.url); } catch {}
    const exists = story.researchSources.some(s => s.url === data.url);
    if (exists) return json(res, 409, { error: "This research source is already attached." });

    story.researchSources.push({
      id: crypto.randomUUID(),
      url: String(data.url).trim(),
      role: data.role || "secondary",
      title: meta.title || "",
      addedAt: new Date().toISOString()
    });
    story.research ||= {};
    story.research.sourceCount = story.researchSources.length;
    story.research.status = "in-progress";
    await writeStore(store);
    return json(res, 201, story);
  }

  const sourceDeleteMatch = pathname.match(/^\/api\/stories\/([^/]+)\/sources\/([^/]+)$/);
  if (sourceDeleteMatch && req.method === "DELETE") {
    const story = getStoryOrThrow(store, decodeURIComponent(sourceDeleteMatch[1]));
    const sourceId = decodeURIComponent(sourceDeleteMatch[2]);
    story.researchSources = story.researchSources.filter(s => s.id !== sourceId);
    story.research.sourceCount = story.researchSources.length;
    await writeStore(store);
    return json(res, 200, story);
  }

  const claimMatch = pathname.match(/^\/api\/stories\/([^/]+)\/claims$/);
  if (claimMatch && req.method === "POST") {
    const story = getStoryOrThrow(store, decodeURIComponent(claimMatch[1]));
    const data = await body(req);
    if (!data.text) return json(res, 400, { error: "Claim text is required." });
    story.claims.push({
      id: crypto.randomUUID(),
      text: String(data.text).trim(),
      confidence: data.confidence || "medium",
      sourceIds: Array.isArray(data.sourceIds) ? data.sourceIds : [],
      createdAt: new Date().toISOString()
    });
    story.research.claimCount = story.claims.length;
    story.research.status = "in-progress";
    await writeStore(store);
    return json(res, 201, story);
  }

  const claimDeleteMatch = pathname.match(/^\/api\/stories\/([^/]+)\/claims\/([^/]+)$/);
  if (claimDeleteMatch && req.method === "DELETE") {
    const story = getStoryOrThrow(store, decodeURIComponent(claimDeleteMatch[1]));
    const claimId = decodeURIComponent(claimDeleteMatch[2]);
    story.claims = story.claims.filter(c => c.id !== claimId);
    story.research.claimCount = story.claims.length;
    await writeStore(store);
    return json(res, 200, story);
  }

  const researchGenerateMatch = pathname.match(/^\/api\/stories\/([^/]+)\/research\/generate$/);
  if (researchGenerateMatch && req.method === "POST") {
    const story = getStoryOrThrow(store, decodeURIComponent(researchGenerateMatch[1]));
    const updated = await generateResearchDraft(story);
    await writeStore(store);
    return json(res, 200, updated);
  }

  const angleGenerateMatch = pathname.match(/^\/api\/stories\/([^/]+)\/angles\/generate$/);
  if (angleGenerateMatch && req.method === "POST") {
    const story = getStoryOrThrow(store, decodeURIComponent(angleGenerateMatch[1]));
    const updated = await generateAngles(story);
    await writeStore(store);
    return json(res, 200, updated);
  }


  const scriptGenerateMatch = pathname.match(/^\/api\/stories\/([^/]+)\/script\/generate$/);
  if (scriptGenerateMatch && req.method === "POST") {
    const story = getStoryOrThrow(store, decodeURIComponent(scriptGenerateMatch[1]));
    story.script = draftScriptPackage(story);
    story.status = "Script";
    await writeStore(store);
    return json(res, 200, story);
  }

  const sceneGenerateMatch = pathname.match(/^\/api\/stories\/([^/]+)\/script\/scenes\/generate$/);
  if (sceneGenerateMatch && req.method === "POST") {
    const story = getStoryOrThrow(store, decodeURIComponent(sceneGenerateMatch[1]));
    story.script ||= draftScriptPackage(story);
    story.script.scenes = buildScenes(story, story.script);
    await writeStore(store);
    return json(res, 200, story);
  }

  if (req.method === "POST" && pathname === "/api/feeds/refresh")
    return json(res, 200, await refreshFeeds());

  return json(res, 404, { error: "API route not found" });
}

async function serveFile(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname === "/") pathname = "/index.html";
  const safe = path.normalize(path.join(ROOT, pathname));
  if (!safe.startsWith(ROOT)) return json(res, 403, { error: "Forbidden" });
  try {
    const file = await fs.readFile(safe);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[path.extname(safe).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(file);
  } catch {
    return json(res, 404, { error: "Not found" });
  }
}

await ensureStore();

http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) await handleApi(req, res);
    else await serveFile(req, res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "Internal server error", detail: error.message });
  }
}).listen(PORT, () => console.log(`Akolis Tech Studio V4 running at http://localhost:${PORT}`));
