import http from "node:http";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Parser from "rss-parser";
import Busboy from "busboy";
import { EdgeTTS } from "@travisvn/edge-tts";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT        = path.resolve(__dirname, "..");
const DATA_DIR    = path.join(__dirname, "data");
const DATA_FILE   = path.join(DATA_DIR, "store.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const RENDERS_DIR = path.join(__dirname, "renders");
const TMP_DIR      = path.join(__dirname, "tmp");
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
  await fs.mkdir(DATA_DIR,    { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(RENDERS_DIR, { recursive: true });
  await fs.mkdir(TMP_DIR,     { recursive: true });
  try { await fs.access(DATA_FILE); }
  catch {
    await writeStore({
      sources:       DEFAULT_SOURCES.map(s => ({ ...s, addedAt: new Date().toISOString() })),
      stories:       [],
      projects:      [],
      renderJobs:    [],
      autopilotJobs: []
    });
  }
  // Migrate existing stores that pre-date projects / renderJobs / autopilotJobs fields.
  const store = await readStore();
  let dirty = false;
  if (!store.projects)      { store.projects      = []; dirty = true; }
  if (!store.renderJobs)    { store.renderJobs    = []; dirty = true; }
  if (!store.autopilotJobs) { store.autopilotJobs = []; dirty = true; }
  if (dirty) await writeStore(store);
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

// ── V8 Media Engine: render presets & content-aware helpers ──────────────────

const RENDER_PRESETS = {
  "long-form": { width: 1920, height: 1080, cropMode: "pad",  useShortHighlights: false, label: "YouTube Long-form (16:9)" },
  "short":     { width: 1080, height: 1920, cropMode: "crop", useShortHighlights: true,  label: "YouTube Shorts (9:16)" },
  "square":    { width: 1080, height: 1080, cropMode: "crop", useShortHighlights: false, label: "Square (1:1)" }
};

// Detects video/audio/image/file from the MIME type, falling back to file
// extension when the browser or client sends a generic type (e.g. some
// voice-recorder exports and curl's default MIME guessing use
// application/octet-stream for common formats like .m4a).
const EXT_MEDIA_TYPES = {
  mp4: "video", mov: "video", webm: "video", mkv: "video", avi: "video",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio", flac: "audio",
  jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image"
};
function detectMediaType(mimeType, filename) {
  if (mimeType.startsWith("video")) return "video";
  if (mimeType.startsWith("audio")) return "audio";
  if (mimeType.startsWith("image")) return "image";
  const ext = path.extname(filename).slice(1).toLowerCase();
  return EXT_MEDIA_TYPES[ext] || "file";
}

// Probes a media file's duration in seconds via ffprobe. Returns null on failure.
async function ffprobeDuration(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath
    ]);
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? seconds : null;
  } catch {
    return null;
  }
}

// Escapes text for safe use inside an ffmpeg drawtext filter argument.
function escapeDrawtext(text = "") {
  return String(text)
    .replace(/\\/g, "\\\\\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")   // drawtext can't escape single quotes reliably; use a typographic apostrophe
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

// Registers a production asset (footage / voiceover / music) on a story,
// probing duration for audio/video and wiring up the same scene-timing +
// caption + music-mix side effects regardless of whether the file came from
// a manual upload, Google TTS, or a stock-footage fetch. `source` records
// provenance ("creator" | "tts-google" | "stock-pexels").
async function registerProductionAsset(story, storyId, {
  filePath, fileName, mimeType, role, sceneId = null, requirementId = null, source = "creator"
}) {
  const stat = await fs.stat(filePath);
  const mediaType = detectMediaType(mimeType, fileName);
  const duration = (mediaType === "audio" || mediaType === "video")
    ? await ffprobeDuration(filePath)
    : null;

  const asset = {
    id:            crypto.randomUUID(),
    fileName,
    path:          filePath,
    url:           `/media/uploads/${storyId}/${path.basename(filePath)}`,
    mediaType,
    role,
    duration,
    size:          stat.size,
    status:        "ready",
    source,
    sceneId,
    requirementId,
    uploadedAt:    new Date().toISOString()
  };

  story.production        ||= { assets: [] };
  story.production.assets ||= [];
  story.production.assets.push(asset);

  if (role === "voiceover" && asset.sceneId) {
    const scenes = story.script?.scenes || [];
    const scene  = scenes.find(s => s.id === asset.sceneId);
    if (scene) {
      scene.voiceoverAssetId = asset.id;
      scene.durationSeconds  = asset.duration || scene.durationSeconds || 0;
      scene.captions         = buildCaptionChunks(scene.voiceover || "", scene.durationSeconds);
      if (scene.captionsEnabled === undefined) scene.captionsEnabled = true;
    }
  }

  if (role === "music") {
    story.production.music = {
      assetId: asset.id,
      volume:  story.production.music?.volume ?? 0.15,
      enabled: true
    };
  }

  return asset;
}

// Synthesizes narration audio for a single scene using Microsoft Edge's
// online neural TTS service (via the unofficial @travisvn/edge-tts client).
// No API key or billing account required. This talks to an internal,
// unofficial Microsoft endpoint rather than a published/supported API —
// it's free and reliable in practice, but could break without notice if
// Microsoft changes that endpoint. Voice defaults to EDGE_TTS_VOICE or
// "en-US-EmmaMultilingualNeural"; see the full voice list via the
// package's listVoices() helper if you want to pick a different one.
async function synthesizeVoiceover(text, destPath) {
  const voice = process.env.EDGE_TTS_VOICE || "en-US-EmmaMultilingualNeural";
  const tts = new EdgeTTS(text, voice);
  let result;
  try {
    result = await tts.synthesize();
  } catch (error) {
    throw new Error(`Edge TTS request failed: ${error.message}`);
  }
  const buffer = Buffer.from(await result.audio.arrayBuffer());
  if (!buffer.length) throw new Error("Edge TTS returned no audio content.");
  await fs.writeFile(destPath, buffer);
}

// Fetches a stock b-roll clip matching a text query via the Pexels Videos
// API. Requires PEXELS_API_KEY. Picks the largest MP4 file up to 1920px
// wide (falls back to the largest available if no "hd" entry exists).
async function fetchStockFootage(query, destPath) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY is not configured on the server.");

  const searchUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
  const searchRes = await fetch(searchUrl, { headers: { Authorization: apiKey } });
  if (!searchRes.ok) throw new Error(`Pexels search failed (${searchRes.status}).`);
  const data  = await searchRes.json();
  const video = (data.videos || [])[0];
  if (!video) throw new Error(`No stock footage found for "${query}".`);

  const files = (video.video_files || []).filter(f => f.file_type === "video/mp4");
  const pick  = files.find(f => f.quality === "hd" && f.width <= 1920)
    || files.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  if (!pick) throw new Error(`No downloadable file found for "${query}".`);

  const fileRes = await fetch(pick.link);
  if (!fileRes.ok) throw new Error(`Failed to download stock footage (${fileRes.status}).`);
  await fs.writeFile(destPath, Buffer.from(await fileRes.arrayBuffer()));
}

// Runs the full hands-off pipeline for one story: verifies an approved
// angle exists (this is the one input we deliberately don't automate —
// see logs/2026-08-20), generates the script/scenes if missing, fills in
// any scene missing a voiceover via Google TTS and any scene missing
// footage via Pexels stock search, then queues a long-form render. Publish
// stays a separate, manual step.
async function runAutopilot(jobId) {
  const store = await readStore();
  const job   = (store.autopilotJobs || []).find(j => j.id === jobId);
  if (!job) return;
  const story = store.stories.find(s => s.id === job.storyId);
  if (!story) return await (async () => {
    Object.assign(job, { status: "error", error: "Story not found." });
    await writeStore(store);
  })();

  const setStage = async (stage) => { job.stage = stage; await writeStore(store); };

  try {
    job.status = "running";
    await setStage("checking angle");

    if (!(story.research?.approvedAngle || story.angle)) {
      throw new Error("No approved editorial angle yet — approve one in Research Studio first.");
    }

    if (!story.script || !(story.script.scenes || []).length) {
      await setStage("writing script");
      story.script  = draftScriptPackage(story);
      story.status  = "Script";
      await writeStore(store);
    }

    const scenes = story.script.scenes || [];
    const dir    = path.join(UPLOADS_DIR, story.id);
    await fs.mkdir(dir, { recursive: true });

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      await setStage(`voiceover ${i + 1}/${scenes.length}`);
      const hasVoiceover = (story.production?.assets || [])
        .some(a => a.role === "voiceover" && a.sceneId === scene.id);
      if (!hasVoiceover && scene.voiceover) {
        try {
          const dest = path.join(dir, `${Date.now()}-tts-${scene.id}.mp3`);
          await synthesizeVoiceover(scene.voiceover, dest);
          await registerProductionAsset(story, story.id, {
            filePath: dest, fileName: path.basename(dest), mimeType: "audio/mpeg",
            role: "voiceover", sceneId: scene.id, source: "tts-google"
          });
          await writeStore(store);
        } catch (err) {
          job.warnings ||= [];
          job.warnings.push(`Scene ${i + 1} voiceover: ${err.message}`);
        }
      }
    }

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      await setStage(`visuals ${i + 1}/${scenes.length}`);
      const hasFootage = (story.production?.assets || [])
        .some(a => a.role === "footage" && a.sceneId === scene.id);
      if (!hasFootage) {
        try {
          const query = scene.onscreen || scene.title || story.title;
          const dest  = path.join(dir, `${Date.now()}-stock-${scene.id}.mp4`);
          await fetchStockFootage(query, dest);
          await registerProductionAsset(story, story.id, {
            filePath: dest, fileName: path.basename(dest), mimeType: "video/mp4",
            role: "footage", sceneId: scene.id, source: "stock-pexels"
          });
          await writeStore(store);
        } catch (err) {
          job.warnings ||= [];
          job.warnings.push(`Scene ${i + 1} visual: ${err.message}`);
        }
      }
    }

    await setStage("rendering");
    const renderJob = {
      id: crypto.randomUUID(), storyId: story.id, format: "long-form",
      presetLabel: RENDER_PRESETS["long-form"].label, status: "queued", progress: 0,
      warnings: [], createdAt: new Date().toISOString(), startedAt: null,
      completedAt: null, outputUrl: null, error: null
    };
    store.renderJobs ||= [];
    store.renderJobs.unshift(renderJob);
    job.renderJobId = renderJob.id;
    await writeStore(store);

    await _runRender(renderJob.id, story, "long-form");

    const finalStore = await readStore();
    const finalRenderJob = (finalStore.renderJobs || []).find(j => j.id === renderJob.id);
    const finalJob = (finalStore.autopilotJobs || []).find(j => j.id === jobId);
    if (finalJob) {
      finalJob.status      = finalRenderJob?.status === "error" ? "error" : "done";
      finalJob.error       = finalRenderJob?.status === "error" ? finalRenderJob.error : null;
      finalJob.outputUrl   = finalRenderJob?.outputUrl || null;
      finalJob.completedAt = new Date().toISOString();
      finalJob.stage       = "complete";
      await writeStore(finalStore);
    }
  } catch (error) {
    const errStore = await readStore();
    const errJob = (errStore.autopilotJobs || []).find(j => j.id === jobId);
    if (errJob) {
      errJob.status = "error";
      errJob.error  = error.message;
      errJob.completedAt = new Date().toISOString();
      await writeStore(errStore);
    }
  }
}

// Splits narration text into caption chunks (~7 words each) and distributes
// them proportionally across the scene duration by word count. This is a
// simple, deterministic timing model — not real forced alignment — but it
// keeps captions roughly in sync with the voiceover without requiring ASR.
function buildCaptionChunks(text = "", durationSeconds = 0) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length || !durationSeconds) return [];

  const CHUNK_SIZE = 7;
  const chunks = [];
  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    chunks.push(words.slice(i, i + CHUNK_SIZE).join(" "));
  }

  const totalWords = words.length;
  let cursorWords = 0;
  let cursorTime = 0;
  return chunks.map(chunk => {
    const chunkWords = chunk.split(/\s+/).length;
    const start = cursorTime;
    cursorWords += chunkWords;
    const end = (cursorWords / totalWords) * durationSeconds;
    cursorTime = end;
    return { text: chunk, start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) };
  });
}

// Builds the chained drawtext filter string for a scene's captions + overlays.
// Captions render as a bottom-anchored subtitle bar; overlays render as a
// large centered title (top third) or a lower-third banner, each windowed
// to its own [start, end] using ffmpeg's enable='between(t,a,b)'.
function buildDrawtextFilters(scene) {
  const filters = [];

  if (scene.captionsEnabled !== false) {
    for (const cap of scene.captions || []) {
      if (!cap.text) continue;
      filters.push(
        `drawtext=text='${escapeDrawtext(cap.text)}':fontsize=42:fontcolor=white:` +
        `box=1:boxcolor=black@0.55:boxborderw=14:x=(w-text_w)/2:y=h-160:` +
        `enable='between(t,${cap.start},${cap.end})'`
      );
    }
  }

  for (const overlay of scene.overlays || []) {
    if (!overlay.text) continue;
    const isTitle = overlay.type === "title";
    const style = isTitle
      ? `fontsize=64:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=18:x=(w-text_w)/2:y=h*0.12`
      : `fontsize=38:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=12:x=60:y=h-260`;
    filters.push(
      `drawtext=text='${escapeDrawtext(overlay.text)}':${style}:` +
      `enable='between(t,${overlay.start ?? 0},${overlay.end ?? 999})'`
    );
  }

  return filters;
}

// Returns the FFmpeg version string (first line) or null if not found.
async function detectFfmpeg() {
  try {
    const { stdout } = await execFileAsync("ffmpeg", ["-version"]);
    return stdout.split("\n")[0].trim() || "detected";
  } catch {
    return null;
  }
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

// Async FFmpeg worker — updates job status in the store, runs off the request cycle.
async function _runRender(jobId, story, presetKey) {
  const store = await readStore();
  const job   = store.renderJobs.find(j => j.id === jobId);
  if (!job) return;

  const updateJob = async (patch) => {
    Object.assign(job, patch);
    await writeStore(store);
  };

  const preset = RENDER_PRESETS[presetKey] || RENDER_PRESETS["long-form"];
  const { width, height, cropMode, useShortHighlights } = preset;
  const warnings = [];

  await updateJob({ status: "processing", startedAt: new Date().toISOString(), progress: 5, warnings });

  const jobTmpDir = path.join(TMP_DIR, jobId);
  await fs.mkdir(jobTmpDir, { recursive: true });

  try {
    const allScenes = story.script?.scenes || [];
    // Short-format renders use only scenes marked includeInShort, if any are marked;
    // otherwise fall back to the full scene list (cropped to the short frame).
    const scenes = (useShortHighlights && allScenes.some(s => s.includeInShort))
      ? allScenes.filter(s => s.includeInShort)
      : allScenes;

    if (!scenes.length) {
      return await updateJob({ status: "error", error: "No scenes available to render.", progress: 0, warnings });
    }

    const assets = story.production?.assets || [];
    const cropFilter = cropMode === "crop"
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

    // ── Step 1: render each scene to its own normalized clip (video, audio, captions, overlays burned in) ──
    const sceneClips = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const footageAsset =
        assets.find(a => a.role === "footage" && a.sceneId === scene.id && a.mediaType === "video") ||
        assets.find(a => a.role === "footage" && a.sceneId === scene.id && a.mediaType === "image");
      const voiceoverAsset = assets.find(a => a.role === "voiceover" && a.sceneId === scene.id);

      if (!footageAsset) {
        warnings.push(`Scene ${i + 1} ("${scene.title || "Untitled"}") has no footage asset — skipped.`);
        continue;
      }
      const duration = voiceoverAsset?.duration || scene.durationSeconds || 4;
      if (!voiceoverAsset) {
        warnings.push(`Scene ${i + 1} has no voiceover — using a ${duration}s fallback duration with silent audio.`);
      }

      const vf = [cropFilter, ...buildDrawtextFilters(scene)].join(",");
      const clipPath = path.join(jobTmpDir, `scene-${i}.mp4`);
      const args = ["-y"];

      if (footageAsset.mediaType === "image") args.push("-loop", "1", "-i", footageAsset.path);
      else                                     args.push("-stream_loop", "-1", "-i", footageAsset.path);

      if (voiceoverAsset) args.push("-i", voiceoverAsset.path);
      else                args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");

      args.push(
        "-t", String(duration),
        "-vf", vf,
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-shortest",
        clipPath
      );

      await execFileAsync("ffmpeg", args);
      const actualDuration = (await ffprobeDuration(clipPath)) || duration;
      sceneClips.push({ path: clipPath, duration: actualDuration });
      await updateJob({ progress: 5 + Math.round(((i + 1) / scenes.length) * 45) });
    }

    if (!sceneClips.length) {
      return await updateJob({ status: "error", error: "No scenes could be rendered — every scene is missing footage.", progress: 0, warnings });
    }

    // ── Step 2: concatenate scene clips (plain cut, or crossfade transition) ──
    const transition         = story.production?.transition || "cut";
    const transitionDuration = Math.max(0.1, Number(story.production?.transitionDuration || 0.5));
    const concatPath = path.join(jobTmpDir, "concat.mp4");
    let totalDuration;

    if (transition === "crossfade" && sceneClips.length > 1) {
      const inputArgs = [];
      sceneClips.forEach(c => inputArgs.push("-i", c.path));

      const filterParts = [];
      let cumulative   = sceneClips[0].duration;
      let lastVideoTag = "0:v";
      let lastAudioTag = "0:a";
      for (let i = 1; i < sceneClips.length; i++) {
        const offset = Math.max(0, cumulative - transitionDuration);
        const vTag = `v${i}`, aTag = `a${i}`;
        filterParts.push(`[${lastVideoTag}][${i}:v]xfade=transition=fade:duration=${transitionDuration}:offset=${offset.toFixed(2)}[${vTag}]`);
        filterParts.push(`[${lastAudioTag}][${i}:a]acrossfade=d=${transitionDuration}[${aTag}]`);
        lastVideoTag = vTag; lastAudioTag = aTag;
        cumulative = cumulative + sceneClips[i].duration - transitionDuration;
      }
      totalDuration = cumulative;

      await execFileAsync("ffmpeg", [
        "-y", ...inputArgs,
        "-filter_complex", filterParts.join(";"),
        "-map", `[${lastVideoTag}]`, "-map", `[${lastAudioTag}]`,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac",
        concatPath
      ]);
    } else {
      const listFile = path.join(jobTmpDir, "concat.txt");
      const lines = sceneClips.map(c => `file '${c.path.replaceAll("'", "'\\''")}'`).join("\n");
      await fs.writeFile(listFile, lines, "utf8");
      totalDuration = sceneClips.reduce((sum, c) => sum + c.duration, 0);

      await execFileAsync("ffmpeg", [
        "-y", "-f", "concat", "-safe", "0", "-i", listFile,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac",
        concatPath
      ]);
    }
    await updateJob({ progress: 70 });

    // ── Step 3: mix in background music (looped/trimmed, attenuated) if configured ──
    const music      = story.production?.music;
    const musicAsset = music?.enabled && music?.assetId ? assets.find(a => a.id === music.assetId) : null;
    let finalPath = concatPath;

    if (musicAsset) {
      const mixedPath = path.join(jobTmpDir, "mixed.mp4");
      const volume = Math.max(0, Math.min(1, Number(music.volume ?? 0.15)));
      await execFileAsync("ffmpeg", [
        "-y",
        "-i", concatPath,
        "-stream_loop", "-1", "-i", musicAsset.path,
        "-filter_complex",
        `[1:a]volume=${volume},atrim=0:${totalDuration.toFixed(2)}[music];` +
        `[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[a]`,
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac",
        mixedPath
      ]);
      finalPath = mixedPath;
    }
    await updateJob({ progress: 90 });

    // ── Step 4: finalize output ──
    const outDir  = path.join(RENDERS_DIR, story.id);
    await fs.mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `${jobId}-${presetKey}.mp4`);
    await fs.copyFile(finalPath, outFile);
    await fs.rm(jobTmpDir, { recursive: true, force: true }).catch(() => {});

    await updateJob({
      status:      "done",
      progress:    100,
      completedAt: new Date().toISOString(),
      outputUrl:   `/media/renders/${story.id}/${path.basename(outFile)}`,
      warnings
    });
  } catch (error) {
    await updateJob({ status: "error", error: error.message, progress: 0, warnings });
  }
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

  if (req.method === "GET" && pathname === "/api/health") {
    const ffmpeg = await detectFfmpeg();
    return json(res, 200, {
      ok: true,
      service: "akolis-tech-studio-api",
      version: "0.7.0",
      time: new Date().toISOString(),
      ffmpeg: ffmpeg ? { detected: true, version: ffmpeg } : { detected: false, version: null }
    });
  }

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
    if (typeof data.status === "string") story.status = data.status;
    if (data.research)   story.research   = { ...story.research,              ...data.research };
    if (data.script)     story.script     = { ...(story.script     || {}),    ...data.script };
    if (data.production) story.production = { ...(story.production || {}),    ...data.production };
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

  // ── Projects ────────────────────────────────────────────────────────────────

  if (req.method === "GET" && pathname === "/api/projects")
    return json(res, 200, store.projects || []);

  if (req.method === "POST" && pathname === "/api/projects") {
    const data = await body(req);
    if (!data.title) return json(res, 400, { error: "title is required" });
    const project = {
      id:            data.id || crypto.randomUUID(),
      title:         String(data.title).trim(),
      angle:         String(data.angle || "").trim(),
      length:        data.length  || "6–8 minutes",
      status:        data.status  || "Planning",
      progress:      data.progress ?? 5,
      sourceStoryId: data.sourceStoryId || null,
      createdAt:     data.createdAt || new Date().toISOString()
    };
    store.projects.unshift(project);
    await writeStore(store);
    return json(res, 201, project);
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch) {
    const id    = decodeURIComponent(projectMatch[1]);
    const index = (store.projects || []).findIndex(p => p.id === id);
    if (index < 0) return json(res, 404, { error: "Project not found" });

    if (req.method === "PATCH") {
      const data = await body(req);
      store.projects[index] = { ...store.projects[index], ...data };
      await writeStore(store);
      return json(res, 200, store.projects[index]);
    }
    if (req.method === "DELETE") {
      const deleted = store.projects.splice(index, 1)[0];
      await writeStore(store);
      return json(res, 200, deleted);
    }
  }

  // ── Production asset upload ──────────────────────────────────────────────────

  const uploadMatch = pathname.match(/^\/api\/stories\/([^/]+)\/production\/upload$/);
  if (uploadMatch && req.method === "POST") {
    const storyId = decodeURIComponent(uploadMatch[1]);
    const story   = getStoryOrThrow(store, storyId);
    const dir     = path.join(UPLOADS_DIR, storyId);
    await fs.mkdir(dir, { recursive: true });

    const uploaded = await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers });
      let meta = {};
      let saved = null;
      let writeDone = Promise.resolve();

      bb.on("field", (name, val) => { meta[name] = val; });
      bb.on("file",  (fieldname, fileStream, info) => {
        const { filename, mimeType } = info;
        const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
        const dest = path.join(dir, `${Date.now()}-${safe}`);
        const writeStream = createWriteStream(dest);
        writeDone = new Promise((res, rej) => {
          writeStream.on("finish", res);
          writeStream.on("error", rej);
        });
        saved = { dest, filename: safe, mimeType };
        fileStream.pipe(writeStream);
      });
      bb.on("finish", async () => {
        try { await writeDone; resolve({ meta, saved }); }
        catch (err) { reject(err); }
      });
      bb.on("error",  reject);
      req.pipe(bb);
    });

    if (!uploaded.saved) return json(res, 400, { error: "No file received." });

    const { dest, filename, mimeType } = uploaded.saved;
    // role: 'footage' (default, video/image b-roll) | 'voiceover' (per-scene narration audio) | 'music' (global background track)
    const role = ["footage", "voiceover", "music"].includes(uploaded.meta.role) ? uploaded.meta.role : "footage";

    await registerProductionAsset(story, storyId, {
      filePath: dest, fileName: filename, mimeType, role,
      sceneId:       uploaded.meta.sceneId       || null,
      requirementId: uploaded.meta.requirementId || null,
      source: "creator"
    });

    await writeStore(store);
    return json(res, 200, story);
  }

  // Update global music mix settings (volume / enabled) without re-uploading.
  const musicSettingsMatch = pathname.match(/^\/api\/stories\/([^/]+)\/production\/music$/);
  if (musicSettingsMatch && req.method === "PATCH") {
    const story = getStoryOrThrow(store, decodeURIComponent(musicSettingsMatch[1]));
    const data  = await body(req);
    story.production ||= { assets: [] };
    story.production.music = { ...(story.production.music || {}), ...data };
    await writeStore(store);
    return json(res, 200, story);
  }

  // Regenerate captions for a scene from its current narration + stored duration.
  const captionsGenerateMatch = pathname.match(/^\/api\/stories\/([^/]+)\/script\/scenes\/([^/]+)\/captions\/generate$/);
  if (captionsGenerateMatch && req.method === "POST") {
    const story  = getStoryOrThrow(store, decodeURIComponent(captionsGenerateMatch[1]));
    const sceneId = decodeURIComponent(captionsGenerateMatch[2]);
    const scene  = (story.script?.scenes || []).find(s => s.id === sceneId);
    if (!scene) return json(res, 404, { error: "Scene not found" });
    scene.captions = buildCaptionChunks(scene.voiceover || "", scene.durationSeconds || 0);
    scene.captionsEnabled = true;
    await writeStore(store);
    return json(res, 200, story);
  }

  // Auto-generate a single scene's voiceover via Google TTS.
  const autoVoiceoverMatch = pathname.match(/^\/api\/stories\/([^/]+)\/script\/scenes\/([^/]+)\/voiceover\/auto$/);
  if (autoVoiceoverMatch && req.method === "POST") {
    const story   = getStoryOrThrow(store, decodeURIComponent(autoVoiceoverMatch[1]));
    const sceneId = decodeURIComponent(autoVoiceoverMatch[2]);
    const scene   = (story.script?.scenes || []).find(s => s.id === sceneId);
    if (!scene) return json(res, 404, { error: "Scene not found" });
    if (!scene.voiceover) return json(res, 400, { error: "This scene has no narration text to synthesize." });

    try {
      const dir  = path.join(UPLOADS_DIR, story.id);
      await fs.mkdir(dir, { recursive: true });
      const dest = path.join(dir, `${Date.now()}-tts-${scene.id}.mp3`);
      await synthesizeVoiceover(scene.voiceover, dest);
      await registerProductionAsset(story, story.id, {
        filePath: dest, fileName: path.basename(dest), mimeType: "audio/mpeg",
        role: "voiceover", sceneId: scene.id, source: "tts-google"
      });
      await writeStore(store);
      return json(res, 200, story);
    } catch (error) {
      return json(res, 502, { error: error.message });
    }
  }

  // Auto-attach stock footage to a single scene via Pexels.
  const autoVisualMatch = pathname.match(/^\/api\/stories\/([^/]+)\/script\/scenes\/([^/]+)\/visual\/auto$/);
  if (autoVisualMatch && req.method === "POST") {
    const story   = getStoryOrThrow(store, decodeURIComponent(autoVisualMatch[1]));
    const sceneId = decodeURIComponent(autoVisualMatch[2]);
    const scene   = (story.script?.scenes || []).find(s => s.id === sceneId);
    if (!scene) return json(res, 404, { error: "Scene not found" });

    try {
      const dir   = path.join(UPLOADS_DIR, story.id);
      await fs.mkdir(dir, { recursive: true });
      const dest  = path.join(dir, `${Date.now()}-stock-${scene.id}.mp4`);
      const query = scene.onscreen || scene.title || story.title;
      await fetchStockFootage(query, dest);
      await registerProductionAsset(story, story.id, {
        filePath: dest, fileName: path.basename(dest), mimeType: "video/mp4",
        role: "footage", sceneId: scene.id, source: "stock-pexels"
      });
      await writeStore(store);
      return json(res, 200, story);
    } catch (error) {
      return json(res, 502, { error: error.message });
    }
  }

  // ── Autopilot: script → voiceover → visuals → render, hands-off ─────────────

  const autopilotMatch = pathname.match(/^\/api\/stories\/([^/]+)\/autopilot$/);
  if (autopilotMatch && req.method === "GET") {
    const storyId = decodeURIComponent(autopilotMatch[1]);
    const jobs = (store.autopilotJobs || []).filter(j => j.storyId === storyId);
    return json(res, 200, jobs);
  }
  if (autopilotMatch && req.method === "POST") {
    const storyId = decodeURIComponent(autopilotMatch[1]);
    const story   = getStoryOrThrow(store, storyId);

    if (!(story.research?.approvedAngle || story.angle)) {
      return json(res, 400, { error: "Approve an editorial angle in Research Studio before running Autopilot." });
    }

    const job = {
      id: crypto.randomUUID(), storyId, status: "queued", stage: "queued",
      warnings: [], renderJobId: null, outputUrl: null, error: null,
      createdAt: new Date().toISOString(), completedAt: null
    };
    store.autopilotJobs ||= [];
    store.autopilotJobs.unshift(job);
    await writeStore(store);

    // Run the full pipeline asynchronously — do not await.
    runAutopilot(job.id).catch(err => console.error("Autopilot error for job", job.id, err.message));

    return json(res, 202, { job });
  }

  if (req.method === "GET" && pathname === "/api/render-presets") {
    const presets = Object.entries(RENDER_PRESETS).map(([key, p]) => ({ key, ...p }));
    return json(res, 200, presets);
  }

  const renderMatch = pathname.match(/^\/api\/stories\/([^/]+)\/render$/);
  if (renderMatch) {
    const storyId = decodeURIComponent(renderMatch[1]);

    if (req.method === "GET") {
      const jobs = (store.renderJobs || []).filter(j => j.storyId === storyId);
      return json(res, 200, jobs);
    }

    if (req.method === "POST") {
      const story  = getStoryOrThrow(store, storyId);
      const data   = await body(req);
      const presetKey = RENDER_PRESETS[data.format] ? data.format : "long-form";

      const job = {
        id:          crypto.randomUUID(),
        storyId,
        format:      presetKey,
        presetLabel: RENDER_PRESETS[presetKey].label,
        status:      "queued",
        progress:    0,
        warnings:    [],
        createdAt:   new Date().toISOString(),
        startedAt:   null,
        completedAt: null,
        outputUrl:   null,
        error:       null
      };
      store.renderJobs ||= [];
      store.renderJobs.unshift(job);
      await writeStore(store);

      // Run FFmpeg asynchronously — do not await.
      _runRender(job.id, story, presetKey).catch(err =>
        console.error("Render error for job", job.id, err.message)
      );

      return json(res, 202, { job });
    }
  }

  // ── Media serving ────────────────────────────────────────────────────────────

  if (req.method === "GET" && pathname.startsWith("/media/uploads/")) {
    const rel  = pathname.replace("/media/uploads/", "");
    const safe = path.normalize(path.join(UPLOADS_DIR, rel));
    if (!safe.startsWith(UPLOADS_DIR)) return json(res, 403, { error: "Forbidden" });
    try {
      const file = await fs.readFile(safe);
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(file);
    } catch { return json(res, 404, { error: "Not found" }); }
  }

  if (req.method === "GET" && pathname.startsWith("/media/renders/")) {
    const rel  = pathname.replace("/media/renders/", "");
    const safe = path.normalize(path.join(RENDERS_DIR, rel));
    if (!safe.startsWith(RENDERS_DIR)) return json(res, 403, { error: "Forbidden" });
    try {
      const file = await fs.readFile(safe);
      res.writeHead(200, { "Content-Type": "video/mp4" });
      return res.end(file);
    } catch { return json(res, 404, { error: "Not found" }); }
  }

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
}).listen(PORT, () => console.log(`Akolis Tech Studio API running at http://localhost:${PORT}`));
