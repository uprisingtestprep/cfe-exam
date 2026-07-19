const ACCESS_CODE = "CFE9000";

const DAY_TIME_SECONDS = {
  1: 240 * 60,
  2: 300 * 60,
  3: 80 * 60,
};

const RATING_LABELS = {
  NA: "Not Addressed",
  NC: "Nominal Competence",
  RC: "Reaching Competence",
  C: "Competence",
  CD: "Competence with Distinction",
};

const RATING_ORDER = ["NA", "NC", "RC", "C", "CD"];

let CASES = [];
let currentCase = null;
let timerInterval = null;
let timerRemaining = 0;
let timerTotal = 0;
let timerRunning = false;
let timerEverStarted = false;
let timerDone = false;

function $(id) { return document.getElementById(id); }

function showScreen(id) {
  ["gate-screen", "list-screen", "case-screen"].forEach(s => {
    $(s).style.display = s === id ? "" : "none";
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------- Access gate ----------
function checkAccessCode() {
  const val = $("access-code-input").value.trim().toUpperCase();
  if (val === ACCESS_CODE) {
    localStorage.setItem("cfe_access", "1");
    loadCases();
  } else {
    $("gate-error").textContent = "Incorrect access code. Please check your book or listing for the code.";
  }
}

$("gate-submit").addEventListener("click", checkAccessCode);
$("access-code-input").addEventListener("keydown", e => {
  if (e.key === "Enter") checkAccessCode();
});

// ---------- Load + list ----------
async function loadCases() {
  try {
    const res = await fetch("cases.json");
    CASES = await res.json();
    buildElectiveFilter();
    renderList();
    showScreen("list-screen");
  } catch (e) {
    $("gate-error").textContent = "Could not load cases. Please refresh and try again.";
  }
}

function buildElectiveFilter() {
  const sel = $("filter-elective");
  const electives = [...new Set(CASES.map(c => c.elective).filter(Boolean))].sort();
  electives.forEach(el => {
    const opt = document.createElement("option");
    opt.value = el;
    opt.textContent = el;
    sel.appendChild(opt);
  });
}

function getPracticedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem("cfe_practiced") || "[]"));
  } catch (e) {
    return new Set();
  }
}

function markPracticed(id) {
  const set = getPracticedSet();
  set.add(id);
  localStorage.setItem("cfe_practiced", JSON.stringify([...set]));
}

function renderList() {
  const dayFilter = $("filter-day").value;
  const electiveFilter = $("filter-elective").value;
  const practiced = getPracticedSet();

  const filtered = CASES.filter(c =>
    (!dayFilter || String(c.day) === dayFilter) &&
    (!electiveFilter || c.elective === electiveFilter)
  );

  $("case-count").textContent = `${filtered.length} case${filtered.length === 1 ? "" : "s"}`;

  const container = $("case-list");
  container.innerHTML = "";
  filtered.forEach(c => {
    const card = document.createElement("div");
    card.className = "case-card" + (practiced.has(c.id) ? " done" : "");
    card.innerHTML = `
      <div class="num">Case ${c.id}${practiced.has(c.id) ? ' <span class="done-check">&#10003; Practiced</span>' : ""}</div>
      <div class="title">${escapeHtml(c.title)}</div>
      <div class="tags">
        <span class="tag">Day ${c.day}</span>
        ${c.elective ? `<span class="tag">${escapeHtml(c.elective)}</span>` : ""}
        <span class="tag">${c.time_allotted_min} min</span>
      </div>`;
    card.addEventListener("click", () => openCase(c));
    container.appendChild(card);
  });
}

$("filter-day").addEventListener("change", renderList);
$("filter-elective").addEventListener("change", renderList);
$("back-to-list").addEventListener("click", () => {
  stopTimer();
  renderList();
  showScreen("list-screen");
});

// ---------- Case detail ----------
function openCase(c) {
  currentCase = c;
  $("case-title-header").textContent = `Case ${c.id}: ${c.title}`;
  $("case-day-badge").textContent = `Day ${c.day}`;
  if (c.elective) {
    $("case-elective-badge").textContent = c.elective;
    $("case-elective-badge").style.display = "";
  } else {
    $("case-elective-badge").style.display = "none";
  }
  $("case-time-badge").textContent = `${c.time_allotted_min} min`;

  $("case-competencies").innerHTML = (c.competencies_tested || [])
    .map(k => `<span class="tag">${escapeHtml(formatCompetencyKey(k))}</span>`).join("");
  $("case-enabling").innerHTML = (c.enabling_focus || [])
    .map(k => `<span class="tag tag-alt">${escapeHtml(k)}</span>`).join("");

  $("case-background").textContent = c.case_background;

  const exhibitsContainer = $("case-exhibits");
  exhibitsContainer.innerHTML = "";
  (c.exhibits || []).forEach(ex => {
    const block = document.createElement("div");
    block.className = "exhibit-block";
    block.innerHTML = `<h3>${escapeHtml(ex.title)}</h3><p class="preline">${escapeHtml(ex.content)}</p>`;
    exhibitsContainer.appendChild(block);
  });

  const reqList = $("case-requirements");
  reqList.innerHTML = "";
  (c.requirements || []).forEach(r => {
    const li = document.createElement("li");
    li.textContent = r;
    reqList.appendChild(li);
  });

  $("answer-section").style.display = "none";
  $("reveal-panel").style.display = "";
  $("reveal-btn").disabled = true;
  $("reveal-btn").textContent = "Reveal Model Answer & Marking Guide (locked until time is up)";

  resetTimer();
  showScreen("case-screen");
  window.scrollTo(0, 0);
}

function formatCompetencyKey(k) {
  return k.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
}

// ---------- Reveal ----------
// Hard-locked: the button stays disabled until the full allotted time has
// actually elapsed (timerDone set only by tick() reaching 0). There is no
// bypass, matching the real exam where no feedback is available until time
// is called.
$("reveal-btn").addEventListener("click", () => {
  const c = currentCase;
  if (!c || !timerDone) return;

  const mr = c.model_response || {};
  $("model-understand").textContent = mr.understand_issue || "";
  $("model-analyze").textContent = mr.analyze_case || "";
  $("model-recommend").textContent = mr.recommendation || "";
  $("model-conclude").textContent = mr.conclusion || "";

  renderMarkingGuide(c);

  $("rating-guidance-text").textContent = c.rating_guidance || "";

  $("answer-section").style.display = "";
  $("reveal-panel").style.display = "none";
});

function ratingBadgeClass(rating) {
  const idx = RATING_ORDER.indexOf(rating);
  return "rating-badge rating-" + (idx >= 0 ? rating.toLowerCase() : "na");
}

function getSelfAssessment(caseId) {
  try {
    return JSON.parse(localStorage.getItem(`cfe_selfassess_${caseId}`) || "{}");
  } catch (e) {
    return {};
  }
}

function saveSelfAssessment(caseId, data) {
  localStorage.setItem(`cfe_selfassess_${caseId}`, JSON.stringify(data));
}

function renderMarkingGuide(c) {
  const container = $("marking-guide-container");
  container.innerHTML = "";

  const byCompetency = {};
  (c.marking_guide || []).forEach((item, idx) => {
    const key = item.competency || "Other";
    byCompetency[key] = byCompetency[key] || [];
    byCompetency[key].push({ ...item, idx });
  });

  const saved = getSelfAssessment(c.id);

  Object.keys(byCompetency).forEach(comp => {
    const block = document.createElement("div");
    block.className = "marking-category";
    const h3 = document.createElement("h3");
    h3.textContent = formatCompetencyKey(comp);
    block.appendChild(h3);

    byCompetency[comp].forEach(item => {
      const row = document.createElement("div");
      row.className = "marking-item";

      const savedVal = saved[item.idx] || "";

      const options = RATING_ORDER.map(r =>
        `<option value="${r}" ${savedVal === r ? "selected" : ""}>${r} &mdash; ${RATING_LABELS[r]}</option>`
      ).join("");

      row.innerHTML = `
        <div class="marking-item-top">
          <span class="${ratingBadgeClass(item.target_rating)}">Target: ${item.target_rating}</span>
        </div>
        <div class="marking-item-criterion">${escapeHtml(item.criterion)}</div>
        <label class="self-assess-label">
          Self-assessment:
          <select class="self-assess-select" data-idx="${item.idx}">
            <option value="">Not rated</option>
            ${options}
          </select>
        </label>
      `;
      block.appendChild(row);
    });

    container.appendChild(block);
  });

  container.querySelectorAll(".self-assess-select").forEach(sel => {
    sel.addEventListener("change", () => {
      const data = getSelfAssessment(c.id);
      data[sel.dataset.idx] = sel.value;
      saveSelfAssessment(c.id, data);
    });
  });
}

$("mark-practiced-btn").addEventListener("click", () => {
  if (!currentCase) return;
  markPracticed(currentCase.id);
  $("mark-practiced-btn").textContent = "Practiced ✓";
  $("mark-practiced-btn").disabled = true;
});

// ---------- Timer ----------
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function resetTimer() {
  stopTimer();
  timerTotal = DAY_TIME_SECONDS[currentCase.day] || currentCase.time_allotted_min * 60;
  timerRemaining = timerTotal;
  timerEverStarted = false;
  timerDone = false;
  $("timer-display").textContent = formatTime(timerRemaining);
  $("timer-display").className = "";
  $("timer-label").textContent = "Not Started";
  $("timer-start").textContent = "Start Timer";
  $("timer-start").disabled = false;
  $("timer-pause").disabled = true;
  $("timer-pause").textContent = "Pause";
  $("reveal-btn").disabled = true;
  $("reveal-btn").textContent = "Reveal Model Answer & Marking Guide (locked until time is up)";
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerRunning = false;
}

function tick() {
  timerRemaining--;
  if (timerRemaining <= 0) {
    timerRemaining = 0;
    timerDone = true;
    stopTimer();
    $("timer-display").textContent = "0:00";
    $("timer-display").className = "done";
    $("timer-label").textContent = "Time Complete";
    $("timer-start").disabled = true;
    $("timer-pause").disabled = true;
    $("reveal-btn").disabled = false;
    $("reveal-btn").textContent = "Reveal Model Answer & Marking Guide";
    return;
  }
  $("timer-display").textContent = formatTime(timerRemaining);
  $("timer-label").textContent = "Writing Time Remaining";
  if (timerRemaining <= 5 * 60) {
    $("timer-display").className = "warning";
  }
}

$("timer-start").addEventListener("click", () => {
  if (timerRunning) return;
  timerEverStarted = true;
  timerRunning = true;
  $("timer-start").disabled = true;
  $("timer-pause").disabled = false;
  $("timer-label").textContent = "Writing Time Remaining";
  timerInterval = setInterval(tick, 1000);
});

$("timer-pause").addEventListener("click", () => {
  if (!timerRunning) return;
  stopTimer();
  $("timer-start").disabled = false;
  $("timer-start").textContent = "Resume Timer";
  $("timer-pause").disabled = true;
  $("timer-label").textContent = "Paused";
});

$("timer-reset").addEventListener("click", resetTimer);

// ---------- Print case (no answer) ----------
$("print-case-btn").addEventListener("click", () => {
  const c = currentCase;
  if (!c) return;
  const exhibitsHtml = (c.exhibits || [])
    .map(ex => `<h3>${escapeHtml(ex.title)}</h3><p>${escapeHtml(ex.content)}</p>`)
    .join("");
  const requirementsHtml = (c.requirements || [])
    .map((r, i) => `<div>${i + 1}. ${escapeHtml(r)}</div>`)
    .join("");
  $("print-area").innerHTML = `
    <h1>Case ${c.id}: ${escapeHtml(c.title)}</h1>
    <p><strong>Day:</strong> ${c.day}${c.elective ? ` &mdash; ${escapeHtml(c.elective)}` : ""}</p>
    <p><strong>Time Allotted:</strong> ${c.time_allotted_min} minutes</p>
    <hr>
    <h2>Case Background</h2>
    <p>${escapeHtml(c.case_background)}</p>
    <h2>Exhibits</h2>
    ${exhibitsHtml}
    <h2>Requirements</h2>
    ${requirementsHtml}
  `;
  window.print();
});

// ---------- Init ----------
if (localStorage.getItem("cfe_access") === "1") {
  loadCases();
}
