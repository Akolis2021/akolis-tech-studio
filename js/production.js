// AKOLIS TECH STUDIO — Production Studio + Media Engine (V8)

import { api, escapeHtml, formatDate, formatBytes, showToast, openModal, getData, saveData, STORAGE_KEYS, API_BASE } from "./core.js";
import { cacheStory } from "./ui.js";

let activeProductionStory = null;

// ---------- Helpers ----------

function storyScenes(story)       { return story?.script?.scenes     || []; }
function productionAssets(story)  { return story?.production?.assets || []; }

function readiness(story) {
  const scenes = storyScenes(story);
  const assets = productionAssets(story);
  // A scene is render-ready once it has both footage and a voiceover clip attached.
  const ready = scenes.filter(scene =>
    assets.some(a => a.role === "footage"   && a.sceneId === scene.id) &&
    assets.some(a => a.role === "voiceover" && a.sceneId === scene.id)
  ).length;
  const percent = scenes.length ? Math.round((ready / scenes.length) * 100) : 0;
  return { total: scenes.length, ready, percent };
}

function downloadTextFile(filename, text, type = "application/json") {
  const blob   = new Blob([text], { type });
  const url    = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}

// Persists a change to one scene by rebuilding the full scenes array — the
// backend merges `script` shallowly, so the whole array must be resent.
async function patchScene(sceneId, patch) {
  if (!activeProductionStory) return;
  const scenes = storyScenes(activeProductionStory).map(scene =>
    scene.id === sceneId ? { ...scene, ...patch } : scene
  );
  const updated = await api(`/api/stories/${activeProductionStory.id}`, {
    method: "PATCH",
    body: JSON.stringify({ script: { ...activeProductionStory.script, scenes } })
  });
  activeProductionStory = updated;
  cacheStory(updated);
  return updated;
}

// ---------- Open ----------

export async function openProductionStudio(storyId) {
  try {
    const story = await api(`/api/stories/${encodeURIComponent(storyId)}`);
    activeProductionStory = story;
    populateProductionStudio(story);
    openModal("productionStudioModal");
  } catch {
    const story = getData(STORAGE_KEYS.stories).find(s => s.id === storyId);
    if (!story) return showToast("Story not found.");
    activeProductionStory = story;
    populateProductionStudio(story);
    openModal("productionStudioModal");
    showToast("Using cached story; backend is unavailable.");
  }
}

// ---------- Populate ----------

function populateProductionStudio(story) {
  document.querySelector("#productionTitle").textContent    = story.title;
  document.querySelector("#productionSubtitle").textContent =
    `${story.source} · ${story.script?.title || "No script title"} · ${story.script?.durationMinutes || "—"} min`;
  const ready = readiness(story);
  document.querySelector("#productionReadiness").textContent = `${ready.ready}/${ready.total} scenes ready`;

  _renderProductionScenes(story);
  _renderProductionAssets(story);
  _populateMixTab(story);
  _renderRenderManifest(story);
  switchProductionTab("timeline");
  refreshRenderJobs();
}

// ---------- Tab switching ----------

export function switchProductionTab(name) {
  document.querySelectorAll(".production-tab").forEach(tab =>
    tab.classList.toggle("active", tab.dataset.tab === name)
  );
  ["timeline", "assets", "mix", "render"].forEach(tab => {
    const panel = document.querySelector(`#productionPanel${tab[0].toUpperCase()}${tab.slice(1)}`);
    if (panel) panel.classList.toggle("hidden", tab !== name);
  });
}

// ---------- Internal renderers: scenes ----------

function _renderProductionScenes(story) {
  const list   = document.querySelector("#productionSceneList");
  const scenes = storyScenes(story);

  if (!scenes.length) {
    list.innerHTML = `<div class="empty">No script scenes yet. Generate the script package first.</div>`;
    return;
  }

  const assets = productionAssets(story);
  list.innerHTML = scenes.map((scene, index) => {
    const footageAsset   = assets.find(a => a.role === "footage"   && a.sceneId === scene.id);
    const voiceoverAsset = assets.find(a => a.role === "voiceover" && a.sceneId === scene.id);
    const captions       = scene.captions || [];
    const overlays       = scene.overlays || [];
    const durationLabel  = voiceoverAsset?.duration
      ? `${voiceoverAsset.duration.toFixed(1)}s (from voiceover)`
      : (scene.duration || "Duration set once voiceover is attached");

    return `
      <article class="production-scene-card" data-scene-id="${escapeHtml(scene.id)}">
        <div class="production-scene-head">
          <div>
            <strong>Scene ${index + 1} · ${escapeHtml(scene.title || "Untitled")}</strong>
            <div class="meta">${escapeHtml(durationLabel)} · ${escapeHtml(scene.type || "visual")}</div>
          </div>
          <label class="checkbox-label">
            <input type="checkbox" class="include-in-short" data-scene="${escapeHtml(scene.id)}" ${scene.includeInShort ? "checked" : ""}>
            Include in Short
          </label>
        </div>

        <div class="production-scene-body">
          <div>
            <div class="meta">VOICEOVER SCRIPT</div>
            <div style="margin-top:5px;line-height:1.5">${escapeHtml(scene.voiceover || "No voiceover script yet.")}</div>
            <div class="meta" style="margin-top:13px">VISUAL DIRECTION</div>
            <div style="margin-top:5px;line-height:1.5">${escapeHtml(scene.visual || "No visual direction yet.")}</div>
          </div>

          <div>
            <div class="meta">MEDIA</div>
            <div class="scene-media-row">
              <div class="scene-media-item">
                <span class="asset-badge">Footage</span>
                <span>${footageAsset ? escapeHtml(footageAsset.fileName) : "Not attached"}</span>
                <button class="secondary-btn attach-footage-btn" data-scene="${escapeHtml(scene.id)}">
                  ${footageAsset ? "Replace" : "Attach"} Footage
                </button>
              </div>
              <div class="scene-media-item">
                <span class="asset-badge">Voiceover</span>
                <span>${voiceoverAsset ? escapeHtml(voiceoverAsset.fileName) : "Not attached"}</span>
                <button class="secondary-btn attach-voiceover-btn" data-scene="${escapeHtml(scene.id)}">
                  ${voiceoverAsset ? "Replace" : "Attach"} Voiceover
                </button>
              </div>
            </div>

            <div class="meta" style="margin-top:14px">CAPTIONS</div>
            <label class="checkbox-label" style="margin-top:6px">
              <input type="checkbox" class="captions-enabled" data-scene="${escapeHtml(scene.id)}" ${scene.captionsEnabled !== false ? "checked" : ""}>
              Burn captions into this scene
            </label>
            <div class="caption-list">
              ${captions.length
                ? captions.map(c => `<div class="caption-row"><span class="meta">${c.start}s-${c.end}s</span> ${escapeHtml(c.text)}</div>`).join("")
                : `<div class="empty small">No captions yet - attach a voiceover to auto-generate them.</div>`}
            </div>
            <button class="secondary-btn regenerate-captions-btn" data-scene="${escapeHtml(scene.id)}" ${voiceoverAsset ? "" : "disabled"}>
              Regenerate Captions
            </button>

            <div class="meta" style="margin-top:14px">TITLE / LOWER-THIRD OVERLAYS</div>
            <div class="overlay-list">
              ${overlays.length
                ? overlays.map(o => `
                    <div class="overlay-row">
                      <span class="asset-badge">${escapeHtml(o.type)}</span>
                      <span>${escapeHtml(o.text)}</span>
                      <span class="meta">${o.start}s-${o.end}s</span>
                      <button class="danger-btn remove-overlay-btn" data-scene="${escapeHtml(scene.id)}" data-overlay="${escapeHtml(o.id)}">Remove</button>
                    </div>`).join("")
                : `<div class="empty small">No overlays on this scene.</div>`}
            </div>
            <div class="overlay-add-form" data-scene="${escapeHtml(scene.id)}">
              <select class="overlay-type-input">
                <option value="title">Title</option>
                <option value="lower-third">Lower-third</option>
              </select>
              <input class="overlay-text-input" type="text" placeholder="Overlay text" maxlength="60">
              <input class="overlay-start-input" type="number" min="0" step="0.5" placeholder="Start (s)" value="0">
              <input class="overlay-end-input" type="number" min="0" step="0.5" placeholder="End (s)" value="3">
              <button class="secondary-btn add-overlay-btn" data-scene="${escapeHtml(scene.id)}">Add Overlay</button>
            </div>
          </div>
        </div>
      </article>`;
  }).join("");
}

// ---------- Internal renderers: assets, mix, manifest, jobs ----------

function _renderProductionAssets(story) {
  const list   = document.querySelector("#productionAssetList");
  const assets = productionAssets(story).filter(a => a.role === "footage" && !a.sceneId);

  list.innerHTML = assets.length
    ? assets.map(asset => `
        <article class="production-asset">
          <div>
            <div>
              <span class="asset-badge">${escapeHtml(asset.mediaType || "file")}</span>
              <strong>${escapeHtml(asset.fileName)}</strong>
            </div>
            <div class="meta">
              ${escapeHtml(asset.status || "uploaded")} - ${formatBytes(asset.size || 0)}
              ${asset.duration ? ` - ${asset.duration.toFixed(1)}s` : ""}
            </div>
          </div>
          <div class="asset-actions">
            <button class="danger-btn delete-asset-btn" data-id="${asset.id}">Remove</button>
          </div>
        </article>`).join("")
    : `<div class="empty">No unassigned b-roll uploaded. Scene-specific footage is attached from the Timeline tab.</div>`;
}

function _populateMixTab(story) {
  const music = story.production?.music;
  const assets = productionAssets(story);
  const musicAsset = music?.assetId ? assets.find(a => a.id === music.assetId) : null;

  document.querySelector("#musicCurrentTrack").textContent = musicAsset
    ? `Current track: ${musicAsset.fileName}${musicAsset.duration ? ` (${musicAsset.duration.toFixed(1)}s, loops to fit)` : ""}`
    : "No music track uploaded yet.";
  document.querySelector("#musicVolume").value  = music?.volume ?? 0.15;
  document.querySelector("#musicEnabled").checked = music?.enabled !== false;

  document.querySelector("#transitionSelect").value   = story.production?.transition || "cut";
  document.querySelector("#transitionDuration").value = story.production?.transitionDuration ?? 0.5;
  document.querySelector("#cropModeSelect").value      = story.production?.cropMode || "pad";
}

function _renderRenderManifest(story) {
  const ready  = readiness(story);
  const scenes = storyScenes(story);
  const assets = productionAssets(story);
  const production = story.production || {};

  const manifest = {
    schema:      "akolis-tech-studio-render-v2",
    generatedAt: new Date().toISOString(),
    story:       { id: story.id, title: story.title },
    readiness:   ready,
    mix: {
      music:              production.music || null,
      transition:         production.transition || "cut",
      transitionDuration: production.transitionDuration ?? 0.5,
      cropMode:           production.cropMode || "pad"
    },
    scenes: scenes.map((scene, index) => ({
      index:           index + 1,
      id:              scene.id,
      title:           scene.title,
      durationSeconds: scene.durationSeconds || null,
      footage:         assets.find(a => a.role === "footage"   && a.sceneId === scene.id)?.fileName || null,
      voiceover:       assets.find(a => a.role === "voiceover" && a.sceneId === scene.id)?.fileName || null,
      captionsEnabled: scene.captionsEnabled !== false,
      captionCount:    (scene.captions || []).length,
      overlays:        scene.overlays || [],
      includeInShort:  Boolean(scene.includeInShort)
    }))
  };

  document.querySelector("#renderSummary").innerHTML = `
    <span class="summary-pill">${ready.ready}/${ready.total} scenes render-ready</span>
    <span class="summary-pill">${production.music?.enabled ? "Music on" : "No music"}</span>
    <span class="summary-pill">${production.transition === "crossfade" ? "Crossfade" : "Hard cut"} transitions</span>
    <span class="summary-pill">${production.cropMode === "crop" ? "Crop" : "Pad"} framing</span>`;
  const json = JSON.stringify(manifest, null, 2);
  document.querySelector("#renderManifest").textContent      = json;
  document.querySelector("#renderManifest").dataset.manifest = json;
}

function _renderRenderJobsList(jobs) {
  const container = document.querySelector("#renderJobs");
  if (!jobs.length) {
    container.innerHTML = `<div class="empty">No render jobs yet.</div>`;
    return;
  }
  container.innerHTML = jobs.map(job => `
    <article class="render-job">
      <div>
        <div>
          <strong>${escapeHtml(job.presetLabel || job.format)}</strong> -
          <span class="job-status ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
        </div>
        <div class="meta">${escapeHtml(job.id)} - ${escapeHtml(formatDate(job.createdAt))}</div>
        ${(job.warnings || []).length
          ? `<div class="meta" style="color:var(--warning,#b58900);margin-top:5px">${job.warnings.map(escapeHtml).join(" - ")}</div>`
          : ""}
        ${job.error
          ? `<div class="meta" style="color:var(--danger);margin-top:5px">${escapeHtml(job.error)}</div>`
          : ""}
        ${job.outputUrl
          ? `<a class="job-link" href="${escapeHtml(job.outputUrl)}" target="_blank" rel="noopener">Open rendered video</a>`
          : ""}
      </div>
      <div class="meta">${job.progress ?? 0}%</div>
    </article>`).join("");
}

// ---------- Render jobs ----------

export async function refreshRenderJobs() {
  if (!activeProductionStory) return;
  try {
    const jobs = await api(`/api/stories/${encodeURIComponent(activeProductionStory.id)}/render`);
    _renderRenderJobsList(jobs);
  } catch (error) {
    console.warn("Render job poll failed:", error.message);
  }
}

export async function createRenderJob() {
  if (!activeProductionStory) return;
  const format = document.querySelector("#renderPresetSelect").value;
  const btn  = document.querySelector("#prepareRenderBtn");
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Queueing...";
  try {
    const response = await api(
      `/api/stories/${encodeURIComponent(activeProductionStory.id)}/render`,
      { method: "POST", body: JSON.stringify({ format }) }
    );
    showToast(`Render job queued: ${response.job.presetLabel}.`);
    await refreshRenderJobs();
  } catch (error) {
    showToast(`Render queue failed: ${error.message}`);
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

export function startRenderPoller() {
  setInterval(async () => {
    const modal = document.querySelector("#productionStudioModal");
    if (!modal || modal.classList.contains("hidden")) return;
    await refreshRenderJobs();
  }, 3000);
}

// ---------- Asset upload (general b-roll, unassigned) ----------

export async function handleAssetFiles(files) {
  if (!activeProductionStory || !files?.length) return;
  let uploaded = 0;
  for (const file of files) {
    try {
      await _uploadOne(file, "footage", null);
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

// ---------- Scene-level footage / voiceover upload ----------

export async function handleSceneFootageFile(file, sceneId) {
  if (!activeProductionStory || !file) return;
  try {
    await _uploadOne(file, "footage", sceneId);
    populateProductionStudio(activeProductionStory);
    showToast("Footage attached.");
  } catch (error) { showToast(`Upload failed: ${error.message}`); }
}

export async function handleSceneVoiceoverFile(file, sceneId) {
  if (!activeProductionStory || !file) return;
  try {
    await _uploadOne(file, "voiceover", sceneId);
    populateProductionStudio(activeProductionStory);
    showToast("Voiceover attached - scene duration and captions updated.");
  } catch (error) { showToast(`Upload failed: ${error.message}`); }
}

export async function handleMusicFile(file) {
  if (!activeProductionStory || !file) return;
  try {
    await _uploadOne(file, "music", null);
    populateProductionStudio(activeProductionStory);
    showToast("Music track uploaded.");
  } catch (error) { showToast(`Upload failed: ${error.message}`); }
}

async function _uploadOne(file, role, sceneId) {
  const form = new FormData();
  form.append("file", file);
  form.append("role", role);
  if (sceneId) form.append("sceneId", sceneId);

  const response = await fetch(
    `${API_BASE}/api/stories/${encodeURIComponent(activeProductionStory.id)}/production/upload`,
    { method: "POST", body: form }
  );
  if (!response.ok) throw new Error(await response.text());
  const updated = await response.json();
  activeProductionStory = updated;
  cacheStory(updated);
  return updated;
}

// ---------- Asset removal ----------

export async function removeProductionAsset(id) {
  if (!activeProductionStory) return;
  const production = activeProductionStory.production || {};
  const assets      = (production.assets || []).filter(a => a.id !== id);
  try {
    const updated = await api(`/api/stories/${activeProductionStory.id}`, {
      method: "PATCH",
      body: JSON.stringify({ production: { ...production, assets } })
    });
    activeProductionStory = updated;
    cacheStory(updated);
    populateProductionStudio(updated);
    showToast("Asset removed.");
  } catch (error) { showToast(error.message); }
}

// ---------- Scene-level: captions, overlays, Short toggle ----------

export async function toggleCaptionsEnabled(sceneId, enabled) {
  try {
    await patchScene(sceneId, { captionsEnabled: enabled });
  } catch (error) { showToast(error.message); }
}

export async function regenerateCaptions(sceneId) {
  if (!activeProductionStory) return;
  try {
    const updated = await api(
      `/api/stories/${activeProductionStory.id}/script/scenes/${encodeURIComponent(sceneId)}/captions/generate`,
      { method: "POST", body: JSON.stringify({}) }
    );
    activeProductionStory = updated;
    cacheStory(updated);
    _renderProductionScenes(updated);
    showToast("Captions regenerated.");
  } catch (error) { showToast(error.message); }
}

export async function toggleIncludeInShort(sceneId, value) {
  try {
    await patchScene(sceneId, { includeInShort: value });
  } catch (error) { showToast(error.message); }
}

export async function addOverlay(sceneId, overlay) {
  if (!activeProductionStory) return;
  const scene = storyScenes(activeProductionStory).find(s => s.id === sceneId);
  if (!scene) return;
  const overlays = [...(scene.overlays || []), { id: crypto.randomUUID(), ...overlay }];
  try {
    await patchScene(sceneId, { overlays });
    _renderProductionScenes(activeProductionStory);
    showToast("Overlay added.");
  } catch (error) { showToast(error.message); }
}

export async function removeOverlay(sceneId, overlayId) {
  if (!activeProductionStory) return;
  const scene = storyScenes(activeProductionStory).find(s => s.id === sceneId);
  if (!scene) return;
  const overlays = (scene.overlays || []).filter(o => o.id !== overlayId);
  try {
    await patchScene(sceneId, { overlays });
    _renderProductionScenes(activeProductionStory);
  } catch (error) { showToast(error.message); }
}

// ---------- Mix settings: music + transitions + crop ----------

export async function saveMusicSettings() {
  if (!activeProductionStory) return;
  const volume  = Number(document.querySelector("#musicVolume").value);
  const enabled = document.querySelector("#musicEnabled").checked;
  try {
    const updated = await api(`/api/stories/${activeProductionStory.id}/production/music`, {
      method: "PATCH", body: JSON.stringify({ volume, enabled })
    });
    activeProductionStory = updated;
    cacheStory(updated);
    _renderRenderManifest(updated);
    showToast("Music settings saved.");
  } catch (error) { showToast(error.message); }
}

export async function saveMixSettings() {
  if (!activeProductionStory) return;
  const transition         = document.querySelector("#transitionSelect").value;
  const transitionDuration = Number(document.querySelector("#transitionDuration").value);
  const cropMode            = document.querySelector("#cropModeSelect").value;
  try {
    const updated = await api(`/api/stories/${activeProductionStory.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        production: { ...(activeProductionStory.production || {}), transition, transitionDuration, cropMode }
      })
    });
    activeProductionStory = updated;
    cacheStory(updated);
    _renderRenderManifest(updated);
    showToast("Framing settings saved.");
  } catch (error) { showToast(error.message); }
}

// ---------- Manifest download ----------

export function downloadManifest() {
  const manifest = document.querySelector("#renderManifest").dataset.manifest || "{}";
  const id       = activeProductionStory?.id || "project";
  downloadTextFile(`${id}-render-manifest.json`, manifest);
}
