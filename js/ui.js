// AKOLIS TECH STUDIO — UI renderers
// All DOM rendering lives here. No fetch/API calls in this file.

import { STORAGE_KEYS, getData, saveData, escapeHtml, formatDate } from "./core.js";

// ---------- Stats ----------

export function renderStats() {
  const stories  = getData(STORAGE_KEYS.stories);
  const sources  = getData(STORAGE_KEYS.sources);
  const projects = getData(STORAGE_KEYS.projects);

  document.querySelector("#storyCount").textContent        = stories.length;
  document.querySelector("#sourceCount").textContent       = sources.length;
  document.querySelector("#activeSourceCount").textContent = `${sources.filter(s => s.active).length} active`;
  document.querySelector("#projectCount").textContent      = projects.length;
  document.querySelector("#productionCount").textContent   =
    `${projects.filter(p => p.progress > 0 && p.progress < 100).length} in production`;
  document.querySelector("#highPotentialCount").textContent =
    stories.filter(s => s.score >= 80).length;
  const recent = stories.filter(
    s => Date.now() - new Date(s.importedAt || s.publishedAt || 0).getTime() < 86_400_000
  ).length;
  document.querySelector("#storyFreshness").textContent = `${recent} new in 24h`;
}

// ---------- Stories ----------

export function renderStories() {
  const list   = document.querySelector("#storyList");
  const query  = document.querySelector("#storySearch").value.toLowerCase();
  const topic  = document.querySelector("#topicFilter").value;
  const status = document.querySelector("#storyStatusFilter").value;

  const stories = getData(STORAGE_KEYS.stories)
    .filter(story => {
      const hay = `${story.title} ${story.source} ${story.summary || ""} ${story.angle || ""}`.toLowerCase();
      return hay.includes(query)
        && (topic  === "all" || story.topic  === topic)
        && (status === "all" || story.status === status);
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  list.innerHTML = stories.length
    ? stories.map(story => {
        const hasAngle  = !!(story.research?.approvedAngle || story.angle);
        const sceneCount = story.script?.scenes?.length || 0;
        const readyScenes = sceneCount
          ? story.script.scenes.filter(s =>
              (story.production?.assets || []).some(a => a.role === "footage" && a.sceneId === s.id) &&
              (story.production?.assets || []).some(a => a.role === "voiceover" && a.sceneId === s.id)
            ).length
          : 0;
        return `
        <article class="story-card">
          <div>
            <div class="story-title">${escapeHtml(story.title)}</div>
            <div class="meta">
              ${escapeHtml(story.source)} · ${escapeHtml(formatDate(story.publishedAt))} · ${escapeHtml(story.status)}
            </div>
            <div class="tags">
              <span class="tag">${escapeHtml(story.topic || "Unclassified")}</span>
              <span class="tag">${story.research?.sourceCount || 0} research sources</span>
              <span class="tag">${story.claims?.length || 0} claims</span>
              <span class="tag">${story.script?.status || "No script"}</span>
            </div>
          </div>
          <div class="story-actions">
            <div class="score">${story.score ?? "—"}/100</div>
            <div class="stage-btn">
              <button class="secondary-btn research-story" data-id="${story.id}">Research</button>
              <span class="stage-hint">${hasAngle ? "✓ angle approved" : "not started"}</span>
            </div>
            <div class="stage-btn">
              <button class="primary-btn script-story" data-id="${story.id}">Script</button>
              <span class="stage-hint">${sceneCount ? `${sceneCount} scenes` : (hasAngle ? "ready to generate" : "needs an angle first")}</span>
            </div>
            <div class="stage-btn">
              <button class="secondary-btn production-story" data-id="${story.id}">Production</button>
              <span class="stage-hint">${sceneCount ? `${readyScenes}/${sceneCount} scenes ready` : "needs a script first"}</span>
            </div>
          </div>
        </article>`;
      }).join("")
    : `<div class="empty">No stories match your filters. Try refreshing feeds.</div>`;
}

// ---------- Sources ----------

export function renderSources() {
  const list    = document.querySelector("#sourceList");
  const sources = getData(STORAGE_KEYS.sources);

  list.innerHTML = sources.length
    ? sources.map(source => `
        <article class="source-card">
          <div>
            <div class="story-title">${escapeHtml(source.name)}</div>
            <div class="meta">${escapeHtml(source.url)}</div>
            <div class="tags">
              <span class="tag">${escapeHtml((source.type || "rss").toUpperCase())}</span>
              <span class="tag">${escapeHtml(source.topic || "Developer")}</span>
            </div>
          </div>
          <div class="story-actions">
            <span class="source-status" style="${source.active ? "" : "color:var(--muted)"}">
              ${source.active ? "Active" : "Paused"}
            </span>
            <button class="secondary-btn toggle-source"
              data-id="${source.id}" data-active="${source.active}">
              ${source.active ? "Pause" : "Activate"}
            </button>
            <button class="danger-btn delete-source" data-id="${source.id}">Delete</button>
          </div>
        </article>`).join("")
    : `<div class="empty">No sources configured.</div>`;
}

// ---------- Projects ----------

export function renderProjects() {
  const list     = document.querySelector("#projectList");
  const projects = getData(STORAGE_KEYS.projects);

  list.innerHTML = projects.length
    ? projects.map(project => `
        <article class="project-card">
          <div>
            <div class="story-title">${escapeHtml(project.title)}</div>
            <div class="meta">${escapeHtml(project.length)} · ${escapeHtml(project.status)}</div>
            <p class="meta" style="margin-top:10px">${escapeHtml(project.angle)}</p>
            <div class="progress" style="--progress:${project.progress}%"><span></span></div>
          </div>
          <div class="score">${project.progress}%</div>
        </article>`).join("")
    : `<div class="empty">No projects yet.</div>`;
}

// ---------- Coordinator ----------

export function renderAll() {
  renderStats();
  renderStories();
  renderSources();
  renderProjects();
}

// Updates the local story cache and re-renders the whole dashboard.
// Called after any successful story PATCH from any studio.
export function cacheStory(story) {
  const stories = getData(STORAGE_KEYS.stories);
  const index   = stories.findIndex(s => s.id === story.id);
  if (index >= 0) stories[index] = story;
  else stories.unshift(story);
  saveData(STORAGE_KEYS.stories, stories);
  renderAll();
}
