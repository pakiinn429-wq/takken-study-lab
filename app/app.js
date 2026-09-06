const STORAGE_KEY = "takken-study-lab-public-progress-v1";
const LEGACY_STORAGE_KEY = "takken-study-lab-public-progress-v0";

const app = {
  data: null,
  state: null,
  view: "dashboard",
  toastTimer: null,
};

const DEFAULT_STATS = {
  attempts: 0,
  correct: 0,
  wrong: 0,
  lastAnswer: null,
  lastCorrect: null,
  lastAnsweredAt: null,
  marked: false,
  uncertain: false,
};

function defaultSession() {
  return {
    queueIds: [],
    index: 0,
    mode: "all",
    answered: {},
    startedAt: null,
    completed: false,
  };
}

function defaultPreference() {
  return {
    selectedModule: "すべての分野",
    selectedDifficulty: "すべての難易度",
  };
}

function defaultState() {
  return {
    version: 2,
    activeSubjectId: "minpo",
    questionStats: {},
    sessions: {},
    preferences: {},
  };
}

function normalizeSubjectData(payload) {
  if (Array.isArray(payload.subjects)) {
    return {
      ...payload,
      subjects: payload.subjects.map((subject) => ({
        status: subject.status || (subject.questions?.length ? "ready" : "coming-soon"),
        questionCount: subject.questions?.length || 0,
        questions: subject.questions || [],
        ...subject,
      })),
    };
  }

  // Keep the app tolerant of the original one-subject questions.json format.
  if (Array.isArray(payload.questions)) {
    return {
      datasetVersion: payload.datasetVersion || "legacy",
      title: "宅建士クイック○×トレーニング",
      subjects: [{
        id: "minpo",
        name: "民法",
        scope: payload.scope || "権利関係｜民法本体",
        description: "民法のクイック判定問題集。",
        status: "ready",
        questionCount: payload.questions.length,
        questions: payload.questions,
      }],
    };
  }

  throw new Error("問題データの形式が正しくありません。subjects または questions が見つかりません。");
}

function migrateState(saved) {
  const fresh = defaultState();
  if (!saved || typeof saved !== "object") return fresh;

  if (saved.version === 1) {
    return {
      ...fresh,
      activeSubjectId: "minpo",
      questionStats: saved.questionStats || {},
      sessions: { minpo: { ...defaultSession(), ...(saved.session || {}) } },
      preferences: { minpo: { ...defaultPreference(), ...(saved.preferences || {}) } },
    };
  }

  if (saved.version !== 2) return fresh;
  const sessions = {};
  for (const [subjectId, session] of Object.entries(saved.sessions || {})) {
    sessions[subjectId] = { ...defaultSession(), ...(session || {}) };
  }
  const preferences = {};
  for (const [subjectId, preference] of Object.entries(saved.preferences || {})) {
    preferences[subjectId] = { ...defaultPreference(), ...(preference || {}) };
  }
  return {
    ...fresh,
    ...saved,
    questionStats: saved.questionStats || {},
    sessions,
    preferences,
  };
}

function loadState() {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved) return migrateState(saved);
    } catch (error) {
      console.warn(`ローカルの学習履歴（${key}）を読み込めませんでした。別の履歴を確認します。`, error);
    }
  }
  return defaultState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state));
  const status = document.querySelector("#save-status");
  if (status) {
    status.textContent = `自動保存 ${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function textWithBreaks(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function subjectById(subjectId) {
  return app.data.subjects.find((subject) => subject.id === subjectId) || null;
}

function currentSubject() {
  return subjectById(app.state.activeSubjectId) || app.data.subjects[0];
}

function currentQuestions() {
  return currentSubject()?.questions || [];
}

function allQuestions() {
  return app.data.subjects.flatMap((subject) => subject.questions || []);
}

function questionById(id) {
  return allQuestions().find((question) => question.id === id);
}

function sessionFor(subjectId = app.state.activeSubjectId) {
  if (!app.state.sessions[subjectId]) app.state.sessions[subjectId] = defaultSession();
  app.state.sessions[subjectId] = { ...defaultSession(), ...app.state.sessions[subjectId] };
  return app.state.sessions[subjectId];
}

function preferenceFor(subjectId = app.state.activeSubjectId) {
  if (!app.state.preferences[subjectId]) app.state.preferences[subjectId] = defaultPreference();
  app.state.preferences[subjectId] = { ...defaultPreference(), ...app.state.preferences[subjectId] };
  return app.state.preferences[subjectId];
}

function statsFor(questionId) {
  return { ...DEFAULT_STATS, ...(app.state.questionStats[questionId] || {}) };
}

function ensureQuestionStats() {
  for (const question of allQuestions()) {
    if (!app.state.questionStats[question.id]) app.state.questionStats[question.id] = { ...DEFAULT_STATS };
  }
  sessionFor();
  preferenceFor();
}

function isMastered(questionId) {
  const stats = statsFor(questionId);
  return stats.attempts >= 2 && stats.lastCorrect === true && stats.correct / stats.attempts >= 0.8;
}

function attemptedQuestions(questions = currentQuestions()) {
  return questions.filter((question) => statsFor(question.id).attempts > 0);
}

function accuracyFor(questions = currentQuestions()) {
  const attempts = questions.reduce((sum, question) => sum + statsFor(question.id).attempts, 0);
  const correct = questions.reduce((sum, question) => sum + statsFor(question.id).correct, 0);
  return attempts ? Math.round((correct / attempts) * 100) : 0;
}

function coverageFor(questions = currentQuestions()) {
  return questions.length
    ? Math.round((attemptedQuestions(questions).length / questions.length) * 100)
    : 0;
}

function getModules(questions = currentQuestions()) {
  return [...new Set(questions.map((question) => question.module).filter(Boolean))];
}

function getDifficulties(questions = currentQuestions()) {
  return [...new Set(questions.map((question) => question.difficulty).filter(Boolean))];
}

function getModuleQuestions(module) {
  return currentQuestions().filter((question) => question.module === module);
}

function getAxisCounts() {
  const map = new Map();
  for (const question of currentQuestions()) {
    const axis = question.trapAxis || "ひっかけ軸なし";
    if (!map.has(axis)) map.set(axis, { axis, total: 0, attempted: 0, wrong: 0 });
    const item = map.get(axis);
    const stats = statsFor(question.id);
    item.total += 1;
    if (stats.attempts > 0) item.attempted += 1;
    if (stats.lastCorrect === false) item.wrong += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.axis.localeCompare(b.axis));
}

function renderSubjectSwitcher() {
  const select = document.querySelector("#subject-switcher");
  if (!select || !app.data) return;
  select.innerHTML = app.data.subjects.map((subject) => {
    const count = subject.questions.length;
    const suffix = count ? `（${count}問）` : "（準備中）";
    return `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}${suffix}</option>`;
  }).join("");
  select.value = currentSubject().id;
  const label = document.querySelector("#active-subject-label");
  if (label) label.textContent = currentSubject().name;
}

function switchSubject(subjectId) {
  const subject = subjectById(subjectId);
  if (!subject) return;
  app.state.activeSubjectId = subject.id;
  ensureQuestionStats();
  saveState();
  renderSubjectSwitcher();
  setView("dashboard");
  showToast(`${subject.name}に切り替えました`);
}

function subjectCards() {
  return app.data.subjects.map((subject) => {
    const questions = subject.questions || [];
    const ready = questions.length > 0;
    const attempted = ready ? attemptedQuestions(questions).length : 0;
    const coverage = ready ? coverageFor(questions) : 0;
    const active = subject.id === currentSubject().id;
    return `<button class="subject-card ${active ? "active" : ""} ${ready ? "" : "disabled"}" data-action="switch-subject" data-subject-id="${escapeHtml(subject.id)}" ${ready ? "" : "disabled"}><div class="subject-card-top"><span class="subject-card-icon">${ready ? "✓" : "···"}</span><span class="tag ${ready ? "green" : "gray"}">${ready ? "演習可能" : "準備中"}</span></div><strong>${escapeHtml(subject.name)}</strong><span>${escapeHtml(subject.scope || "")}</span><small>${ready ? `${questions.length}問 · 演習済み ${attempted}問 · カバー率 ${coverage}%` : escapeHtml(subject.description || "問題データを準備中です")}</small></button>`;
  }).join("");
}

function setView(view) {
  app.view = view;
  document.querySelectorAll(".view").forEach((element) => element.classList.remove("active-view"));
  document.querySelector(`#view-${view}`)?.classList.add("active-view");
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const titles = { dashboard: "学習状況", practice: "問題演習", wrong: "復習", stats: "分類統計", settings: "データ設定" };
  document.querySelector("#page-title").textContent = titles[view] || "クイック判定";
  document.querySelector("#top-continue").classList.toggle("hidden", view === "practice");
  renderSubjectSwitcher();
  if (view === "dashboard") renderDashboard();
  if (view === "practice") renderPractice();
  if (view === "wrong") renderWrong();
  if (view === "stats") renderStats();
  if (view === "settings") renderSettings();
  document.querySelector(".sidebar")?.classList.remove("open");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function showNotice(message) {
  const notice = document.querySelector("#notice");
  notice.textContent = message;
  notice.classList.remove("hidden");
  clearTimeout(app.noticeTimer);
  app.noticeTimer = setTimeout(() => notice.classList.add("hidden"), 5000);
}

function statCard(label, number, note, className = "") {
  return `<div class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-number ${className}">${escapeHtml(number)}</div><div class="stat-note">${escapeHtml(note)}</div></div>`;
}

function renderDashboard() {
  const subject = currentSubject();
  const questions = currentQuestions();
  const total = questions.length;
  const attempted = attemptedQuestions(questions).length;
  const wrong = questions.filter((question) => statsFor(question.id).lastCorrect === false).length;
  const mastered = questions.filter((question) => isMastered(question.id)).length;
  const session = sessionFor();
  const hasSession = session.queueIds.length > 0 && !session.completed;
  const currentAnswered = hasSession ? currentSessionAnswer(session.queueIds[session.index]) : null;
  const sessionLeft = hasSession ? Math.max(session.queueIds.length - session.index - (currentAnswered ? 1 : 0), 0) : 0;

  if (!total) {
    document.querySelector("#view-dashboard").innerHTML = `<div class="section-head" style="margin-top:0"><div><h2>科目を選ぶ</h2><p>この科目にはまだ問題がありません。問題データのある科目へ切り替えてください。</p></div></div><div class="subject-grid">${subjectCards()}</div><div class="empty-state" style="margin-top:18px"><strong>${escapeHtml(subject.name)}の問題データは準備中です</strong><p>${escapeHtml(subject.description || "問題データが追加されると、ここに演習・進捗・復習の入口が表示されます。")}</p></div>`;
    return;
  }

  const modules = getModules(questions);
  const moduleRows = modules.map((module) => {
    const moduleQuestions = getModuleQuestions(module);
    const done = attemptedQuestions(moduleQuestions).length;
    const coverage = moduleQuestions.length ? Math.round((done / moduleQuestions.length) * 100) : 0;
    return `<tr><td><div class="module-name">${escapeHtml(module)}</div><div class="module-detail">${moduleQuestions.length}問</div></td><td>${done} / ${moduleQuestions.length}</td><td>${accuracyFor(moduleQuestions)}%</td><td><div class="mini-bar"><span style="width:${coverage}%"></span></div></td></tr>`;
  }).join("");

  document.querySelector("#view-dashboard").innerHTML = `
    <div class="subject-strip"><div><span class="eyebrow">現在の科目</span><h2>${escapeHtml(subject.name)}</h2><p>${escapeHtml(subject.scope || "")} · ${total}問</p></div><div class="subject-strip-actions"><label for="dashboard-subject-switcher">科目を切り替える</label><select class="select" id="dashboard-subject-switcher">${app.data.subjects.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === subject.id ? "selected" : ""} ${item.questions.length ? "" : "disabled"}>${escapeHtml(item.name)}${item.questions.length ? `（${item.questions.length}問）` : "（準備中）"}</option>`).join("")}</select></div></div>
    <div class="hero">
      <div><h2>${hasSession ? "演習を続ける" : "クイック判定を始める"}</h2><p>${hasSession ? `現在の${escapeHtml(subject.name)}の演習はあと${sessionLeft}問です。回答位置と科目別の進捗は自動保存されます。` : `${escapeHtml(subject.name)}で判断の速さを鍛え、回答後に解説・ひっかけ軸・根拠を確認できます。`}</p></div>
      <button class="button" data-action="${hasSession ? "continue-session" : "start-all"}">${hasSession ? "続きから再開" : "全問題を始める"}</button>
    </div>

    <div class="grid grid-4" style="margin-top:16px">
      ${statCard("現在の問題数", total, subject.name)}
      ${statCard("演習済み", attempted, `カバー率 ${coverageFor(questions)}%`, "stat-accent")}
      ${statCard("現在の正解率", `${accuracyFor(questions)}%`, "すべての回答回数で計算", "stat-warm")}
      ${statCard("復習待ち", wrong, `習得済み ${mastered}問`, "stat-danger")}
    </div>

    <div class="section-head"><div><h2>科目を切り替える</h2><p>科目ごとに問題、演習位置、統計を分けて保存します。</p></div></div>
    <div class="subject-grid">${subjectCards()}</div>

    <div class="section-head"><div><h2>分野別の進捗</h2><p>${escapeHtml(subject.name)}のどの分野を演習したか、まだ手を付けていない分野はどこかを確認できます。</p></div><button class="button button-outline small" data-action="open-stats">詳細統計を見る</button></div>
    <div class="grid grid-2">
      <div class="panel panel-pad"><table class="module-table"><thead><tr><th>分野</th><th>演習済み</th><th>正解率</th><th>カバー</th></tr></thead><tbody>${moduleRows}</tbody></table></div>
      <div class="panel panel-pad"><h3>クイックメニュー</h3><div class="quick-actions">
        <div class="action-card"><div><strong>未演習だけ</strong><span>${total - attempted}問が未演習</span></div><button class="button button-outline small" data-action="start-new" ${total - attempted ? "" : "disabled"}>開始</button></div>
        <div class="action-card"><div><strong>間違えた問題</strong><span>${wrong ? `直近の誤答 ${wrong}問` : "まだ誤答はありません"}</span></div><button class="button button-outline small" data-action="start-wrong" ${wrong ? "" : "disabled"}>開始</button></div>
        <div class="action-card"><div><strong>重点問題</strong><span>${questions.filter((question) => statsFor(question.id).marked).length}問をマーク中</span></div><button class="button button-outline small" data-action="start-marked">開始</button></div>
      </div></div>
    </div>

    <div class="section-head"><div><h2>習得状況</h2><p>習得の目安：2回以上回答し、直近の回答が正解、累計正解率が80%以上。</p></div></div>
    <div class="panel panel-pad"><div class="progress-row"><span>科目のカバー率</span><strong>${coverageFor(questions)}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${coverageFor(questions)}%"></div></div><div class="progress-row"><span>習得済みの問題</span><strong>${mastered} / ${total}</strong></div><div class="progress-track"><div class="progress-fill orange" style="width:${total ? Math.round((mastered / total) * 100) : 0}%"></div></div></div>
  `;
}

function buildQueue(mode = "all") {
  const preference = preferenceFor();
  let questions = [...currentQuestions()];
  if (mode === "new") questions = questions.filter((question) => statsFor(question.id).attempts === 0);
  if (mode === "wrong") questions = questions.filter((question) => statsFor(question.id).lastCorrect === false);
  if (mode === "marked") questions = questions.filter((question) => statsFor(question.id).marked);
  if (mode === "uncertain") questions = questions.filter((question) => statsFor(question.id).uncertain);
  if (preference.selectedModule && preference.selectedModule !== "すべての分野") {
    questions = questions.filter((question) => question.module === preference.selectedModule);
  }
  if (preference.selectedDifficulty && preference.selectedDifficulty !== "すべての難易度") {
    questions = questions.filter((question) => question.difficulty === preference.selectedDifficulty);
  }
  if (mode === "random") questions.sort(() => Math.random() - 0.5);
  return questions.map((question) => question.id);
}

function startPractice(mode = "all") {
  const queueIds = buildQueue(mode);
  if (!queueIds.length) {
    showNotice("現在の絞り込み条件に該当する問題がありません。モードを変えるか、別の条件を試してください。");
    return;
  }
  app.state.sessions[app.state.activeSubjectId] = {
    queueIds,
    index: 0,
    mode,
    answered: {},
    startedAt: new Date().toISOString(),
    completed: false,
  };
  saveState();
  setView("practice");
}

function startSingleQuestion(questionId) {
  if (!questionById(questionId)) return;
  app.state.sessions[app.state.activeSubjectId] = {
    queueIds: [questionId],
    index: 0,
    mode: "single",
    answered: {},
    startedAt: new Date().toISOString(),
    completed: false,
  };
  saveState();
  setView("practice");
}

function currentQuestion() {
  const session = sessionFor();
  return questionById(session.queueIds[session.index]);
}

function currentSessionAnswer(questionId) {
  return sessionFor().answered?.[questionId] || null;
}

function renderPractice() {
  const subject = currentSubject();
  const questions = currentQuestions();
  const session = sessionFor();
  if (!questions.length) {
    document.querySelector("#view-practice").innerHTML = `<div class="empty-state"><strong>${escapeHtml(subject.name)}にはまだ問題がありません</strong><p>右上の科目選択から、問題データのある科目へ切り替えてください。</p></div>`;
    return;
  }
  if (!session.queueIds.length || session.completed) {
    document.querySelector("#view-practice").innerHTML = renderPracticeStart();
    return;
  }
  const question = currentQuestion();
  if (!question) {
    session.completed = true;
    saveState();
    renderPractice();
    return;
  }
  const answered = currentSessionAnswer(question.id);
  const stats = statsFor(question.id);
  const progress = Math.round(((session.index + (answered ? 1 : 0)) / session.queueIds.length) * 100);
  const selected = answered?.answer || null;
  const feedback = answered ? renderFeedback(question, answered) : "";
  const answerButton = (answer, label) => {
    let className = "answer-button";
    if (answered) {
      if (answer === question.answer) className += " selected-correct";
      if (answer === selected && answer !== question.answer) className += " selected-wrong";
      if (answer !== question.answer && answer !== selected) className += " not-selected";
    }
    return `<button class="${className}" data-answer="${answer}" ${answered ? "disabled" : ""}>${label}</button>`;
  };

  document.querySelector("#view-practice").innerHTML = `
    <div class="practice-shell">
      <div class="practice-toolbar"><div class="practice-toolbar-left"><button class="button button-outline small" data-action="open-dashboard">学習状況に戻る</button><span class="question-meta">${escapeHtml(subject.name)} · ${session.index + 1} / ${session.queueIds.length} 問</span></div><div class="practice-toolbar-right"><span class="question-meta">${progress}%</span><button class="button button-outline small" data-action="toggle-mark" data-question-id="${question.id}">${stats.marked ? "★ 重点から外す" : "☆ 重点にする"}</button></div></div>
      <div class="progress-track" style="margin-bottom:15px"><div class="progress-fill" style="width:${progress}%"></div></div>
      <article class="question-card">
        <div class="question-top"><div class="question-tags"><span class="tag">${escapeHtml(question.module || subject.name)}</span><span class="tag ${question.difficulty === "Level 3" ? "orange" : question.difficulty === "Level 1" ? "gray" : ""}">${escapeHtml(question.difficulty || "難易度未設定")}</span><span class="tag gray">第${question.number}問</span></div><span class="question-meta">${stats.attempts ? `過去の回答 ${stats.attempts}回` : "初回演習"}</span></div>
        <div class="question-stem">${textWithBreaks(question.stem)}</div>
        <div class="answer-label">正誤を選んでください（ショートカット：1 = ○、2 = ×）</div>
        <div class="answer-buttons">${answerButton("○", "○ 正しい")} ${answerButton("×", "× 誤っている")}</div>
        ${feedback}
        <div class="question-actions"><div class="question-actions-left"><button class="button button-outline small" data-action="toggle-uncertain" data-question-id="${question.id}">${stats.uncertain ? "不確実マークを外す" : "不確実としてマーク"}</button></div><div class="question-actions-right">${answered ? `<button class="button button-primary" data-action="next-question">${session.index + 1 >= session.queueIds.length ? "このラウンドを完了" : "次の問題 →"}</button>` : `<button class="button button-outline" data-action="skip-question">スキップ</button>`}</div></div>
      </article>
    </div>
  `;
}

function renderPracticeStart() {
  const questions = currentQuestions();
  const subject = currentSubject();
  const preference = preferenceFor();
  const newCount = questions.filter((question) => statsFor(question.id).attempts === 0).length;
  const wrongCount = questions.filter((question) => statsFor(question.id).lastCorrect === false).length;
  const modules = getModules(questions);
  const difficulties = getDifficulties(questions);
  return `<div class="practice-shell"><div class="panel panel-pad"><div class="practice-start-heading"><div><span class="eyebrow">${escapeHtml(subject.name)}</span><h2>演習モードを選ぶ</h2></div><span class="tag green">${questions.length}問</span></div><p class="muted" style="line-height:1.7;font-size:13px">問題文を読み、○または×を選びます。回答後すぐに正解、解説、ひっかけ軸、根拠を確認できます。絞り込みは${escapeHtml(subject.name)}だけに適用されます。</p><div class="filter-bar"><select class="select" id="module-filter"><option>すべての分野</option>${modules.map((module) => `<option ${preference.selectedModule === module ? "selected" : ""}>${escapeHtml(module)}</option>`).join("")}</select><select class="select" id="difficulty-filter"><option>すべての難易度</option>${difficulties.map((difficulty) => `<option ${preference.selectedDifficulty === difficulty ? "selected" : ""}>${escapeHtml(difficulty)}</option>`).join("")}</select></div><div class="grid grid-2" style="margin-top:18px"><div class="action-card"><div><strong>すべての問題</strong><span>${questions.length}問</span></div><button class="button button-primary small" data-action="start-all">開始</button></div><div class="action-card"><div><strong>未演習</strong><span>${newCount}問</span></div><button class="button button-outline small" data-action="start-new" ${newCount ? "" : "disabled"}>開始</button></div><div class="action-card"><div><strong>間違えた問題</strong><span>${wrongCount}問</span></div><button class="button button-outline small" data-action="start-wrong" ${wrongCount ? "" : "disabled"}>開始</button></div><div class="action-card"><div><strong>ランダム</strong><span>現在の絞り込みをシャッフル</span></div><button class="button button-outline small" data-action="start-random">開始</button></div></div></div></div>`;
}

function renderFeedback(question, answered) {
  const correct = answered.isCorrect;
  return `<div class="feedback ${correct ? "correct" : "wrong"}"><div class="feedback-title">${correct ? "✓ 正解" : "× 不正解"}<span class="tag ${correct ? "green" : "red"}">正解：${question.answer}</span></div><div class="feedback-summary">${textWithBreaks(question.summary || "一言解説は未設定です")}</div><div class="feedback-explanation">${textWithBreaks(question.explanation || "詳しい解説は未設定です")}</div><div class="feedback-grid"><div class="feedback-item"><div class="feedback-item-label">判断を分ける事実</div><div class="feedback-item-value">${textWithBreaks(question.decisiveFact || "未設定")}</div></div><div class="feedback-item"><div class="feedback-item-label">ひっかけの軸</div><div class="feedback-item-value">${textWithBreaks(question.trapAxis || "未設定")}</div></div><div class="feedback-item"><div class="feedback-item-label">事実を一つ変えると</div><div class="feedback-item-value">${textWithBreaks(question.flipCondition || "未設定")}</div></div><div class="feedback-item"><div class="feedback-item-label">根拠</div><div class="feedback-item-value">${textWithBreaks(question.law || "未設定")}<br><span class="muted">${textWithBreaks(question.source || "未設定")}</span></div></div></div></div>`;
}

function answerQuestion(answer) {
  const question = currentQuestion();
  if (!question || currentSessionAnswer(question.id)) return;
  const isCorrect = answer === question.answer;
  const previous = statsFor(question.id);
  app.state.questionStats[question.id] = {
    ...previous,
    attempts: previous.attempts + 1,
    correct: previous.correct + (isCorrect ? 1 : 0),
    wrong: previous.wrong + (isCorrect ? 0 : 1),
    lastAnswer: answer,
    lastCorrect: isCorrect,
    lastAnsweredAt: new Date().toISOString(),
  };
  sessionFor().answered[question.id] = { answer, isCorrect };
  saveState();
  renderPractice();
}

function nextQuestion() {
  const session = sessionFor();
  if (session.index + 1 >= session.queueIds.length) {
    session.completed = true;
    saveState();
    renderPractice();
    showToast("このラウンドを完了しました。学習履歴を保存しました。");
    return;
  }
  session.index += 1;
  saveState();
  renderPractice();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function skipQuestion() {
  const session = sessionFor();
  if (session.index + 1 >= session.queueIds.length) session.completed = true;
  else session.index += 1;
  saveState();
  renderPractice();
}

function toggleQuestionFlag(questionId, flag) {
  const stats = statsFor(questionId);
  app.state.questionStats[questionId] = { ...stats, [flag]: !stats[flag] };
  saveState();
  if (app.view === "practice") renderPractice();
  if (app.view === "wrong") renderWrong();
  showToast(flag === "marked" ? (app.state.questionStats[questionId].marked ? "重点問題に追加しました" : "重点マークを外しました") : (app.state.questionStats[questionId].uncertain ? "不確実としてマークしました" : "不確実マークを外しました"));
}

function renderWrong() {
  const wrongQuestions = currentQuestions().filter((question) => statsFor(question.id).lastCorrect === false).sort((a, b) => new Date(statsFor(b.id).lastAnsweredAt) - new Date(statsFor(a.id).lastAnsweredAt));
  const subject = currentSubject();
  const cards = wrongQuestions.map((question) => {
    const stats = statsFor(question.id);
    return `<article class="review-card"><div class="review-card-head"><div><div class="review-card-title">第${question.number}問 · ${escapeHtml(question.module || subject.name)}</div><div class="review-card-meta"><span class="tag red">直近の誤答</span><span class="tag gray">${stats.wrong}回の誤答</span><span class="tag">${escapeHtml(question.trapAxis || "ひっかけ軸なし")}</span></div></div><button class="button button-outline small" data-action="review-one" data-question-id="${question.id}">この問題を演習</button></div><div class="review-card-stem">${textWithBreaks(question.stem)}</div><details><summary class="small-text">解説を開く</summary><div class="feedback-explanation" style="margin-top:11px">${textWithBreaks(question.summary)}<br><br>${textWithBreaks(question.explanation)}</div><div class="small-text muted">根拠：${textWithBreaks(question.law)}；${textWithBreaks(question.source)}</div></details></article>`;
  }).join("");
  document.querySelector("#view-wrong").innerHTML = `<div class="section-head" style="margin-top:0"><div><h2>${escapeHtml(subject.name)} · 復習</h2><p>現在の科目で直近に間違えた問題を表示します。科目を切り替えると、その科目の復習に変わります。</p></div><button class="button button-primary small" data-action="start-wrong" ${wrongQuestions.length ? "" : "disabled"}>まとめて解き直す</button></div>${wrongQuestions.length ? `<div class="list">${cards}</div>` : `<div class="empty-state"><strong>復習待ちの問題はありません</strong>${escapeHtml(subject.name)}の演習を始めると、間違えた問題がここに表示されます。</div>`}`;
}

function renderStats() {
  const subject = currentSubject();
  const questions = currentQuestions();
  const modules = getModules(questions);
  const moduleCards = modules.map((module) => {
    const moduleQuestions = getModuleQuestions(module);
    const attempted = attemptedQuestions(moduleQuestions).length;
    const mastered = moduleQuestions.filter((question) => isMastered(question.id)).length;
    const coverage = moduleQuestions.length ? Math.round((attempted / moduleQuestions.length) * 100) : 0;
    return `<div class="panel panel-pad"><div class="section-head" style="margin:0 0 15px"><div><h3>${escapeHtml(module)}</h3><p>${moduleQuestions.length}問</p></div><span class="tag">${accuracyFor(moduleQuestions)}%</span></div><div class="progress-row"><span>カバー率</span><strong>${coverage}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${coverage}%"></div></div><div class="progress-row"><span>演習済み ${attempted}問</span><span class="muted">習得 ${mastered}問</span></div></div>`;
  }).join("");
  const axes = getAxisCounts().map((item) => `<div class="axis-card"><h3>${escapeHtml(item.axis)}</h3><div class="axis-stat"><span>問題数</span><strong>${item.total}</strong></div><div class="axis-stat"><span>演習済み</span><strong>${item.attempted}</strong></div><div class="axis-stat"><span>直近の誤答</span><strong class="${item.wrong ? "stat-danger" : ""}">${item.wrong}</strong></div></div>`).join("");
  document.querySelector("#view-stats").innerHTML = `<div class="subject-strip"><div><span class="eyebrow">統計</span><h2>${escapeHtml(subject.name)} · 分類統計</h2><p>${escapeHtml(subject.scope || "")} · 全${questions.length}問</p></div><div class="subject-strip-summary">カバー率 ${coverageFor(questions)}% · 正解率 ${accuracyFor(questions)}%</div></div><div class="grid grid-3">${moduleCards || `<div class="empty-state">分野別統計はありません</div>`}</div><div class="section-head"><div><h2>ひっかけ軸の分布</h2><p>現在の科目に登録されたひっかけ軸ごとに、演習状況と直近の誤答を表示します。</p></div></div><div class="grid grid-3">${axes || `<div class="empty-state">ひっかけ軸の統計はありません</div>`}</div>`;
}

function renderSettings() {
  const current = currentSubject();
  const totalAttempts = allQuestions().reduce((sum, question) => sum + statsFor(question.id).attempts, 0);
  const currentAttempts = currentQuestions().reduce((sum, question) => sum + statsFor(question.id).attempts, 0);
  document.querySelector("#view-settings").innerHTML = `<div class="grid grid-2"><div class="panel panel-pad"><h2>データ管理</h2><div class="settings-row"><div><strong>学習履歴をエクスポート</strong><p>全科目の回答回数、正解率、誤答、重点マーク、現在の演習位置を保存します。</p></div><button class="button button-primary small" data-action="export-progress">JSONを書き出す</button></div><div class="settings-row"><div><strong>学習履歴をインポート</strong><p>別のパソコンや、ブラウザのデータを消去した後に履歴を復元します。</p></div><button class="button button-outline small" data-action="import-progress">ファイルを選ぶ</button></div><div class="settings-row"><div><strong>現在の記録</strong><p>現在の科目（${escapeHtml(current.name)}）${currentAttempts}回回答；全科目合計${totalAttempts}回。</p></div><span class="tag green">自動保存</span></div></div><div class="panel panel-pad"><h2>ローカル保存について</h2><div class="warning-box">ページを更新、ブラウザを閉じる、ローカルページを再び開く操作では、通常は履歴は消えません。ブラウザのサイトデータを消去した場合、シークレットウィンドウを使った場合、別のブラウザを使った場合は、JSONバックアップから復元してください。</div><div class="settings-row" style="margin-top:18px"><div><strong>学習履歴をすべて消去</strong><p>全科目の回答履歴、復習状態、重点マークを消去します。問題ファイルは削除しません。</p></div><button class="button button-danger small" data-action="reset-progress">履歴を消去</button></div></div></div>`;
}

function exportProgress() {
  const payload = { app: "Takken Study Lab", exportedAt: new Date().toISOString(), datasetVersion: app.data.datasetVersion, state: app.state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `takken-study-lab_progress_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("全科目の学習履歴を書き出しました");
}

function importProgress(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      const incoming = payload.state || payload;
      if (!incoming || !incoming.questionStats || ![1, 2].includes(incoming.version)) throw new Error("ファイル形式が正しくありません");
      const migrated = migrateState(incoming);
      const knownIds = new Set(allQuestions().map((question) => question.id));
      const mergedStats = { ...app.state.questionStats };
      for (const [questionId, stats] of Object.entries(migrated.questionStats)) {
        if (knownIds.has(questionId)) mergedStats[questionId] = stats;
      }
      const mergedSessions = { ...app.state.sessions };
      for (const [subjectId, session] of Object.entries(migrated.sessions || {})) {
        if (subjectById(subjectId)) mergedSessions[subjectId] = { ...defaultSession(), ...session };
      }
      const mergedPreferences = { ...app.state.preferences };
      for (const [subjectId, preference] of Object.entries(migrated.preferences || {})) {
        if (subjectById(subjectId)) mergedPreferences[subjectId] = { ...defaultPreference(), ...preference };
      }
      app.state = {
        ...app.state,
        activeSubjectId: subjectById(migrated.activeSubjectId)?.id || app.state.activeSubjectId,
        questionStats: mergedStats,
        sessions: mergedSessions,
        preferences: mergedPreferences,
      };
      ensureQuestionStats();
      saveState();
      setView("dashboard");
      showToast("学習履歴を復元しました");
    } catch (error) {
      showNotice(`インポートに失敗しました：${error.message}`);
    }
  };
  reader.readAsText(file);
}

function resetProgress() {
  if (!confirm("全科目の学習履歴を消去しますか？問題データは削除されませんが、回答履歴、復習状態、重点マークは消去されます。")) return;
  app.state = defaultState();
  ensureQuestionStats();
  saveState();
  setView("dashboard");
  showToast("全科目の学習履歴を消去しました");
}

function handleAction(action, element) {
  const questionId = element?.dataset.questionId;
  const subjectId = element?.dataset.subjectId;
  if (action === "switch-subject" && subjectId) switchSubject(subjectId);
  if (action === "start-all") startPractice("all");
  if (action === "start-new") startPractice("new");
  if (action === "start-wrong") startPractice("wrong");
  if (action === "start-marked") startPractice("marked");
  if (action === "start-random") startPractice("random");
  if (action === "continue-session") setView("practice");
  if (action === "open-dashboard") setView("dashboard");
  if (action === "open-stats") setView("stats");
  if (action === "next-question") nextQuestion();
  if (action === "skip-question") skipQuestion();
  if (action === "toggle-mark" && questionId) toggleQuestionFlag(questionId, "marked");
  if (action === "toggle-uncertain" && questionId) toggleQuestionFlag(questionId, "uncertain");
  if (action === "review-one" && questionId) startSingleQuestion(questionId);
  if (action === "export-progress") exportProgress();
  if (action === "import-progress") document.querySelector("#import-file").click();
  if (action === "reset-progress") resetProgress();
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-view]");
    if (nav) { setView(nav.dataset.view); return; }
    const answer = event.target.closest("[data-answer]");
    if (answer) { answerQuestion(answer.dataset.answer); return; }
    const action = event.target.closest("[data-action]");
    if (action) handleAction(action.dataset.action, action);
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "subject-switcher" || event.target.id === "dashboard-subject-switcher") {
      switchSubject(event.target.value);
      return;
    }
    if (event.target.id === "module-filter") {
      preferenceFor().selectedModule = event.target.value;
      saveState();
      renderPractice();
    }
    if (event.target.id === "difficulty-filter") {
      preferenceFor().selectedDifficulty = event.target.value;
      saveState();
      renderPractice();
    }
    if (event.target.id === "import-file" && event.target.files[0]) importProgress(event.target.files[0]);
  });

  document.querySelector("#top-continue").addEventListener("click", () => {
    const session = sessionFor();
    if (session.queueIds.length && !session.completed) setView("practice");
    else startPractice("all");
  });
  document.querySelector("#mobile-menu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  document.addEventListener("keydown", (event) => {
    if (app.view !== "practice" || event.target.matches("input, select, textarea")) return;
    if (event.key === "1") answerQuestion("○");
    if (event.key === "2") answerQuestion("×");
    if ((event.key === "n" || event.key === "Enter") && currentSessionAnswer(currentQuestion()?.id)) nextQuestion();
  });
}

async function init() {
  try {
    const response = await fetch("data/subjects.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`問題データの読み込みに失敗しました（${response.status}）`);
    app.data = normalizeSubjectData(await response.json());
    app.state = loadState();
    if (!subjectById(app.state.activeSubjectId)) app.state.activeSubjectId = app.data.subjects[0]?.id;
    ensureQuestionStats();
    saveState();
    renderSubjectSwitcher();
    bindEvents();
    setView("dashboard");
  } catch (error) {
    const openedAsFile = window.location.protocol === "file:";
    const guidance = openedAsFile
      ? `<p>index.html を直接開いています（file://）。ローカルHTTPサーバー経由で開いてください。</p><a class="button button-primary small" href="http://localhost:8767">学習ページを開く</a>`
      : `<p>このディレクトリで <code>python3 -m http.server 8767</code> を実行し、<code>http://localhost:8767</code> を開いてください。</p>`;
    document.querySelector("#view-dashboard").innerHTML = `<div class="empty-state"><strong>問題データを読み込めませんでした</strong><p>${escapeHtml(error.message)}</p>${guidance}</div>`;
  }
}

init();
