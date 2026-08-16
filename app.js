/*
  AKOLIS TECH STUDIO — V4
  Research Studio added.

  API:
    GET  /api/health
    GET  /api/sources
    POST /api/sources
    PATCH /api/sources/:id
    DELETE /api/sources/:id
    POST /api/feeds/refresh
    GET  /api/stories
    GET  /api/stories/:id
    PATCH /api/stories/:id
    POST /api/stories/:id/sources
    DELETE /api/stories/:storyId/sources/:sourceId
    POST /api/stories/:id/claims
    DELETE /api/stories/:storyId/claims/:claimId
    POST /api/stories/:id/research/generate
    POST /api/stories/:id/angles/generate

  The AI provider is intentionally abstracted on the backend.
  No provider API key belongs in this file.
*/

const STORAGE_KEYS = {
  stories: "ats_stories_v4_cache",
  projects: "ats_projects_v4",
  sources: "ats_sources_v4_cache"
};

const API_BASE = window.AKOLIS_API_BASE || "";
let activeResearchStory = null;

function getData(key, fallback = []) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
function saveData(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) {
    let message = `API request failed (${response.status})`;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function formatDate(value) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function renderAll() { renderStats(); renderStories(); renderSources(); renderProjects(); }

async function initialize() {
  if (!localStorage.getItem(STORAGE_KEYS.sources)) saveData(STORAGE_KEYS.sources, []);
  if (!localStorage.getItem(STORAGE_KEYS.stories)) saveData(STORAGE_KEYS.stories, []);
  if (!localStorage.getItem(STORAGE_KEYS.projects)) saveData(STORAGE_KEYS.projects, []);

  try {
    const [sources, stories] = await Promise.all([api("/api/sources"), api("/api/stories")]);
    saveData(STORAGE_KEYS.sources, sources);
    saveData(STORAGE_KEYS.stories, stories);
    showToast("Connected to backend.");
  } catch (error) {
    console.warn(error);
    showToast("Backend unavailable — local cache only.");
  }
  renderAll();
}

function renderStats() {
  const stories = getData(STORAGE_KEYS.stories);
  const sources = getData(STORAGE_KEYS.sources);
  const projects = getData(STORAGE_KEYS.projects);
  document.querySelector("#storyCount").textContent = stories.length;
  document.querySelector("#sourceCount").textContent = sources.length;
  document.querySelector("#activeSourceCount").textContent = `${sources.filter(s => s.active).length} active`;
  document.querySelector("#projectCount").textContent = projects.length;
  document.querySelector("#productionCount").textContent = `${projects.filter(p => p.progress > 0 && p.progress < 100).length} in production`;
  document.querySelector("#highPotentialCount").textContent = stories.filter(s => s.score >= 80).length;
  const recent = stories.filter(s => Date.now() - new Date(s.importedAt || s.publishedAt || 0).getTime() < 86400000).length;
  document.querySelector("#storyFreshness").textContent = `${recent} new in 24h`;
}

function renderStories() {
  const list = document.querySelector("#storyList");
  const query = document.querySelector("#storySearch").value.toLowerCase();
  const topic = document.querySelector("#topicFilter").value;
  const status = document.querySelector("#storyStatusFilter").value;

  const stories = getData(STORAGE_KEYS.stories)
    .filter(story => {
      const haystack = `${story.title} ${story.source} ${story.summary || ""} ${story.angle || ""}`.toLowerCase();
      return haystack.includes(query) &&
        (topic === "all" || story.topic === topic) &&
        (status === "all" || story.status === status);
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  list.innerHTML = stories.length ? stories.map(story => `
    <article class="story-card">
      <div>
        <div class="story-title">${escapeHtml(story.title)}</div>
        <div class="meta">${escapeHtml(story.source)} · ${escapeHtml(formatDate(story.publishedAt))} · ${escapeHtml(story.status)}</div>
        <div class="tags">
          <span class="tag">${escapeHtml(story.topic || "Unclassified")}</span>
          <span class="tag">${story.research?.sourceCount || 0} research sources</span>
          <span class="tag">${story.claims?.length || 0} claims</span><span class="tag">${story.script?.status || "No script"}</span>
        </div>
      </div>
      <div class="story-actions">
        <div class="score">${story.score ?? "—"}/100</div>
        <button class="secondary-btn research-story" data-id="${story.id}">Research</button>
        <button class="primary-btn script-story" data-id="${story.id}">Script</button>
      </div>
    </article>`).join("") :
    `<div class="empty">No stories match your filters. Try refreshing feeds.</div>`;
}

function renderSources() {
  const list = document.querySelector("#sourceList");
  const sources = getData(STORAGE_KEYS.sources);
  list.innerHTML = sources.length ? sources.map(source => `
    <article class="source-card">
      <div>
        <div class="story-title">${escapeHtml(source.name)}</div>
        <div class="meta">${escapeHtml(source.url)}</div>
        <div class="tags"><span class="tag">${escapeHtml((source.type || "rss").toUpperCase())}</span><span class="tag">${escapeHtml(source.topic || "Developer")}</span></div>
      </div>
      <div class="story-actions">
        <span class="source-status" style="${source.active ? "" : "color:var(--muted)"}">${source.active ? "Active" : "Paused"}</span>
        <button class="secondary-btn toggle-source" data-id="${source.id}" data-active="${source.active}">${source.active ? "Pause" : "Activate"}</button>
        <button class="danger-btn delete-source" data-id="${source.id}">Delete</button>
      </div>
    </article>`).join("") :
    `<div class="empty">No sources configured.</div>`;
}
function renderProjects() {
  const list = document.querySelector("#projectList");
  const projects = getData(STORAGE_KEYS.projects);
  list.innerHTML = projects.length ? projects.map(project => `
    <article class="project-card">
      <div>
        <div class="story-title">${escapeHtml(project.title)}</div>
        <div class="meta">${escapeHtml(project.length)} · ${escapeHtml(project.status)}</div>
        <p class="meta" style="margin-top:10px">${escapeHtml(project.angle)}</p>
        <div class="progress" style="--progress:${project.progress}%"><span></span></div>
      </div>
      <div class="score">${project.progress}%</div>
    </article>`).join("") :
    `<div class="empty">No projects yet.</div>`;
}

function openModal(id) {
  const modal = document.querySelector(`#${id}`);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}
function closeModal(id) {
  const modal = document.querySelector(`#${id}`);
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}
function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function openProjectFromStory(story) {
  document.querySelector("#projectTitle").value = story.title;
  document.querySelector("#projectAngle").value = story.angle || "What does this development mean for developers and tech users?";
  document.querySelector("#projectForm").dataset.storyId = story.id;
  openModal("projectModal");
}

function createProject(data) {
  const projects = getData(STORAGE_KEYS.projects);
  projects.unshift({
    id: crypto.randomUUID(),
    title: data.title,
    angle: data.angle,
    length: data.length,
    status: "Planning",
    progress: 5,
    sourceStoryId: data.sourceStoryId || null,
    createdAt: new Date().toISOString()
  });
  saveData(STORAGE_KEYS.projects, projects);
  const stories = getData(STORAGE_KEYS.stories);
  const story = stories.find(s => s.id === data.sourceStoryId);
  if (story) story.status = "Research";
  saveData(STORAGE_KEYS.stories, stories);
  renderAll();
  showToast("Project created.");
}

async function refreshFeeds() {
  const button = document.querySelector("#refreshFeedsBtn");
  const original = button.textContent;
  button.disabled = true; button.textContent = "Refreshing…";
  try {
    const result = await api("/api/feeds/refresh", { method: "POST", body: JSON.stringify({}) });
    saveData(STORAGE_KEYS.stories, result.stories || []);
    saveData(STORAGE_KEYS.sources, result.sources || []);
    renderAll();
    const failures = result.errors?.length ? ` ${result.errors.length} source(s) failed.` : "";
    showToast(`Refresh complete: ${result.added} new stories.${failures}`);
  } catch (error) {
    console.error(error);
    showToast(`Feed refresh failed: ${error.message}`);
  } finally {
    button.disabled = false; button.textContent = original;
  }
}

async function addSource(source) {
  try {
    const created = await api("/api/sources", { method: "POST", body: JSON.stringify(source) });
    saveData(STORAGE_KEYS.sources, [created, ...getData(STORAGE_KEYS.sources)]);
    renderAll(); showToast("Source added.");
  } catch (error) { showToast(error.message); }
}
async function toggleSource(id, active) {
  try {
    const updated = await api(`/api/sources/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ active: !active }) });
    saveData(STORAGE_KEYS.sources, getData(STORAGE_KEYS.sources).map(s => s.id === id ? updated : s));
    renderAll();
  } catch (error) { showToast(error.message); }
}
async function deleteSource(id) {
  try {
    await api(`/api/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
    saveData(STORAGE_KEYS.sources, getData(STORAGE_KEYS.sources).filter(s => s.id !== id));
    renderAll(); showToast("Source removed.");
  } catch (error) { showToast(error.message); }
}

// ---------------- RESEARCH STUDIO ----------------

async function openResearchStudio(storyId) {
  try {
    const story = await api(`/api/stories/${encodeURIComponent(storyId)}`);
    activeResearchStory = story;
    populateResearchStudio(story);
    openModal("researchStudioModal");
  } catch (error) {
    const story = getData(STORAGE_KEYS.stories).find(s => s.id === storyId);
    if (!story) return showToast("Story could not be opened.");
    activeResearchStory = story;
    populateResearchStudio(story);
    openModal("researchStudioModal");
    showToast("Showing cached story; backend is unavailable.");
  }
}

function populateResearchStudio(story) {
  document.querySelector("#researchTitle").textContent = story.title;
  document.querySelector("#researchSubtitle").textContent =
    `${story.source} · ${story.topic || "Unclassified"} · ${formatDate(story.publishedAt)}`;
  document.querySelector("#researchScore").textContent = `${story.score ?? "—"}/100`;

  const brief = story.research?.brief || {};
  document.querySelector("#researchWhatHappened").value = brief.whatHappened || story.summary || "";
  document.querySelector("#researchWhyMatters").value = brief.whyMatters || "";
  document.querySelector("#researchDeveloperImpact").value = brief.developerImpact || "";
  document.querySelector("#researchCaveats").value = brief.caveats || "";
  document.querySelector("#approvedAngle").value = story.research?.approvedAngle || story.angle || "";

  renderResearchSources(story);
  renderClaims(story);
  renderAngles(story);

  switchResearchTab("brief");
}

function switchResearchTab(name) {
  document.querySelectorAll(".research-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === name));
  ["brief", "sources", "claims", "angles"].forEach(tab => {
    document.querySelector(`#researchPanel${tab[0].toUpperCase()}${tab.slice(1)}`)
      .classList.toggle("hidden", tab !== name);
  });
}

function renderResearchSources(story) {
  const list = document.querySelector("#researchSourceList");
  const sources = story.researchSources || [];
  list.innerHTML = sources.length ? sources.map(source => `
    <article class="research-source-item">
      <div>
        <div class="research-source-role">${escapeHtml(source.role)}</div>
        <a class="source-url-small" href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.url)}</a>
        ${source.title ? `<div class="meta" style="margin-top:6px">${escapeHtml(source.title)}</div>` : ""}
      </div>
      <button class="danger-btn remove-research-source" data-id="${source.id}">Remove</button>
    </article>
  `).join("") : `<div class="empty">No research sources yet. Add the original announcement and supporting sources.</div>`;
}

function renderClaims(story) {
  const list = document.querySelector("#claimList");
  const claims = story.claims || [];
  list.innerHTML = claims.length ? claims.map(claim => `
    <article class="claim-item">
      <div>${escapeHtml(claim.text)}</div>
      <span class="confidence ${escapeHtml(claim.confidence)}">${escapeHtml(claim.confidence)}</span>
      <button class="danger-btn remove-claim" data-id="${claim.id}">Remove</button>
    </article>
  `).join("") : `<div class="empty">No claims recorded yet. Extract the facts you plan to say on camera.</div>`;
}

function renderAngles(story) {
  const list = document.querySelector("#angleList");
  const angles = story.research?.angles || [];
  list.innerHTML = angles.length ? angles.map((angle, i) => `
    <article class="angle-item ${story.research?.selectedAngleIndex === i ? "selected" : ""}" data-index="${i}">
      <strong>${escapeHtml(angle.title || `Angle ${i + 1}`)}</strong>
      <div class="meta" style="margin-top:6px">${escapeHtml(angle.description || angle)}</div>
    </article>
  `).join("") : `<div class="empty">No angles generated yet.</div>`;
}

async function saveResearchBrief() {
  if (!activeResearchStory) return;
  const brief = {
    whatHappened: document.querySelector("#researchWhatHappened").value.trim(),
    whyMatters: document.querySelector("#researchWhyMatters").value.trim(),
    developerImpact: document.querySelector("#researchDeveloperImpact").value.trim(),
    caveats: document.querySelector("#researchCaveats").value.trim()
  };
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}`, {
      method: "PATCH", body: JSON.stringify({ research: { ...activeResearchStory.research, brief } })
    });
    activeResearchStory = updated;
    cacheStory(updated);
    showToast("Research brief saved.");
  } catch (error) { showToast(error.message); }
}

async function generateResearch() {
  if (!activeResearchStory) return;
  const button = document.querySelector("#generateResearchBtn");
  const original = button.textContent;
  button.disabled = true; button.textContent = "Researching…";
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}/research/generate`, {
      method: "POST", body: JSON.stringify({})
    });
    activeResearchStory = updated;
    cacheStory(updated);
    populateResearchStudio(updated);
    showToast(updated.research?.aiGenerated ? "Research draft generated." : "Research draft prepared.");
  } catch (error) {
    showToast(`Research generation failed: ${error.message}`);
  } finally {
    button.disabled = false; button.textContent = original;
  }
}

async function addResearchSource() {
  if (!activeResearchStory) return;
  const url = document.querySelector("#researchSourceUrl").value.trim();
  const role = document.querySelector("#researchSourceRole").value;
  if (!url) return showToast("Enter a source URL.");
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}/sources`, {
      method: "POST", body: JSON.stringify({ url, role })
    });
    activeResearchStory = updated; cacheStory(updated); renderResearchSources(updated);
    document.querySelector("#researchSourceUrl").value = "";
    showToast("Research source added.");
  } catch (error) { showToast(error.message); }
}

async function removeResearchSource(id) {
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
    activeResearchStory = updated; cacheStory(updated); renderResearchSources(updated);
  } catch (error) { showToast(error.message); }
}

async function addClaim() {
  if (!activeResearchStory) return;
  const text = document.querySelector("#claimText").value.trim();
  const confidence = document.querySelector("#claimConfidence").value;
  if (!text) return showToast("Enter a claim.");
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}/claims`, {
      method: "POST", body: JSON.stringify({ text, confidence })
    });
    activeResearchStory = updated; cacheStory(updated); renderClaims(updated);
    document.querySelector("#claimText").value = "";
  } catch (error) { showToast(error.message); }
}

async function removeClaim(id) {
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}/claims/${encodeURIComponent(id)}`, { method: "DELETE" });
    activeResearchStory = updated; cacheStory(updated); renderClaims(updated);
  } catch (error) { showToast(error.message); }
}

async function generateAngles() {
  if (!activeResearchStory) return;
  const button = document.querySelector("#generateAnglesBtn");
  button.disabled = true;
  const original = button.textContent; button.textContent = "Generating…";
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}/angles/generate`, {
      method: "POST", body: JSON.stringify({})
    });
    activeResearchStory = updated; cacheStory(updated); renderAngles(updated);
    showToast("Editorial angles ready.");
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; button.textContent = original; }
}

async function saveAngle() {
  if (!activeResearchStory) return;
  const approvedAngle = document.querySelector("#approvedAngle").value.trim();
  if (!approvedAngle) return showToast("Choose or write an approved angle.");
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}`, {
      method: "PATCH", body: JSON.stringify({
        angle: approvedAngle,
        research: { ...activeResearchStory.research, approvedAngle }
      })
    });
    activeResearchStory = updated; cacheStory(updated); renderAll();
    showToast("Editorial angle approved.");
  } catch (error) { showToast(error.message); }
}

function cacheStory(story) {
  const stories = getData(STORAGE_KEYS.stories);
  const index = stories.findIndex(s => s.id === story.id);
  if (index >= 0) stories[index] = story;
  else stories.unshift(story);
  saveData(STORAGE_KEYS.stories, stories);
  renderAll();
}


// ---------------- Script Studio ----------------

let activeScriptStory = null;

function wordCount(text="") { return text.trim() ? text.trim().split(/\s+/).length : 0; }
function readingMinutes(text="") { return Math.max(1, Math.round(wordCount(text)/145*10)/10); }
function switchScriptTab(name) {
  document.querySelectorAll(".script-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === name));
  ["overview","script","scenes","assets","prompts"].forEach(tab => {
    const el = document.querySelector(`#scriptPanel${tab[0].toUpperCase()+tab.slice(1)}`);
    if (el) el.classList.toggle("hidden", tab !== name);
  });
}
function populateScriptStudio(story) {
  const script=story.script||{}, settings=script.settings||{};
  document.querySelector("#scriptTitle").textContent=story.title;
  document.querySelector("#scriptSubtitle").textContent=`${story.source} · ${story.research?.approvedAngle || story.angle || "No approved angle yet"}`;
  document.querySelector("#scriptDuration").textContent=script.durationMinutes ? `${script.durationMinutes}m` : "—";
  document.querySelector("#scriptApprovedAngle").value=settings.approvedAngle||story.research?.approvedAngle||story.angle||"";
  document.querySelector("#scriptAudience").value=settings.audience||"Developers and tech enthusiasts";
  document.querySelector("#scriptTargetMinutes").value=settings.targetMinutes||7;
  document.querySelector("#scriptTone").value=settings.tone||"clear-analytical";
  document.querySelector("#scriptMainTitle").value=script.title||story.title;
  document.querySelector("#scriptHook").value=script.hook||"";
  document.querySelector("#scriptNarration").value=script.narration||"";
  document.querySelector("#scriptOutro").value=script.outro||"";
  const full=`${script.hook||""} ${script.narration||""} ${script.outro||""}`;
  document.querySelector("#scriptWordCount").textContent=`${wordCount(full)} words`;
  document.querySelector("#scriptReadTime").textContent=`${readingMinutes(full)} min estimated narration`;
  document.querySelector("#scriptGenerationNote").textContent=script.generatedAt?`Last generated: ${formatDate(script.generatedAt)}`:"No script package generated yet.";
  renderScenes(story); renderAssets(story); renderFlowPrompts(story); switchScriptTab("overview");
}
function renderScenes(story) {
  const list=document.querySelector("#sceneList"), scenes=story.script?.scenes||[];
  list.innerHTML=scenes.length?scenes.map((s,i)=>`<article class="scene-card"><div class="scene-head"><div><strong>Scene ${i+1}: ${escapeHtml(s.title||"Untitled")}</strong><div class="meta">${escapeHtml(s.type||"visual")}</div></div><div class="scene-time">${escapeHtml(s.duration||"")}</div></div><div class="scene-grid"><label>Voiceover<textarea class="scene-field" data-i="${i}" data-k="voiceover">${escapeHtml(s.voiceover||"")}</textarea></label><label>Visual direction<textarea class="scene-field" data-i="${i}" data-k="visual">${escapeHtml(s.visual||"")}</textarea></label><label>On-screen text<textarea class="scene-field" data-i="${i}" data-k="onscreen">${escapeHtml(s.onscreen||"")}</textarea></label><label>Asset source<textarea class="scene-field" data-i="${i}" data-k="assetSource">${escapeHtml(s.assetSource||"")}</textarea></label></div></article>`).join(""): `<div class="empty">No scenes yet. Generate the script package.</div>`;
}
function assetItems(story){
  return (story.script?.scenes||[]).flatMap((s,si)=>(s.assetRequirements||[]).map((a,ai)=>({...a,sceneIndex:si,assetIndex:ai,sceneTitle:s.title,id:`${si}-${ai}`})));
}
function renderAssets(story){
  const assets=assetItems(story), done=assets.filter(a=>a.completed).length;
  document.querySelector("#assetSummary").innerHTML=`<span class="summary-pill">${done}/${assets.length} ready</span><span class="summary-pill">${assets.filter(a=>(a.source||"").toLowerCase().includes("flow")).length} Flow</span><span class="summary-pill">${assets.filter(a=>(a.source||"").toLowerCase().includes("creator")).length} creator footage</span>`;
  document.querySelector("#assetChecklist").innerHTML=assets.length?assets.map(a=>`<label class="asset-item"><input type="checkbox" class="asset-check" data-id="${a.id}" ${a.completed?"checked":""}><div><div class="asset-type">${escapeHtml(a.source||"Asset")} · ${escapeHtml(a.type||"visual")}</div><div>${escapeHtml(a.description||"")}</div><div class="meta">Scene: ${escapeHtml(a.sceneTitle||"")}</div></div><span class="meta">${a.required===false?"Optional":"Required"}</span></label>`).join(""): `<div class="empty">No asset checklist yet.</div>`;
}
function renderFlowPrompts(story){
  const prompts=(story.script?.scenes||[]).flatMap((s,si)=>(s.flowPrompts||[]).map((p,pi)=>({p,si,pi})));
  document.querySelector("#flowPromptList").innerHTML=prompts.length?prompts.map(x=>`<article class="flow-prompt-card"><strong>Scene ${x.si+1} · Prompt ${x.pi+1}</strong><textarea readonly>${escapeHtml(x.p)}</textarea><button class="secondary-btn copy-prompt-btn" data-prompt="${escapeHtml(x.p)}">Copy Prompt</button></article>`).join(""): `<div class="empty">No Flow prompts yet.</div>`;
}
async function openScriptStudio(id){
  try { activeScriptStory=await api(`/api/stories/${encodeURIComponent(id)}`); }
  catch { activeScriptStory=getData(STORAGE_KEYS.stories).find(s=>s.id===id); }
  if(!activeScriptStory) return showToast("Story not found.");
  populateScriptStudio(activeScriptStory); openModal("scriptStudioModal");
}
async function saveScriptSettings(){
  if(!activeScriptStory)return;
  const script=activeScriptStory.script||{};
  const settings={...(script.settings||{}),approvedAngle:document.querySelector("#scriptApprovedAngle").value.trim(),audience:document.querySelector("#scriptAudience").value.trim(),targetMinutes:Number(document.querySelector("#scriptTargetMinutes").value||7),tone:document.querySelector("#scriptTone").value};
  try { activeScriptStory=await api(`/api/stories/${activeScriptStory.id}`,{method:"PATCH",body:JSON.stringify({script:{...script,settings}})}); cacheStory(activeScriptStory); showToast("Script settings saved."); }
  catch(e){showToast(e.message)}
}
async function generateScriptPackage(){
  if(!activeScriptStory)return; await saveScriptSettings();
  const b=document.querySelector("#generateScriptBtn"),o=b.textContent;b.disabled=true;b.textContent="Building…";
  try { activeScriptStory=await api(`/api/stories/${activeScriptStory.id}/script/generate`,{method:"POST",body:JSON.stringify({})}); cacheStory(activeScriptStory);populateScriptStudio(activeScriptStory);switchScriptTab("script");showToast("Script package prepared."); }
  catch(e){showToast(`Script generation failed: ${e.message}`)} finally{b.disabled=false;b.textContent=o;}
}
async function saveScript(){
  if(!activeScriptStory)return;
  try { const s=activeScriptStory.script||{}; activeScriptStory=await api(`/api/stories/${activeScriptStory.id}`,{method:"PATCH",body:JSON.stringify({script:{...s,title:document.querySelector("#scriptMainTitle").value.trim(),hook:document.querySelector("#scriptHook").value.trim(),narration:document.querySelector("#scriptNarration").value.trim(),outro:document.querySelector("#scriptOutro").value.trim()}})}); cacheStory(activeScriptStory); populateScriptStudio(activeScriptStory); switchScriptTab("script"); showToast("Script saved."); }
  catch(e){showToast(e.message)}
}
async function regenerateScenes(){
  if(!activeScriptStory)return;
  try{activeScriptStory=await api(`/api/stories/${activeScriptStory.id}/script/scenes/generate`,{method:"POST",body:JSON.stringify({})});cacheStory(activeScriptStory);renderScenes(activeScriptStory);renderAssets(activeScriptStory);renderFlowPrompts(activeScriptStory);showToast("Scene plan refreshed.")}catch(e){showToast(e.message)}
}
async function addScene(){
  if(!activeScriptStory)return; const scenes=[...(activeScriptStory.script?.scenes||[])]; scenes.push({id:crypto.randomUUID(),title:`New Scene ${scenes.length+1}`,duration:"0:00–0:10",type:"visual",voiceover:"",visual:"",onscreen:"",assetSource:"Flow",assetRequirements:[],flowPrompts:[]});
  try{activeScriptStory=await api(`/api/stories/${activeScriptStory.id}`,{method:"PATCH",body:JSON.stringify({script:{...activeScriptStory.script,scenes}})});cacheStory(activeScriptStory);renderScenes(activeScriptStory);}catch(e){showToast(e.message)}
}
async function saveSceneField(i,k,v){
  if(!activeScriptStory)return; const scenes=[...(activeScriptStory.script?.scenes||[])]; if(!scenes[i])return; scenes[i]={...scenes[i],[k]:v};
  try{activeScriptStory=await api(`/api/stories/${activeScriptStory.id}`,{method:"PATCH",body:JSON.stringify({script:{...activeScriptStory.script,scenes}})});cacheStory(activeScriptStory);}catch(e){showToast(e.message)}
}
async function markAsset(id,done){
  const [si,ai]=String(id).split("-").map(Number); const scenes=[...(activeScriptStory.script?.scenes||[])]; if(!scenes[si]||!scenes[si].assetRequirements?.[ai])return; scenes[si].assetRequirements[ai].completed=done;
  try{activeScriptStory=await api(`/api/stories/${activeScriptStory.id}`,{method:"PATCH",body:JSON.stringify({script:{...activeScriptStory.script,scenes}})});cacheStory(activeScriptStory);renderAssets(activeScriptStory);}catch(e){showToast(e.message)}
}

// ---------------- EVENTS ----------------

document.querySelector("#refreshFeedsBtn").addEventListener("click", refreshFeeds);
document.querySelector("#addSourceBtn").addEventListener("click", () => openModal("sourceModal"));

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => closeModal(button.dataset.close));
});
document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(modal.id); });
});

document.querySelector("#storySearch").addEventListener("input", renderStories);
document.querySelector("#topicFilter").addEventListener("change", renderStories);
document.querySelector("#storyStatusFilter").addEventListener("change", renderStories);

document.querySelector("#storyList").addEventListener("click", async e => {
  const research=e.target.closest(".research-story");
  const script=e.target.closest(".script-story");
  const id=(research||script)?.dataset.id; if(!id)return;
  if(research) await openResearchStudio(id);
  else await openScriptStudio(id);
});

document.querySelector("#projectForm").addEventListener("submit", e => {
  e.preventDefault();
  createProject({
    title: document.querySelector("#projectTitle").value.trim(),
    angle: document.querySelector("#projectAngle").value.trim(),
    length: document.querySelector("#projectLength").value,
    sourceStoryId: e.target.dataset.storyId || null
  });
  e.target.reset(); delete e.target.dataset.storyId; closeModal("projectModal");
});

document.querySelector("#sourceForm").addEventListener("submit", async e => {
  e.preventDefault();
  await addSource({
    name: document.querySelector("#sourceName").value.trim(),
    url: document.querySelector("#sourceUrl").value.trim(),
    type: document.querySelector("#sourceType").value,
    topic: document.querySelector("#sourceTopic").value
  });
  e.target.reset(); closeModal("sourceModal");
});

document.querySelector("#sourceList").addEventListener("click", async e => {
  const toggle = e.target.closest(".toggle-source");
  const del = e.target.closest(".delete-source");
  if (toggle) await toggleSource(toggle.dataset.id, toggle.dataset.active === "true");
  if (del && confirm("Remove this source?")) await deleteSource(del.dataset.id);
});

document.querySelectorAll(".research-tab").forEach(button => {
  button.addEventListener("click", () => switchResearchTab(button.dataset.tab));
});
document.querySelector("#saveResearchBtn").addEventListener("click", saveResearchBrief);
document.querySelector("#generateResearchBtn").addEventListener("click", generateResearch);
document.querySelector("#addResearchSourceBtn").addEventListener("click", addResearchSource);
document.querySelector("#addClaimBtn").addEventListener("click", addClaim);
document.querySelector("#generateAnglesBtn").addEventListener("click", generateAngles);
document.querySelector("#saveAngleBtn").addEventListener("click", saveAngle);

document.querySelector("#researchSourceList").addEventListener("click", async e => {
  const button = e.target.closest(".remove-research-source");
  if (button) await removeResearchSource(button.dataset.id);
});
document.querySelector("#claimList").addEventListener("click", async e => {
  const button = e.target.closest(".remove-claim");
  if (button) await removeClaim(button.dataset.id);
});
document.querySelector("#angleList").addEventListener("click", e => {
  const item = e.target.closest(".angle-item");
  if (!item || !activeResearchStory) return;
  const index = Number(item.dataset.index);
  document.querySelector("#approvedAngle").value =
    activeResearchStory.research?.angles?.[index]?.description ||
    activeResearchStory.research?.angles?.[index] || "";
  document.querySelectorAll(".angle-item").forEach(el => el.classList.remove("selected"));
  item.classList.add("selected");
});


document.querySelectorAll(".script-tab").forEach(b=>b.addEventListener("click",()=>switchScriptTab(b.dataset.tab)));
document.querySelector("#saveScriptSettingsBtn").addEventListener("click",saveScriptSettings);
document.querySelector("#generateScriptBtn").addEventListener("click",generateScriptPackage);
document.querySelector("#saveScriptBtn").addEventListener("click",saveScript);
document.querySelector("#regenerateScenesBtn").addEventListener("click",regenerateScenes);
document.querySelector("#addSceneBtn").addEventListener("click",addScene);
document.querySelector("#sceneList").addEventListener("change",e=>{if(e.target.classList.contains("scene-field"))saveSceneField(Number(e.target.dataset.i),e.target.dataset.k,e.target.value)});
document.querySelector("#assetChecklist").addEventListener("change",e=>{if(e.target.classList.contains("asset-check"))markAsset(e.target.dataset.id,e.target.checked)});
document.querySelector("#flowPromptList").addEventListener("click",async e=>{const b=e.target.closest(".copy-prompt-btn");if(!b)return;try{await navigator.clipboard.writeText(b.dataset.prompt);showToast("Flow prompt copied.")}catch{showToast("Could not copy automatically.")}});



async function createRenderJob(format = "long-form") {
  if (!activeProductionStory) return;
  const button = document.querySelector("#prepareRenderBtn");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Queueing…";

  try {
    const response = await api(`/api/stories/${encodeURIComponent(activeProductionStory.id)}/render`, {
      method: "POST",
      body: JSON.stringify({ format })
    });
    showToast(`Render job ${response.job.id} queued.`);
    renderRenderJobs();
  } catch (error) {
    showToast(`Render queue failed: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function renderRenderJobs() {
  if (!activeProductionStory) return;
  const jobs = await api(`/api/stories/${encodeURIComponent(activeProductionStory.id)}/render`);
  const container = document.querySelector("#renderJobs");
  if (!jobs.length) {
    container.innerHTML = `<div class="empty">No render jobs yet.</div>`;
    return;
  }
  container.innerHTML = jobs.map(job => `
    <article class="render-job">
      <div>
        <div><strong>${escapeHtml(job.format)}</strong> · <span class="job-status ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span></div>
        <div class="meta">${escapeHtml(job.id)} · ${escapeHtml(formatDate(job.createdAt))}</div>
        ${job.error ? `<div class="meta" style="color:var(--danger);margin-top:5px">${escapeHtml(job.error)}</div>` : ""}
        ${job.outputUrl ? `<a class="job-link" href="${escapeHtml(job.outputUrl)}" target="_blank" rel="noopener">Open rendered video</a>` : ""}
      </div>
      <div class="meta">${job.progress ?? 0}%</div>
    </article>
  `).join("");
}

async function pollRenderJobs() {
  if (!document.querySelector("#productionStudioModal") ||
      document.querySelector("#productionStudioModal").classList.contains("hidden")) return;
  try {
    await renderRenderJobs();
  } catch {}
}

setInterval(pollRenderJobs, 3000);

const oldPrepareRender = document.querySelector("#prepareRenderBtn");
if (oldPrepareRender) {
  oldPrepareRender.addEventListener("click", async () => {
    await createRenderJob("long-form");
  });
}

const oldDownload = document.querySelector("#downloadManifestBtn");
if (oldDownload) {
  oldDownload.addEventListener("click", async () => {
    if (activeProductionStory) await renderRenderJobs();
  });
}

initialize();
// ---------------- V6 Production Studio ----------------

let activeProductionStory = null;

function storyScenes(story) {
  return story?.script?.scenes || [];
}

function productionAssets(story) {
  return story?.production?.assets || [];
}

function readiness(story) {
  const scenes = storyScenes(story);
  const assets = productionAssets(story);
  const required = scenes.flatMap(scene => scene.assetRequirements || []).filter(a => a.required !== false);
  const complete = required.filter(req => {
    const id = req.id || req.type || crypto.randomUUID();
    return Boolean(assets.find(asset => asset.requirementId === id && asset.status === "ready"));
  }).length;
  const percent = required.length ? Math.round((complete / required.length) * 100) : (scenes.length ? 60 : 0);
  return { required: required.length, complete, percent };
}

async function openProductionStudio(storyId) {
  try {
    const story = await api(`/api/stories/${encodeURIComponent(storyId)}`);
    activeProductionStory = story;
    populateProductionStudio(story);
    openModal("productionStudioModal");
  } catch (error) {
    const story = getData(STORAGE_KEYS.stories).find(s => s.id === storyId);
    if (!story) return showToast("Story not found.");
    activeProductionStory = story;
    populateProductionStudio(story);
    openModal("productionStudioModal");
    showToast("Using cached story.");
  }
}

function populateProductionStudio(story) {
  document.querySelector("#productionTitle").textContent = story.title;
  document.querySelector("#productionSubtitle").textContent =
    `${story.source} · ${story.script?.title || "No script title"} · ${story.script?.durationMinutes || "—"} min`;
  const ready = readiness(story);
  document.querySelector("#productionReadiness").textContent = `${ready.percent}%`;

  renderProductionScenes(story);
  renderProductionAssets(story);
  renderRenderManifest(story);
  switchProductionTab("timeline");
}

function switchProductionTab(name) {
  document.querySelectorAll(".production-tab").forEach(tab =>
    tab.classList.toggle("active", tab.dataset.tab === name)
  );
  ["timeline", "assets", "render"].forEach(tab => {
    document.querySelector(`#productionPanel${tab[0].toUpperCase()}${tab.slice(1)}`)
      .classList.toggle("hidden", tab !== name);
  });
}

function renderProductionScenes(story) {
  const list = document.querySelector("#productionSceneList");
  const scenes = storyScenes(story);

  if (!scenes.length) {
    list.innerHTML = `<div class="empty">No script scenes exist yet. Generate the script package first.</div>`;
    return;
  }

  const assets = productionAssets(story);
  list.innerHTML = scenes.map((scene, index) => {
    const reqs = scene.assetRequirements || [];
    return `
      <article class="production-scene-card">
        <div class="production-scene-head">
          <div>
            <strong>Scene ${index + 1} · ${escapeHtml(scene.title || "Untitled")}</strong>
            <div class="meta">${escapeHtml(scene.duration || "")} · ${escapeHtml(scene.type || "visual")}</div>
          </div>
          <span class="scene-time">${reqs.length ? `${reqs.length} asset req.` : "No asset req."}</span>
        </div>
        <div class="production-scene-body">
          <div>
            <div class="meta">VOICEOVER</div>
            <div style="margin-top:5px; line-height:1.5">${escapeHtml(scene.voiceover || "No voiceover yet.")}</div>
            <div class="meta" style="margin-top:13px">VISUAL</div>
            <div style="margin-top:5px; line-height:1.5">${escapeHtml(scene.visual || "No visual direction yet.")}</div>
          </div>
          <div>
            <div class="meta">ASSET REQUIREMENTS</div>
            <div class="production-scene-assets">
              ${
                reqs.length
                ? reqs.map((req, j) => {
                    const reqId = req.id || req.type || `${index}-${j}`;
                    const linked = assets.find(a => a.requirementId === reqId);
                    return `
                      <div class="scene-asset-link">
                        <div>
                          <div><span class="asset-badge">${escapeHtml(req.source || "Flow")}</span>${escapeHtml(req.description || req.type || "Asset")}</div>
                          <div class="meta">${linked ? escapeHtml(linked.fileName) : "Missing asset"}</div>
                        </div>
                        <button class="secondary-btn attach-requirement-btn" data-scene="${scene.id || index}" data-req="${escapeHtml(reqId)}">Attach</button>
                      </div>`;
                  }).join("")
                : `<div class="empty">No asset requirements.</div>`
              }
            </div>
          </div>
        </div>
      </article>`;
  }).join("");
}

function renderProductionAssets(story) {
  const list = document.querySelector("#productionAssetList");
  const assets = productionAssets(story);

  list.innerHTML = assets.length ? assets.map(asset => `
    <article class="production-asset">
      <div>
        <div>
          <span class="asset-badge">${escapeHtml(asset.mediaType || "file")}</span>
          <strong>${escapeHtml(asset.fileName)}</strong>
        </div>
        <div class="meta">${escapeHtml(asset.status || "uploaded")} · ${escapeHtml(asset.source || "creator")} · ${formatBytes(asset.size || 0)}</div>
        <div class="meta">${asset.requirementId ? `Requirement: ${escapeHtml(asset.requirementId)}` : "Unassigned asset"}</div>
      </div>
      <div class="asset-actions">
        ${!asset.requirementId ? `<button class="secondary-btn assign-asset-btn" data-id="${asset.id}">Assign</button>` : ""}
        <button class="danger-btn delete-asset-btn" data-id="${asset.id}">Remove</button>
      </div>
    </article>
  `).join("") : `<div class="empty">No assets added yet.</div>`;
}

function renderRenderManifest(story) {
  const ready = readiness(story);
  const scenes = storyScenes(story);
  const assets = productionAssets(story);
  const manifest = {
    schema: "akolis-tech-studio-render-v1",
    generatedAt: new Date().toISOString(),
    story: {
      id: story.id,
      title: story.title
    },
    output: {
      longForm: "1920x1080",
      verticalShort: "1080x1920"
    },
    readiness: ready,
    scenes: scenes.map((scene, index) => ({
      index: index + 1,
      id: scene.id || String(index + 1),
      title: scene.title,
      duration: scene.duration,
      voiceover: scene.voiceover,
      visual: scene.visual,
      assets: assets
        .filter(asset => asset.sceneId === (scene.id || String(index + 1)))
        .map(asset => ({
          id: asset.id,
          fileName: asset.fileName,
          path: asset.url || asset.path || null,
          status: asset.status
        }))
    }))
  };

  document.querySelector("#renderSummary").innerHTML = `
    <span class="summary-pill">${ready.complete}/${ready.required} required assets ready</span>
    <span class="summary-pill">${assets.length} uploaded assets</span>
    <span class="summary-pill">${scenes.length} scenes</span>
    <span class="summary-pill">${story.script?.durationMinutes || "—"} min target</span>`;
  document.querySelector("#renderManifest").textContent = JSON.stringify(manifest, null, 2);
  document.querySelector("#renderManifest").dataset.manifest = JSON.stringify(manifest);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function persistStory(story) {
  const updated = await api(`/api/stories/${story.id}`, {
    method: "PATCH",
    body: JSON.stringify({ production: story.production })
  });
  activeProductionStory = updated;
  cacheStory(updated);
  return updated;
}

async function handleAssetFiles(files, sceneId = null, requirementId = null) {
  if (!activeProductionStory || !files?.length) return;
  let uploaded = 0;
  for (const file of files) {
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("storyId", activeProductionStory.id);
      if (sceneId) form.append("sceneId", sceneId);
      if (requirementId) form.append("requirementId", requirementId);

      const response = await fetch(`${API_BASE}/api/stories/${encodeURIComponent(activeProductionStory.id)}/production/upload`, {
        method: "POST",
        body: form
      });
      if (!response.ok) throw new Error(await response.text());
      const updated = await response.json();
      activeProductionStory = updated;
      cacheStory(updated);
      uploaded++;
    } catch (error) {
      console.error(error);
      showToast(`Upload failed for ${file.name}: ${error.message}`);
    }
  }
  if (uploaded) {
    populateProductionStudio(activeProductionStory);
    showToast(`${uploaded} file(s) uploaded.`);
  }
}

function downloadTextFile(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function prepareRender() {
  if (!activeProductionStory) return;
  const ready = readiness(activeProductionStory);
  const manifestText = document.querySelector("#renderManifest").textContent;
  document.querySelector("#renderNote").textContent =
    ready.required && ready.complete < ready.required
      ? `Render package prepared as a draft. ${ready.required - ready.complete} required asset(s) are still missing.`
      : "Render package is ready for the FFmpeg stage.";
  showToast("Render manifest prepared.");
  downloadTextFile(
    `${activeProductionStory.id}-render-manifest.json`,
    manifestText
  );
}

document.querySelector("#productionStudioModal").addEventListener("click", async e => {
  const attach = e.target.closest(".attach-requirement-btn");
  const remove = e.target.closest(".delete-asset-btn");
  const assign = e.target.closest(".assign-asset-btn");

  if (attach) {
    document.querySelector("#assetFileInput").dataset.sceneId = attach.dataset.scene;
    document.querySelector("#assetFileInput").dataset.requirementId = attach.dataset.req;
    document.querySelector("#assetFileInput").click();
  }
  if (remove) {
    const id = remove.dataset.id;
    const production = activeProductionStory.production || {};
    const assets = (production.assets || []).filter(asset => asset.id !== id);
    try {
      const updated = await persistStory({ ...activeProductionStory, production: { ...production, assets } });
      populateProductionStudio(updated);
      showToast("Asset removed.");
    } catch (error) { showToast(error.message); }
  }
  if (assign) {
    showToast("Use a scene's Attach button to assign an asset.");
  }
});

document.querySelectorAll(".production-tab").forEach(button => {
  button.addEventListener("click", () => switchProductionTab(button.dataset.tab));
});

document.querySelector("#chooseAssetBtn").addEventListener("click", () => document.querySelector("#assetFileInput").click());
document.querySelector("#assetUploadZone").addEventListener("click", e => {
  if (!e.target.closest("button")) document.querySelector("#assetFileInput").click();
});
document.querySelector("#assetUploadZone").addEventListener("dragover", e => {
  e.preventDefault();
  document.querySelector("#assetUploadZone").classList.add("dragover");
});
document.querySelector("#assetUploadZone").addEventListener("dragleave", () => {
  document.querySelector("#assetUploadZone").classList.remove("dragover");
});
document.querySelector("#assetUploadZone").addEventListener("drop", async e => {
  e.preventDefault();
  document.querySelector("#assetUploadZone").classList.remove("dragover");
  await handleAssetFiles([...e.dataTransfer.files]);
});
document.querySelector("#assetFileInput").addEventListener("change", async e => {
  const input = e.currentTarget;
  await handleAssetFiles(
    [...input.files],
    input.dataset.sceneId || null,
    input.dataset.requirementId || null
  );
  input.value = "";
  delete input.dataset.sceneId;
  delete input.dataset.requirementId;
});
document.querySelector("#downloadManifestBtn").addEventListener("click", () => {
  const manifest = document.querySelector("#renderManifest").dataset.manifest || "{}";
  const id = activeProductionStory?.id || "project";
  downloadTextFile(`${id}-render-manifest.json`, manifest);
});
document.querySelector("#prepareRenderBtn").addEventListener("click", prepareRender);

// Update story list with Production button if missing.
const originalRenderStories = renderStories;
renderStories = function() {
  originalRenderStories();
  const list = document.querySelector("#storyList");
  list.querySelectorAll(".story-card").forEach(card => {
    const scriptButton = card.querySelector(".script-story");
    if (!scriptButton || card.querySelector(".production-story")) return;
    const id = scriptButton.dataset.id;
    const button = document.createElement("button");
    button.className = "secondary-btn production-story";
    button.dataset.id = id;
    button.textContent = "Production";
    scriptButton.parentElement.insertBefore(button, scriptButton.nextSibling);
  });
};
document.querySelector("#storyList").addEventListener("click", async e => {
  const production = e.target.closest(".production-story");
  if (production) await openProductionStudio(production.dataset.id);
});

document.querySelector("#projectList").addEventListener("click", async e => {
  const project = e.target.closest(".project-card");
  if (!project) return;
  const text = project.querySelector(".story-title")?.textContent;
  const story = getData(STORAGE_KEYS.stories).find(s => s.title === text);
  if (story) await openProductionStudio(story.id);
});
