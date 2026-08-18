// AKOLIS TECH STUDIO — Entry point
// Handles initialization, feed refresh, source/project CRUD, and ALL event binding.
// Nothing is rendered or fetched from this file directly — it delegates to modules.

import { api, showToast, openModal, closeModal, getData, saveData, STORAGE_KEYS } from "./core.js";
import { renderAll } from "./ui.js";
import {
  openResearchStudio, switchResearchTab,
  saveResearchBrief, generateResearch,
  addResearchSource, removeResearchSource,
  addClaim, removeClaim,
  generateAngles, saveAngle, handleAngleClick
} from "./research.js";
import {
  openScriptStudio, switchScriptTab,
  saveScriptSettings, generateScriptPackage,
  saveScript, regenerateScenes, addScene,
  saveSceneField, markAsset
} from "./script.js";
import {
  openProductionStudio, switchProductionTab,
  handleAssetFiles, handleSceneFootageFile, handleSceneVoiceoverFile, handleMusicFile,
  createRenderJob, downloadManifest,
  removeProductionAsset, startRenderPoller,
  toggleCaptionsEnabled, regenerateCaptions,
  toggleIncludeInShort, addOverlay, removeOverlay,
  saveMusicSettings, saveMixSettings
} from "./production.js";

// ─── Initialization ───────────────────────────────────────────────────────────

async function initialize() {
  if (!localStorage.getItem(STORAGE_KEYS.sources))  saveData(STORAGE_KEYS.sources,  []);
  if (!localStorage.getItem(STORAGE_KEYS.stories))  saveData(STORAGE_KEYS.stories,  []);
  if (!localStorage.getItem(STORAGE_KEYS.projects)) saveData(STORAGE_KEYS.projects, []);

  try {
    const [sources, stories, projects] = await Promise.all([
      api("/api/sources"),
      api("/api/stories"),
      api("/api/projects")
    ]);
    saveData(STORAGE_KEYS.sources,  sources);
    saveData(STORAGE_KEYS.stories,  stories);
    saveData(STORAGE_KEYS.projects, projects);
    showToast("Connected to backend.");
  } catch (error) {
    console.warn("Backend unavailable, falling back to local cache.", error);
    showToast("Backend unavailable — local cache only.");
  }
  renderAll();
}

// ─── Feed refresh ─────────────────────────────────────────────────────────────

async function refreshFeeds() {
  const btn  = document.querySelector("#refreshFeedsBtn");
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Refreshing…";
  try {
    const result = await api("/api/feeds/refresh", { method: "POST", body: JSON.stringify({}) });
    saveData(STORAGE_KEYS.stories, result.stories || []);
    saveData(STORAGE_KEYS.sources, result.sources || []);
    renderAll();
    const fails = result.errors?.length ? ` ${result.errors.length} source(s) failed.` : "";
    showToast(`Refresh complete: ${result.added} new stories.${fails}`);
  } catch (error) {
    showToast(`Feed refresh failed: ${error.message}`);
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

// ─── Sources ──────────────────────────────────────────────────────────────────

async function addSource(source) {
  try {
    const created = await api("/api/sources", { method: "POST", body: JSON.stringify(source) });
    saveData(STORAGE_KEYS.sources, [created, ...getData(STORAGE_KEYS.sources)]);
    renderAll(); showToast("Source added.");
  } catch (error) { showToast(error.message); }
}

async function toggleSource(id, active) {
  try {
    const updated = await api(`/api/sources/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ active: !active }) });
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

// ─── Projects ─────────────────────────────────────────────────────────────────

async function createProject(data) {
  const project = {
    id:            crypto.randomUUID(),
    title:         data.title,
    angle:         data.angle,
    length:        data.length,
    status:        "Planning",
    progress:      5,
    sourceStoryId: data.sourceStoryId || null,
    createdAt:     new Date().toISOString()
  };

  // Persist to backend; fall back silently to local-only if unreachable.
  try {
    const saved = await api("/api/projects", { method: "POST", body: JSON.stringify(project) });
    saveData(STORAGE_KEYS.projects, [saved, ...getData(STORAGE_KEYS.projects)]);
  } catch {
    saveData(STORAGE_KEYS.projects, [project, ...getData(STORAGE_KEYS.projects)]);
  }

  // Mark the source story as "Research" on both backend and cache.
  if (data.sourceStoryId) {
    const stories = getData(STORAGE_KEYS.stories);
    const story   = stories.find(s => s.id === data.sourceStoryId);
    if (story) {
      story.status = "Research";
      saveData(STORAGE_KEYS.stories, stories);
      api(`/api/stories/${story.id}`, {
        method: "PATCH", body: JSON.stringify({ status: "Research" })
      }).catch(() => {}); // non-blocking; dashboard already reflects the change
    }
  }

  renderAll();
  showToast("Project created.");
}

// ─── Event binding ────────────────────────────────────────────────────────────

// Topbar
document.querySelector("#refreshFeedsBtn").addEventListener("click", refreshFeeds);
document.querySelector("#addSourceBtn").addEventListener("click",   () => openModal("sourceModal"));

// Modal close — [data-close] attribute on any close button
document.querySelectorAll("[data-close]").forEach(btn =>
  btn.addEventListener("click", () => closeModal(btn.dataset.close))
);
// Click outside modal card to dismiss
document.querySelectorAll(".modal").forEach(modal =>
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(modal.id); })
);

// Story filters
document.querySelector("#storySearch").addEventListener("input",  renderAll);
document.querySelector("#topicFilter").addEventListener("change", renderAll);
document.querySelector("#storyStatusFilter").addEventListener("change", renderAll);

// Story list — Research / Script / Production buttons
document.querySelector("#storyList").addEventListener("click", async e => {
  const research   = e.target.closest(".research-story");
  const script     = e.target.closest(".script-story");
  const production = e.target.closest(".production-story");
  if (research)   await openResearchStudio(research.dataset.id);
  else if (script)     await openScriptStudio(script.dataset.id);
  else if (production) await openProductionStudio(production.dataset.id);
});

// Project form
document.querySelector("#projectForm").addEventListener("submit", async e => {
  e.preventDefault();
  await createProject({
    title:         document.querySelector("#projectTitle").value.trim(),
    angle:         document.querySelector("#projectAngle").value.trim(),
    length:        document.querySelector("#projectLength").value,
    sourceStoryId: e.target.dataset.storyId || null
  });
  e.target.reset();
  delete e.target.dataset.storyId;
  closeModal("projectModal");
});

// Project card → open production studio for that story
document.querySelector("#projectList").addEventListener("click", async e => {
  const card = e.target.closest(".project-card");
  if (!card) return;
  const title = card.querySelector(".story-title")?.textContent;
  const story = getData(STORAGE_KEYS.stories).find(s => s.title === title);
  if (story) await openProductionStudio(story.id);
});

// Source form
document.querySelector("#sourceForm").addEventListener("submit", async e => {
  e.preventDefault();
  await addSource({
    name:  document.querySelector("#sourceName").value.trim(),
    url:   document.querySelector("#sourceUrl").value.trim(),
    type:  document.querySelector("#sourceType").value,
    topic: document.querySelector("#sourceTopic").value
  });
  e.target.reset();
  closeModal("sourceModal");
});

// Source list — toggle / delete
document.querySelector("#sourceList").addEventListener("click", async e => {
  const toggle = e.target.closest(".toggle-source");
  const del    = e.target.closest(".delete-source");
  if (toggle) await toggleSource(toggle.dataset.id, toggle.dataset.active === "true");
  if (del && confirm("Remove this source?")) await deleteSource(del.dataset.id);
});

// ── Research Studio ──
document.querySelectorAll(".research-tab").forEach(btn =>
  btn.addEventListener("click", () => switchResearchTab(btn.dataset.tab))
);
document.querySelector("#saveResearchBtn").addEventListener("click",    saveResearchBrief);
document.querySelector("#generateResearchBtn").addEventListener("click", generateResearch);
document.querySelector("#addResearchSourceBtn").addEventListener("click", addResearchSource);
document.querySelector("#addClaimBtn").addEventListener("click",        addClaim);
document.querySelector("#generateAnglesBtn").addEventListener("click",  generateAngles);
document.querySelector("#saveAngleBtn").addEventListener("click",       saveAngle);
document.querySelector("#researchSourceList").addEventListener("click", async e => {
  const btn = e.target.closest(".remove-research-source");
  if (btn) await removeResearchSource(btn.dataset.id);
});
document.querySelector("#claimList").addEventListener("click", async e => {
  const btn = e.target.closest(".remove-claim");
  if (btn) await removeClaim(btn.dataset.id);
});
document.querySelector("#angleList").addEventListener("click", handleAngleClick);

// ── Script Studio ──
document.querySelectorAll(".script-tab").forEach(btn =>
  btn.addEventListener("click", () => switchScriptTab(btn.dataset.tab))
);
document.querySelector("#saveScriptSettingsBtn").addEventListener("click", saveScriptSettings);
document.querySelector("#generateScriptBtn").addEventListener("click",    generateScriptPackage);
document.querySelector("#saveScriptBtn").addEventListener("click",        saveScript);
document.querySelector("#regenerateScenesBtn").addEventListener("click",  regenerateScenes);
document.querySelector("#addSceneBtn").addEventListener("click",          addScene);
document.querySelector("#sceneList").addEventListener("change", e => {
  if (e.target.classList.contains("scene-field"))
    saveSceneField(Number(e.target.dataset.i), e.target.dataset.k, e.target.value);
});
document.querySelector("#assetChecklist").addEventListener("change", e => {
  if (e.target.classList.contains("asset-check"))
    markAsset(e.target.dataset.id, e.target.checked);
});
document.querySelector("#flowPromptList").addEventListener("click", async e => {
  const btn = e.target.closest(".copy-prompt-btn");
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.prompt);
    showToast("Flow prompt copied.");
  } catch { showToast("Could not copy automatically."); }
});

// ── Production Studio ──
document.querySelectorAll(".production-tab").forEach(btn =>
  btn.addEventListener("click", () => switchProductionTab(btn.dataset.tab))
);
document.querySelector("#prepareRenderBtn").addEventListener("click",    createRenderJob);
document.querySelector("#downloadManifestBtn").addEventListener("click", downloadManifest);
document.querySelector("#saveMusicSettingsBtn").addEventListener("click", saveMusicSettings);
document.querySelector("#saveMixSettingsBtn").addEventListener("click",   saveMixSettings);

// General b-roll upload (Assets tab)
document.querySelector("#chooseAssetBtn").addEventListener("click", () =>
  document.querySelector("#assetFileInput").click()
);
document.querySelector("#assetUploadZone").addEventListener("click", e => {
  if (!e.target.closest("button")) document.querySelector("#assetFileInput").click();
});
document.querySelector("#assetUploadZone").addEventListener("dragover", e => {
  e.preventDefault();
  document.querySelector("#assetUploadZone").classList.add("dragover");
});
document.querySelector("#assetUploadZone").addEventListener("dragleave", () =>
  document.querySelector("#assetUploadZone").classList.remove("dragover")
);
document.querySelector("#assetUploadZone").addEventListener("drop", async e => {
  e.preventDefault();
  document.querySelector("#assetUploadZone").classList.remove("dragover");
  await handleAssetFiles([...e.dataTransfer.files]);
});
document.querySelector("#assetFileInput").addEventListener("change", async e => {
  await handleAssetFiles([...e.currentTarget.files]);
  e.currentTarget.value = "";
});

// Music upload (Mix tab)
document.querySelector("#chooseMusicBtn").addEventListener("click", () =>
  document.querySelector("#musicFileInput").click()
);
document.querySelector("#musicUploadZone").addEventListener("click", e => {
  if (!e.target.closest("button")) document.querySelector("#musicFileInput").click();
});
document.querySelector("#musicFileInput").addEventListener("change", async e => {
  const [file] = e.currentTarget.files;
  if (file) await handleMusicFile(file);
  e.currentTarget.value = "";
});

// Scene footage attach
document.querySelector("#sceneFootageFileInput").addEventListener("change", async e => {
  const input = e.currentTarget;
  const [file] = input.files;
  if (file && input.dataset.sceneId) await handleSceneFootageFile(file, input.dataset.sceneId);
  input.value = "";
  delete input.dataset.sceneId;
});

// Scene voiceover attach
document.querySelector("#sceneVoiceoverFileInput").addEventListener("change", async e => {
  const input = e.currentTarget;
  const [file] = input.files;
  if (file && input.dataset.sceneId) await handleSceneVoiceoverFile(file, input.dataset.sceneId);
  input.value = "";
  delete input.dataset.sceneId;
});

// Delegated clicks across the whole Production Studio modal
document.querySelector("#productionStudioModal").addEventListener("click", async e => {
  const attachFootage   = e.target.closest(".attach-footage-btn");
  const attachVoiceover = e.target.closest(".attach-voiceover-btn");
  const regenCaptions   = e.target.closest(".regenerate-captions-btn");
  const addOverlayBtn   = e.target.closest(".add-overlay-btn");
  const removeOverlayBtn = e.target.closest(".remove-overlay-btn");
  const removeAsset     = e.target.closest(".delete-asset-btn");

  if (attachFootage) {
    const input = document.querySelector("#sceneFootageFileInput");
    input.dataset.sceneId = attachFootage.dataset.scene;
    input.click();
  }
  if (attachVoiceover) {
    const input = document.querySelector("#sceneVoiceoverFileInput");
    input.dataset.sceneId = attachVoiceover.dataset.scene;
    input.click();
  }
  if (regenCaptions && !regenCaptions.disabled) await regenerateCaptions(regenCaptions.dataset.scene);
  if (removeAsset) await removeProductionAsset(removeAsset.dataset.id);

  if (addOverlayBtn) {
    const form = addOverlayBtn.closest(".overlay-add-form");
    const overlay = {
      type:  form.querySelector(".overlay-type-input").value,
      text:  form.querySelector(".overlay-text-input").value.trim(),
      start: Number(form.querySelector(".overlay-start-input").value || 0),
      end:   Number(form.querySelector(".overlay-end-input").value || 3)
    };
    if (!overlay.text) { showToast("Enter overlay text first."); return; }
    await addOverlay(addOverlayBtn.dataset.scene, overlay);
  }
  if (removeOverlayBtn) await removeOverlay(removeOverlayBtn.dataset.scene, removeOverlayBtn.dataset.overlay);
});

// Delegated changes (checkboxes) across the Production Studio modal
document.querySelector("#productionStudioModal").addEventListener("change", async e => {
  const captionsToggle = e.target.closest(".captions-enabled");
  const shortToggle     = e.target.closest(".include-in-short");
  if (captionsToggle) await toggleCaptionsEnabled(captionsToggle.dataset.scene, captionsToggle.checked);
  if (shortToggle)     await toggleIncludeInShort(shortToggle.dataset.scene, shortToggle.checked);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
startRenderPoller();
initialize();
