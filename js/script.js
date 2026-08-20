// AKOLIS TECH STUDIO — Script Studio (V5)

import { api, escapeHtml, formatDate, showToast, openModal, getData, STORAGE_KEYS } from "./core.js";
import { cacheStory } from "./ui.js";

let activeScriptStory = null;

// ---------- Helpers ----------

function wordCount(text = "") { return text.trim() ? text.trim().split(/\s+/).length : 0; }
function readingMinutes(text = "") { return Math.max(1, Math.round(wordCount(text) / 145 * 10) / 10); }

// ---------- Tab switching ----------

export function switchScriptTab(name) {
  document.querySelectorAll(".script-tab").forEach(tab =>
    tab.classList.toggle("active", tab.dataset.tab === name)
  );
  ["overview", "script", "scenes", "assets", "prompts"].forEach(tab => {
    const el = document.querySelector(`#scriptPanel${tab[0].toUpperCase()}${tab.slice(1)}`);
    if (el) el.classList.toggle("hidden", tab !== name);
  });
}

// ---------- Populate ----------

export function populateScriptStudio(story) {
  const script   = story.script   || {};
  const settings = script.settings || {};

  document.querySelector("#scriptTitle").textContent    = story.title;
  document.querySelector("#scriptSubtitle").textContent =
    `${story.source} · ${story.research?.approvedAngle || story.angle || "No approved angle yet"}`;
  document.querySelector("#scriptDuration").textContent =
    script.durationMinutes ? `${script.durationMinutes}m` : "—";

  document.querySelector("#scriptApprovedAngle").value  = settings.approvedAngle || story.research?.approvedAngle || story.angle || "";
  document.querySelector("#scriptAudience").value        = settings.audience      || "Developers and tech enthusiasts";
  document.querySelector("#scriptTargetMinutes").value   = settings.targetMinutes || 7;
  document.querySelector("#scriptTone").value            = settings.tone          || "clear-analytical";

  document.querySelector("#scriptMainTitle").value = script.title   || story.title;
  document.querySelector("#scriptHook").value      = script.hook    || "";
  document.querySelector("#scriptNarration").value = script.narration || "";
  document.querySelector("#scriptOutro").value     = script.outro   || "";

  const full = `${script.hook || ""} ${script.narration || ""} ${script.outro || ""}`;
  document.querySelector("#scriptWordCount").textContent  = `${wordCount(full)} words`;
  document.querySelector("#scriptReadTime").textContent   = `${readingMinutes(full)} min estimated narration`;
  document.querySelector("#scriptGenerationNote").textContent = script.generatedAt
    ? `Last generated: ${formatDate(script.generatedAt)}`
    : "No script package generated yet.";

  const hasAngle = !!(story.research?.approvedAngle || story.angle);
  const prereq = document.querySelector("#scriptPrereqNotice");
  prereq.classList.toggle("hidden", hasAngle);
  if (!hasAngle) prereq.textContent = "No approved editorial angle yet — head back to Research Studio and approve one before generating a script.";

  const hasScenes = (script.scenes || []).length > 0;
  document.querySelector("#continueToProductionBtn").disabled = !hasScenes;
  document.querySelector("#continueToProductionBtn").dataset.storyId = story.id;

  _renderScenes(story);
  _renderAssets(story);
  _renderFlowPrompts(story);
  switchScriptTab("overview");
}

// ---------- Internal renderers ----------

function _renderScenes(story) {
  const list   = document.querySelector("#sceneList");
  const scenes = story.script?.scenes || [];
  list.innerHTML = scenes.length
    ? scenes.map((s, i) => `
        <article class="scene-card">
          <div class="scene-head">
            <div>
              <strong>Scene ${i + 1}: ${escapeHtml(s.title || "Untitled")}</strong>
              <div class="meta">${escapeHtml(s.type || "visual")}</div>
            </div>
            <div class="scene-time">${escapeHtml(s.duration || "")}</div>
          </div>
          <div class="scene-grid">
            <label>Voiceover
              <textarea class="scene-field" data-i="${i}" data-k="voiceover">${escapeHtml(s.voiceover || "")}</textarea>
            </label>
            <label>Visual direction
              <textarea class="scene-field" data-i="${i}" data-k="visual">${escapeHtml(s.visual || "")}</textarea>
            </label>
            <label>On-screen text
              <textarea class="scene-field" data-i="${i}" data-k="onscreen">${escapeHtml(s.onscreen || "")}</textarea>
            </label>
            <label>Asset source
              <textarea class="scene-field" data-i="${i}" data-k="assetSource">${escapeHtml(s.assetSource || "")}</textarea>
            </label>
          </div>
        </article>`).join("")
    : `<div class="empty">No scenes yet. Generate the script package first.</div>`;
}

function _assetItems(story) {
  return (story.script?.scenes || []).flatMap((s, si) =>
    (s.assetRequirements || []).map((a, ai) => ({
      ...a, sceneIndex: si, assetIndex: ai, sceneTitle: s.title, id: `${si}-${ai}`
    }))
  );
}

function _renderAssets(story) {
  const assets = _assetItems(story);
  const done   = assets.filter(a => a.completed).length;

  document.querySelector("#assetSummary").innerHTML = `
    <span class="summary-pill">${done}/${assets.length} ready</span>
    <span class="summary-pill">${assets.filter(a => (a.source || "").toLowerCase().includes("flow")).length} Flow</span>
    <span class="summary-pill">${assets.filter(a => (a.source || "").toLowerCase().includes("creator")).length} creator footage</span>`;

  document.querySelector("#assetChecklist").innerHTML = assets.length
    ? assets.map(a => `
        <label class="asset-item">
          <input type="checkbox" class="asset-check" data-id="${a.id}" ${a.completed ? "checked" : ""}>
          <div>
            <div class="asset-type">${escapeHtml(a.source || "Asset")} · ${escapeHtml(a.type || "visual")}</div>
            <div>${escapeHtml(a.description || "")}</div>
            <div class="meta">Scene: ${escapeHtml(a.sceneTitle || "")}</div>
          </div>
          <span class="meta">${a.required === false ? "Optional" : "Required"}</span>
        </label>`).join("")
    : `<div class="empty">No asset checklist yet.</div>`;
}

function _renderFlowPrompts(story) {
  const prompts = (story.script?.scenes || []).flatMap((s, si) =>
    (s.flowPrompts || []).map((p, pi) => ({ p, si, pi }))
  );
  document.querySelector("#flowPromptList").innerHTML = prompts.length
    ? prompts.map(x => `
        <article class="flow-prompt-card">
          <strong>Scene ${x.si + 1} · Prompt ${x.pi + 1}</strong>
          <textarea readonly>${escapeHtml(x.p)}</textarea>
          <button class="secondary-btn copy-prompt-btn" data-prompt="${escapeHtml(x.p)}">Copy Prompt</button>
        </article>`).join("")
    : `<div class="empty">No Flow prompts yet.</div>`;
}

// ---------- Open ----------

export async function openScriptStudio(id) {
  try {
    activeScriptStory = await api(`/api/stories/${encodeURIComponent(id)}`);
  } catch {
    activeScriptStory = getData(STORAGE_KEYS.stories).find(s => s.id === id) || null;
    if (!activeScriptStory) return showToast("Story not found.");
    showToast("Showing cached story; backend is unavailable.");
  }
  populateScriptStudio(activeScriptStory);
  openModal("scriptStudioModal");
}

// ---------- Actions ----------

export async function saveScriptSettings() {
  if (!activeScriptStory) return;
  const script   = activeScriptStory.script || {};
  const settings = {
    ...(script.settings || {}),
    approvedAngle:  document.querySelector("#scriptApprovedAngle").value.trim(),
    audience:       document.querySelector("#scriptAudience").value.trim(),
    targetMinutes:  Number(document.querySelector("#scriptTargetMinutes").value || 7),
    tone:           document.querySelector("#scriptTone").value
  };
  try {
    activeScriptStory = await api(`/api/stories/${activeScriptStory.id}`, {
      method: "PATCH", body: JSON.stringify({ script: { ...script, settings } })
    });
    cacheStory(activeScriptStory);
    showToast("Script settings saved.");
  } catch (error) { showToast(error.message); }
}

export async function generateScriptPackage() {
  if (!activeScriptStory) return;
  await saveScriptSettings();
  const btn = document.querySelector("#generateScriptBtn"), orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Building…";
  try {
    activeScriptStory = await api(`/api/stories/${activeScriptStory.id}/script/generate`, {
      method: "POST", body: JSON.stringify({})
    });
    cacheStory(activeScriptStory);
    populateScriptStudio(activeScriptStory);
    switchScriptTab("script");
    showToast("Script package prepared.");
  } catch (error) { showToast(`Script generation failed: ${error.message}`); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

export async function saveScript() {
  if (!activeScriptStory) return;
  try {
    const s = activeScriptStory.script || {};
    activeScriptStory = await api(`/api/stories/${activeScriptStory.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        script: {
          ...s,
          title:     document.querySelector("#scriptMainTitle").value.trim(),
          hook:      document.querySelector("#scriptHook").value.trim(),
          narration: document.querySelector("#scriptNarration").value.trim(),
          outro:     document.querySelector("#scriptOutro").value.trim()
        }
      })
    });
    cacheStory(activeScriptStory);
    populateScriptStudio(activeScriptStory);
    switchScriptTab("script");
    showToast("Script saved.");
  } catch (error) { showToast(error.message); }
}

export async function regenerateScenes() {
  if (!activeScriptStory) return;
  try {
    activeScriptStory = await api(`/api/stories/${activeScriptStory.id}/script/scenes/generate`, {
      method: "POST", body: JSON.stringify({})
    });
    cacheStory(activeScriptStory);
    _renderScenes(activeScriptStory);
    _renderAssets(activeScriptStory);
    _renderFlowPrompts(activeScriptStory);
    showToast("Scene plan refreshed.");
  } catch (error) { showToast(error.message); }
}

export async function addScene() {
  if (!activeScriptStory) return;
  const scenes = [...(activeScriptStory.script?.scenes || [])];
  scenes.push({
    id: crypto.randomUUID(),
    title: `New Scene ${scenes.length + 1}`,
    duration: "0:00–0:10",
    type: "visual",
    voiceover: "", visual: "", onscreen: "",
    assetSource: "Flow", assetRequirements: [], flowPrompts: []
  });
  try {
    activeScriptStory = await api(`/api/stories/${activeScriptStory.id}`, {
      method: "PATCH",
      body: JSON.stringify({ script: { ...activeScriptStory.script, scenes } })
    });
    cacheStory(activeScriptStory);
    _renderScenes(activeScriptStory);
  } catch (error) { showToast(error.message); }
}

export async function saveSceneField(i, k, v) {
  if (!activeScriptStory) return;
  const scenes = [...(activeScriptStory.script?.scenes || [])];
  if (!scenes[i]) return;
  scenes[i] = { ...scenes[i], [k]: v };
  try {
    activeScriptStory = await api(`/api/stories/${activeScriptStory.id}`, {
      method: "PATCH",
      body: JSON.stringify({ script: { ...activeScriptStory.script, scenes } })
    });
    cacheStory(activeScriptStory);
  } catch (error) { showToast(error.message); }
}

export async function markAsset(id, done) {
  if (!activeScriptStory) return;
  const [si, ai] = String(id).split("-").map(Number);
  const scenes   = [...(activeScriptStory.script?.scenes || [])];
  if (!scenes[si]?.assetRequirements?.[ai]) return;
  scenes[si].assetRequirements[ai].completed = done;
  try {
    activeScriptStory = await api(`/api/stories/${activeScriptStory.id}`, {
      method: "PATCH",
      body: JSON.stringify({ script: { ...activeScriptStory.script, scenes } })
    });
    cacheStory(activeScriptStory);
    _renderAssets(activeScriptStory);
  } catch (error) { showToast(error.message); }
}
