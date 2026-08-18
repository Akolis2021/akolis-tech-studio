// AKOLIS TECH STUDIO — Research Studio (V4)

import { api, escapeHtml, formatDate, showToast, openModal, getData, STORAGE_KEYS } from "./core.js";
import { cacheStory, renderAll } from "./ui.js";

// Active story for this studio — module-scoped, updated on open.
let activeResearchStory = null;

// ---------- Open ----------

export async function openResearchStudio(storyId) {
  try {
    const story = await api(`/api/stories/${encodeURIComponent(storyId)}`);
    activeResearchStory = story;
    populateResearchStudio(story);
    openModal("researchStudioModal");
  } catch (fetchError) {
    // Fall back to local cache when backend is unreachable.
    const story = getData(STORAGE_KEYS.stories).find(s => s.id === storyId);
    if (!story) return showToast("Story could not be opened.");
    activeResearchStory = story;
    populateResearchStudio(story);
    openModal("researchStudioModal");
    showToast("Showing cached story; backend is unavailable.");
  }
}

// ---------- Populate ----------

function populateResearchStudio(story) {
  document.querySelector("#researchTitle").textContent    = story.title;
  document.querySelector("#researchSubtitle").textContent =
    `${story.source} · ${story.topic || "Unclassified"} · ${formatDate(story.publishedAt)}`;
  document.querySelector("#researchScore").textContent    = `${story.score ?? "—"}/100`;

  const brief = story.research?.brief || {};
  document.querySelector("#researchWhatHappened").value    = brief.whatHappened    || story.summary || "";
  document.querySelector("#researchWhyMatters").value      = brief.whyMatters      || "";
  document.querySelector("#researchDeveloperImpact").value = brief.developerImpact || "";
  document.querySelector("#researchCaveats").value         = brief.caveats         || "";
  document.querySelector("#approvedAngle").value           = story.research?.approvedAngle || story.angle || "";

  _renderResearchSources(story);
  _renderClaims(story);
  _renderAngles(story);
  switchResearchTab("brief");
}

// ---------- Tab switching ----------

export function switchResearchTab(name) {
  document.querySelectorAll(".research-tab").forEach(tab =>
    tab.classList.toggle("active", tab.dataset.tab === name)
  );
  ["brief", "sources", "claims", "angles"].forEach(tab => {
    const panel = document.querySelector(`#researchPanel${tab[0].toUpperCase()}${tab.slice(1)}`);
    if (panel) panel.classList.toggle("hidden", tab !== name);
  });
}

// ---------- Internal renderers ----------

function _renderResearchSources(story) {
  const list    = document.querySelector("#researchSourceList");
  const sources = story.researchSources || [];
  list.innerHTML = sources.length
    ? sources.map(s => `
        <article class="research-source-item">
          <div>
            <div class="research-source-role">${escapeHtml(s.role)}</div>
            <a class="source-url-small" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">
              ${escapeHtml(s.url)}
            </a>
            ${s.title ? `<div class="meta" style="margin-top:6px">${escapeHtml(s.title)}</div>` : ""}
          </div>
          <button class="danger-btn remove-research-source" data-id="${s.id}">Remove</button>
        </article>`).join("")
    : `<div class="empty">No research sources yet. Add the original announcement and supporting sources.</div>`;
}

function _renderClaims(story) {
  const list   = document.querySelector("#claimList");
  const claims = story.claims || [];
  list.innerHTML = claims.length
    ? claims.map(c => `
        <article class="claim-item">
          <div>${escapeHtml(c.text)}</div>
          <span class="confidence ${escapeHtml(c.confidence)}">${escapeHtml(c.confidence)}</span>
          <button class="danger-btn remove-claim" data-id="${c.id}">Remove</button>
        </article>`).join("")
    : `<div class="empty">No claims recorded yet. Extract the facts you plan to say on camera.</div>`;
}

function _renderAngles(story) {
  const list   = document.querySelector("#angleList");
  const angles = story.research?.angles || [];
  list.innerHTML = angles.length
    ? angles.map((angle, i) => `
        <article class="angle-item ${story.research?.selectedAngleIndex === i ? "selected" : ""}" data-index="${i}">
          <strong>${escapeHtml(angle.title || `Angle ${i + 1}`)}</strong>
          <div class="meta" style="margin-top:6px">${escapeHtml(angle.description || angle)}</div>
        </article>`).join("")
    : `<div class="empty">No angles generated yet.</div>`;
}

// ---------- Actions ----------

export async function saveResearchBrief() {
  if (!activeResearchStory) return;
  const brief = {
    whatHappened:    document.querySelector("#researchWhatHappened").value.trim(),
    whyMatters:      document.querySelector("#researchWhyMatters").value.trim(),
    developerImpact: document.querySelector("#researchDeveloperImpact").value.trim(),
    caveats:         document.querySelector("#researchCaveats").value.trim()
  };
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}`, {
      method: "PATCH",
      body: JSON.stringify({ research: { ...activeResearchStory.research, brief } })
    });
    activeResearchStory = updated;
    cacheStory(updated);
    showToast("Research brief saved.");
  } catch (error) { showToast(error.message); }
}

export async function generateResearch() {
  if (!activeResearchStory) return;
  const btn = document.querySelector("#generateResearchBtn");
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Researching…";
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
  } finally { btn.disabled = false; btn.textContent = orig; }
}

export async function addResearchSource() {
  if (!activeResearchStory) return;
  const url  = document.querySelector("#researchSourceUrl").value.trim();
  const role = document.querySelector("#researchSourceRole").value;
  if (!url) return showToast("Enter a source URL.");
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}/sources`, {
      method: "POST", body: JSON.stringify({ url, role })
    });
    activeResearchStory = updated;
    cacheStory(updated);
    _renderResearchSources(updated);
    document.querySelector("#researchSourceUrl").value = "";
    showToast("Research source added.");
  } catch (error) { showToast(error.message); }
}

export async function removeResearchSource(id) {
  if (!activeResearchStory) return;
  try {
    const updated = await api(
      `/api/stories/${activeResearchStory.id}/sources/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    activeResearchStory = updated;
    cacheStory(updated);
    _renderResearchSources(updated);
  } catch (error) { showToast(error.message); }
}

export async function addClaim() {
  if (!activeResearchStory) return;
  const text       = document.querySelector("#claimText").value.trim();
  const confidence = document.querySelector("#claimConfidence").value;
  if (!text) return showToast("Enter a claim.");
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}/claims`, {
      method: "POST", body: JSON.stringify({ text, confidence })
    });
    activeResearchStory = updated;
    cacheStory(updated);
    _renderClaims(updated);
    document.querySelector("#claimText").value = "";
  } catch (error) { showToast(error.message); }
}

export async function removeClaim(id) {
  if (!activeResearchStory) return;
  try {
    const updated = await api(
      `/api/stories/${activeResearchStory.id}/claims/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    activeResearchStory = updated;
    cacheStory(updated);
    _renderClaims(updated);
  } catch (error) { showToast(error.message); }
}

export async function generateAngles() {
  if (!activeResearchStory) return;
  const btn = document.querySelector("#generateAnglesBtn");
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Generating…";
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}/angles/generate`, {
      method: "POST", body: JSON.stringify({})
    });
    activeResearchStory = updated;
    cacheStory(updated);
    _renderAngles(updated);
    showToast("Editorial angles ready.");
  } catch (error) { showToast(error.message); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

export async function saveAngle() {
  if (!activeResearchStory) return;
  const approvedAngle = document.querySelector("#approvedAngle").value.trim();
  if (!approvedAngle) return showToast("Choose or write an approved angle.");
  try {
    const updated = await api(`/api/stories/${activeResearchStory.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        angle: approvedAngle,
        research: { ...activeResearchStory.research, approvedAngle }
      })
    });
    activeResearchStory = updated;
    cacheStory(updated);
    renderAll();
    showToast("Editorial angle approved.");
  } catch (error) { showToast(error.message); }
}

// Handles clicks on generated angle cards to copy the text into the approved-angle field.
export function handleAngleClick(e) {
  const item = e.target.closest(".angle-item");
  if (!item || !activeResearchStory) return;
  const index = Number(item.dataset.index);
  document.querySelector("#approvedAngle").value =
    activeResearchStory.research?.angles?.[index]?.description ||
    activeResearchStory.research?.angles?.[index] || "";
  document.querySelectorAll(".angle-item").forEach(el => el.classList.remove("selected"));
  item.classList.add("selected");
}
