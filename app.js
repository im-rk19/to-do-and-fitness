/* ═══════════════════════════════════════════════════════
   DASHBOARD — app.js
   v3: + inline edit + drag-to-reorder (pointer events)
═══════════════════════════════════════════════════════ */

'use strict';

/* ─── STORAGE KEYS ─── */
const KEYS = {
  todos:   'dashboard_todos',
  goals:   'dashboard_goals',
  meals:   'dashboard_meals',
  streak:  'dashboard_streak',
  session: 'dashboard_session',
};

const CREDS = { username: 'isagi', password: 'isagi' };

/* ─── HELPERS ─── */
function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? null; }
  catch { return null; }
}
function saveLocal(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function save(key, value) { saveLocal(key, value); if (key !== KEYS.session) CloudSync.schedulePush(); }
function remove(key)      { localStorage.removeItem(key); }
function genId()          { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${mo[+m-1]} ${+d}, ${y}`;
}
function formatDatetime(s) {
  if (!s) return '';
  return new Date(s).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
}
function isOverdue(due) { return !!due && due < todayStr(); }
function getGreeting()  {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,';
}

let _toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('visible'), 2400);
}

/* ─── SVG CONSTANTS ─── */
const CHECK_SVG = `<svg width="10" height="8" viewBox="0 0 10 8" fill="none">
  <path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const DRAG_SVG = `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
  <circle cx="4" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/>
  <circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
  <circle cx="4" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
</svg>`;

const EDIT_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
</svg>`;

/* ─── SERVICE WORKER ─── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

/* ═══════════════════════════════════════════════════════
   DnD ENGINE — Pointer Events (unified mouse + touch)
   Attach to a drag-handle element; fires onFinish(orderedIds)
   with the new array order of [data-id] siblings.
═══════════════════════════════════════════════════════ */
const DnD = (() => {
  let drag = null;

  function attach(handleEl, cardEl, onFinish) {
    handleEl.addEventListener('pointerdown', e => {
      if (e.button > 0) return; // ignore right-click
      e.preventDefault();
      handleEl.setPointerCapture(e.pointerId); // capture all future pointer events

      const rect = cardEl.getBoundingClientRect();

      // 1. Ghost clone that floats under cursor
      const ghost = cardEl.cloneNode(true);
      ghost.style.cssText = [
        'position:fixed', 'z-index:9999', 'pointer-events:none',
        `width:${rect.width}px`, `left:${rect.left}px`, `top:${rect.top}px`,
        'opacity:0.92', 'transform:scale(1.02) rotate(-0.7deg)',
        'box-shadow:0 20px 56px rgba(0,0,0,0.6)', 'transition:none',
        'border-radius:14px',
      ].join(';');
      document.body.appendChild(ghost);

      // 2. Placeholder (empty slot in the list)
      const ph = document.createElement(cardEl.tagName.toLowerCase());
      ph.className = 'dnd-placeholder';
      ph.style.height = rect.height + 'px';
      cardEl.parentNode.insertBefore(ph, cardEl);
      cardEl.style.visibility = 'hidden';

      drag = { ghost, ph, cardEl, onFinish, offsetY: e.clientY - rect.top };
    });

    handleEl.addEventListener('pointermove', e => {
      if (!drag) return;
      e.preventDefault();
      const { ghost, ph, cardEl, offsetY } = drag;

      // Move ghost with cursor
      ghost.style.top = (e.clientY - offsetY) + 'px';

      // Find card under ghost: briefly hide ghost so elementFromPoint can see beneath
      ghost.style.display = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      ghost.style.display = '';

      const listEl   = ph.parentNode;
      const target   = under && (under.dataset.id ? under : under.closest('[data-id]'));

      if (target && target !== cardEl && target !== ph && listEl.contains(target)) {
        const tr  = target.getBoundingClientRect();
        const mid = tr.top + tr.height / 2;
        if (e.clientY < mid) {
          listEl.insertBefore(ph, target);
        } else {
          const next = target.nextElementSibling;
          next ? listEl.insertBefore(ph, next) : listEl.appendChild(ph);
        }
      }
    });

    const finish = () => {
      if (!drag) return;
      const { ghost, ph, cardEl, onFinish } = drag;
      drag = null;

      // Collect ordered IDs: placeholder marks where the dragged card ends up
      const orderedIds = [];
      for (const child of ph.parentNode.children) {
        if (child === ph)                                              orderedIds.push(cardEl.dataset.id);
        else if (child.dataset.id && child.dataset.id !== cardEl.dataset.id) orderedIds.push(child.dataset.id);
      }

      // Restore DOM
      ghost.remove();
      cardEl.style.visibility = '';
      ph.replaceWith(cardEl);

      onFinish(orderedIds);
    };

    handleEl.addEventListener('pointerup', finish);
    handleEl.addEventListener('pointercancel', () => {
      if (!drag) return;
      const { ghost, ph, cardEl } = drag;
      drag = null;
      ghost.remove();
      cardEl.style.visibility = '';
      ph.replaceWith(cardEl);
    });
  }

  return { attach };
})();

/* ═══════════════════════════════════════════════════════
   MODULE: AUTH
═══════════════════════════════════════════════════════ */
const Auth = (() => {
  function isLoggedIn() { return load(KEYS.session) === true; }

  function showLogin() {
    document.getElementById('loginScreen').hidden = false;
    document.getElementById('appWrapper').hidden  = true;
    document.getElementById('loginUser').focus();
  }

  async function showApp() {
    document.getElementById('loginScreen').hidden = true;
    document.getElementById('appWrapper').hidden  = false;
    document.getElementById('headerHi').textContent = getGreeting();
    CloudSync.init();
    await CloudSync.pull();          // hydrate localStorage from cloud before first render
    initTabs();
    Streak.init();
    TaskModule.init();
    MealModule.init();
    CloudSync.subscribe(() => {
      // Remote update received — skip if user is mid-edit
      if (document.querySelector('.task-card.editing, .meal-card.editing')) return;
      Streak.render();
      TaskModule.renderAll('todo');
      TaskModule.renderAll('goal');
      MealModule.renderAll();
      showToast('🔄 Synced from another device');
    });
  }

  function login(u, p) {
    if (u.trim().toLowerCase() === CREDS.username && p === CREDS.password) {
      save(KEYS.session, true);
      return true;
    }
    return false;
  }

  function logout() {
    remove(KEYS.session);
    document.getElementById('loginUser').value  = '';
    document.getElementById('loginPass').value  = '';
    document.getElementById('loginError').textContent = '';
    closeAvatarMenu();
    showLogin();
  }

  function closeAvatarMenu() {
    document.getElementById('avatarMenu').hidden = true;
    document.getElementById('avatarBtn').setAttribute('aria-expanded', 'false');
  }

  function initLoginForm() {
    const form      = document.getElementById('loginForm');
    const errorEl   = document.getElementById('loginError');
    const passInput = document.getElementById('loginPass');

    // Password visibility toggle
    document.getElementById('togglePass').addEventListener('click', () => {
      const show = passInput.type === 'password';
      passInput.type = show ? 'text' : 'password';
      document.getElementById('eyeIcon').innerHTML = show
        ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
        : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const u = document.getElementById('loginUser').value;
      const p = passInput.value;
      errorEl.textContent = '';

      if (!u || !p) { errorEl.textContent = 'Please fill in both fields.'; return; }

      if (login(u, p)) {
        showApp();
      } else {
        errorEl.textContent = 'Incorrect username or password.';
        passInput.value = '';
        passInput.focus();
        const card = document.querySelector('.login-card');
        card.style.animation = 'none';
        card.offsetHeight; // reflow
        card.style.animation = 'loginShake 0.35s ease';
      }
    });
  }

  function initAvatarMenu() {
    const avatarBtn = document.getElementById('avatarBtn');
    const menu      = document.getElementById('avatarMenu');
    avatarBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = !menu.hidden;
      menu.hidden = open;
      avatarBtn.setAttribute('aria-expanded', String(!open));
    });
    document.addEventListener('click', e => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== avatarBtn) closeAvatarMenu();
    });
    document.getElementById('logoutBtn').addEventListener('click', logout);
  }

  function init() {
    // Shake animation
    const s = document.createElement('style');
    s.textContent = `@keyframes loginShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}`;
    document.head.appendChild(s);

    initLoginForm();
    initAvatarMenu();
    isLoggedIn() ? showApp() : showLogin();
  }

  return { init };
})();

/* ═══════════════════════════════════════════════════════
   MODULE: STREAK
═══════════════════════════════════════════════════════ */
const Streak = (() => {
  function getState() { return load(KEYS.streak) ?? { count: 0, lastDoneDate: null, markedToday: false }; }
  function saveState(s) { save(KEYS.streak, s); }

  function reconcile() {
    const s = getState(), today = todayStr();
    const d = new Date(); d.setDate(d.getDate() - 1);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (s.lastDoneDate && s.lastDoneDate !== today && s.lastDoneDate !== yesterday) { s.count = 0; s.markedToday = false; saveState(s); }
    if (s.lastDoneDate === yesterday) { s.markedToday = false; saveState(s); }
    if (s.lastDoneDate === today)     { s.markedToday = true;  saveState(s); }
  }

  function render() {
    const s = getState();
    document.getElementById('streakDisplay').textContent = `🔥 Day ${s.count}`;
    const btn = document.getElementById('ifBtn');
    btn.textContent = s.markedToday ? 'IF Done ✓' : 'Mark Today as IF Done';
    btn.classList.toggle('done', s.markedToday);
  }

  function markToday() {
    const s = getState();
    if (s.markedToday) return;
    s.markedToday = true; s.count += 1; s.lastDoneDate = todayStr();
    saveState(s); render();
    showToast(`🔥 Streak: Day ${s.count}! Keep it up!`);
  }

  function init() { reconcile(); render(); document.getElementById('ifBtn').addEventListener('click', markToday); }
  return { init, render };
})();

/* ═══════════════════════════════════════════════════════
   MODULE: TASKS (Todos + Goals)
   — inline edit (title, due, priority)
   — drag-to-reorder active items
═══════════════════════════════════════════════════════ */
const TaskModule = (() => {
  function createTask(name, due, priority) {
    return { id: genId(), name, due: due || '', priority: priority || 'medium', done: false, createdAt: Date.now() };
  }

  /* ─── Render a single task card ─── */
  function renderCard(task, type, draggable) {
    const li = document.createElement('li');
    li.className = `task-card${task.done ? ' completed' : ''}`;
    li.dataset.id = task.id;

    const overdue = !task.done && isOverdue(task.due);

    li.innerHTML = `
      ${draggable ? `<span class="drag-handle" title="Drag to reorder">${DRAG_SVG}</span>` : '<span class="drag-handle-placeholder"></span>'}
      <button class="task-check${task.done ? ' checked' : ''}" aria-label="${task.done ? 'Unmark' : 'Mark'} complete">
        ${CHECK_SVG}
      </button>
      <div class="task-body">
        <div class="task-name${task.done ? ' strikethrough' : ''}">${escHtml(task.name)}</div>
        <div class="task-meta">
          <span class="tag-priority ${task.priority}">${capitalize(task.priority)}</span>
          ${task.due ? `<span class="task-due${overdue ? ' overdue' : ''}">📅 ${formatDate(task.due)}${overdue ? ' · Overdue' : ''}</span>` : ''}
        </div>
      </div>
      <button class="btn-edit" aria-label="Edit task" title="Edit">${EDIT_SVG}</button>
      <button class="btn-delete" aria-label="Delete task" title="Delete">✕</button>
    `;

    li.querySelector('.task-check').addEventListener('click', () => toggleTask(task.id, type));
    li.querySelector('.btn-edit').addEventListener('click', () => renderEditCard(task, type, li));
    li.querySelector('.btn-delete').addEventListener('click', () => deleteTask(task.id, type, li));

    return li;
  }

  /* ─── Inline edit mode for a task card ─── */
  function renderEditCard(task, type, li) {
    li.classList.add('editing');
    li.innerHTML = `
      <div class="task-edit-form">
        <input type="text" class="input-text edit-title" value="${escHtml(task.name)}" maxlength="120" placeholder="Task name…" />
        <div class="edit-meta-row">
          <input type="date" class="input-date edit-due" value="${task.due}" title="Due date" />
          <select class="input-select edit-priority">
            <option value="low"    ${task.priority === 'low'    ? 'selected' : ''}>Low</option>
            <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="high"   ${task.priority === 'high'   ? 'selected' : ''}>High</option>
          </select>
        </div>
        <div class="edit-actions">
          <button class="btn-edit-save">Save</button>
          <button class="btn-edit-cancel">Cancel</button>
        </div>
      </div>
    `;

    const titleInput = li.querySelector('.edit-title');
    titleInput.focus();
    titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);

    li.querySelector('.btn-edit-save').addEventListener('click', () => {
      const newName     = li.querySelector('.edit-title').value.trim();
      const newDue      = li.querySelector('.edit-due').value;
      const newPriority = li.querySelector('.edit-priority').value;
      if (!newName) { showToast('Name cannot be empty.'); return; }

      const key   = type === 'todo' ? KEYS.todos : KEYS.goals;
      const tasks = load(key) ?? [];
      const t     = tasks.find(x => x.id === task.id);
      if (t) { t.name = newName; t.due = newDue; t.priority = newPriority; }
      save(key, tasks);
      renderAll(type);
      showToast('✏️ Updated!');
    });

    li.querySelector('.btn-edit-cancel').addEventListener('click', () => renderAll(type));

    titleInput.addEventListener('keydown', e => {
      if (e.key === 'Enter')  li.querySelector('.btn-edit-save').click();
      if (e.key === 'Escape') li.querySelector('.btn-edit-cancel').click();
    });
  }

  /* ─── Render full list ─── */
  function renderAll(type) {
    const key    = type === 'todo' ? KEYS.todos : KEYS.goals;
    const tasks  = load(key) ?? [];
    const active = tasks.filter(t => !t.done);
    const done   = tasks.filter(t =>  t.done);

    const listEl    = document.getElementById(type === 'todo' ? 'todoList'      : 'goalList');
    const doneEl    = document.getElementById(type === 'todo' ? 'todoDoneList'  : 'goalDoneList');
    const doneCount = document.getElementById(type === 'todo' ? 'todoDoneCount' : 'goalDoneCount');

    // Active tasks
    listEl.innerHTML = '';
    if (active.length === 0) {
      listEl.innerHTML = `<li class="empty-state">No ${type === 'todo' ? 'tasks' : 'goals'} yet.<br>Add one above to get started.</li>`;
    } else {
      active.forEach(t => {
        const li = renderCard(t, type, true /* draggable */);
        listEl.appendChild(li);

        // Attach DnD to the drag handle
        const handle = li.querySelector('.drag-handle');
        DnD.attach(handle, li, (orderedIds) => {
          const all  = load(key) ?? [];
          const done = all.filter(x => x.done);
          const reordered = orderedIds.map(id => all.find(x => x.id === id)).filter(Boolean);
          save(key, [...reordered, ...done]);
          // DOM is already in correct order — no re-render needed
        });
      });
    }

    // Done tasks (edit enabled, drag disabled)
    doneEl.innerHTML = '';
    done.forEach(t => doneEl.appendChild(renderCard(t, type, false)));
    doneCount.textContent = done.length;
  }

  function addTask(type) {
    const inputEl    = document.getElementById(type === 'todo' ? 'todoInput'    : 'goalInput');
    const dueEl      = document.getElementById(type === 'todo' ? 'todoDue'      : 'goalDue');
    const priorityEl = document.getElementById(type === 'todo' ? 'todoPriority' : 'goalPriority');
    const name = inputEl.value.trim();
    if (!name) { inputEl.focus(); showToast('Enter a name first.'); return; }

    const tasks = load(type === 'todo' ? KEYS.todos : KEYS.goals) ?? [];
    tasks.unshift(createTask(name, dueEl.value, priorityEl.value));
    save(type === 'todo' ? KEYS.todos : KEYS.goals, tasks);

    inputEl.value = ''; dueEl.value = ''; priorityEl.value = 'medium';
    inputEl.focus();
    renderAll(type);
    showToast(type === 'todo' ? '✅ Task added!' : '🎯 Goal added!');
  }

  function toggleTask(id, type) {
    const key   = type === 'todo' ? KEYS.todos : KEYS.goals;
    const tasks = load(key) ?? [];
    const t     = tasks.find(x => x.id === id);
    if (!t) return;
    t.done = !t.done;
    save(key, tasks);
    renderAll(type);
  }

  function deleteTask(id, type, el) {
    el.classList.add('removing');
    setTimeout(() => {
      save(type === 'todo' ? KEYS.todos : KEYS.goals, (load(type === 'todo' ? KEYS.todos : KEYS.goals) ?? []).filter(x => x.id !== id));
      renderAll(type);
    }, 220);
  }

  function init() {
    renderAll('todo');
    document.getElementById('todoAddBtn').addEventListener('click', () => addTask('todo'));
    document.getElementById('todoInput').addEventListener('keydown', e => { if (e.key === 'Enter') addTask('todo'); });

    renderAll('goal');
    document.getElementById('goalAddBtn').addEventListener('click', () => addTask('goal'));
    document.getElementById('goalInput').addEventListener('keydown', e => { if (e.key === 'Enter') addTask('goal'); });
  }

  return { init, renderAll };
})();

/* ═══════════════════════════════════════════════════════
   MODULE: MEALS
   — inline edit (all fields)
   — drag-to-reorder within each date group
═══════════════════════════════════════════════════════ */
const MealModule = (() => {
  function createMeal(name, cal, protein, datetime, ego, notes) {
    return { id: genId(), name, cal: parseInt(cal) || 0, protein: parseFloat(protein) || 0, datetime, ego: !!ego, notes: notes || '', createdAt: Date.now() };
  }

  function mealDate(m) { return m.datetime ? m.datetime.slice(0, 10) : todayStr(); }

  /* ─── Render full meal log ─── */
  function renderAll() {
    const meals = load(KEYS.meals) ?? [];
    const log   = document.getElementById('mealsLog');
    log.innerHTML = '';

    if (meals.length === 0) {
      log.innerHTML = '<div class="empty-state">No meals logged yet.<br>Add one above to start tracking.</div>';
      return;
    }

    // Group by date
    const groups = {};
    meals.forEach(m => { const d = mealDate(m); (groups[d] = groups[d] || []).push(m); });

    Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach(date => {
      const dayMeals     = groups[date];
      const totalCal     = dayMeals.reduce((s, m) => s + m.cal, 0);
      const totalProtein = dayMeals.reduce((s, m) => s + m.protein, 0);

      const section = document.createElement('div');
      section.className = 'meal-date-group';

      section.innerHTML = `
        <div class="meal-date-header">
          <span class="meal-date-label">${formatDate(date)}</span>
          <span class="meal-date-totals">${totalCal} kcal · ${totalProtein}g protein</span>
        </div>
        <div class="meal-date-chips">
          <div class="meal-stat-chip">
            <span class="meal-stat-chip-value">${totalCal}</span>
            <span class="meal-stat-chip-label">kcal</span>
          </div>
          <div class="meal-stat-chip">
            <span class="meal-stat-chip-value">${totalProtein}g</span>
            <span class="meal-stat-chip-label">protein</span>
          </div>
          <div class="meal-stat-chip">
            <span class="meal-stat-chip-value">${dayMeals.length}</span>
            <span class="meal-stat-chip-label">meals</span>
          </div>
        </div>
      `;

      const cards = document.createElement('div');
      cards.className = 'meal-cards';

      // Display in array order (user can reorder via DnD)
      dayMeals.forEach(m => {
        const card = renderMealCard(m);
        cards.appendChild(card);

        const handle = card.querySelector('.drag-handle');
        DnD.attach(handle, card, (orderedIds) => {
          if (!orderedIds.length) return;
          const all       = load(KEYS.meals) ?? [];
          const thisDate  = date; // captured from outer scope
          const others    = all.filter(m => mealDate(m) !== thisDate);
          const reordered = orderedIds.map(id => all.find(m => m.id === id)).filter(Boolean);
          // Preserve overall date ordering in the array
          const allDates  = [...new Set(all.map(m => mealDate(m)))].sort((a,b) => b.localeCompare(a));
          const rebuilt   = [];
          allDates.forEach(d => {
            if (d === thisDate) reordered.forEach(m => rebuilt.push(m));
            else all.filter(m => mealDate(m) === d).forEach(m => rebuilt.push(m));
          });
          save(KEYS.meals, rebuilt);
          // DOM already reflects new order — no re-render
        });
      });

      section.appendChild(cards);
      log.appendChild(section);
    });
  }

  /* ─── Single meal card ─── */
  function renderMealCard(meal) {
    const div = document.createElement('div');
    div.className = 'meal-card';
    div.dataset.id = meal.id;

    div.innerHTML = `
      <div class="meal-card-header">
        <span class="drag-handle" title="Drag to reorder">${DRAG_SVG}</span>
        <span class="meal-card-name">${escHtml(meal.name)}</span>
        ${meal.ego ? '<span class="badge-ego">✓ Ego-san</span>' : ''}
        <button class="btn-edit" aria-label="Edit meal" title="Edit">${EDIT_SVG}</button>
        <button class="btn-delete" aria-label="Delete meal" title="Delete">✕</button>
      </div>
      <div class="meal-card-stats">
        <span class="meal-stat"><strong>${meal.cal}</strong> kcal</span>
        <span class="meal-stat"><strong>${meal.protein}g</strong> protein</span>
      </div>
      ${meal.datetime ? `<div class="meal-card-time">🕐 ${formatDatetime(meal.datetime)}</div>` : ''}
      ${meal.notes    ? `<div class="meal-card-notes">"${escHtml(meal.notes)}"</div>` : ''}
    `;

    div.querySelector('.btn-edit').addEventListener('click', () => renderMealEditCard(meal, div));
    div.querySelector('.btn-delete').addEventListener('click', () => deleteMeal(meal.id, div));

    return div;
  }

  /* ─── Inline edit mode for a meal card ─── */
  function renderMealEditCard(meal, el) {
    el.classList.add('editing');
    el.innerHTML = `
      <div class="meal-edit-form">
        <div class="meal-edit-field">
          <label class="form-label">Meal Name</label>
          <input type="text" class="input-text edit-meal-name" value="${escHtml(meal.name)}" maxlength="100" placeholder="Meal name…" />
        </div>
        <div class="meal-edit-cols">
          <div class="meal-edit-field">
            <label class="form-label">Calories (kcal)</label>
            <input type="number" class="input-text edit-meal-cal" value="${meal.cal}" min="0" max="9999" />
          </div>
          <div class="meal-edit-field">
            <label class="form-label">Protein (g)</label>
            <input type="number" class="input-text edit-meal-protein" value="${meal.protein}" min="0" max="999" />
          </div>
        </div>
        <div class="meal-edit-field">
          <label class="form-label">Date &amp; Time</label>
          <input type="datetime-local" class="input-text edit-meal-dt" value="${meal.datetime || ''}" />
        </div>
        <div class="meal-edit-field">
          <label class="form-label">Notes <span class="label-optional">(optional)</span></label>
          <input type="text" class="input-text edit-meal-notes" value="${escHtml(meal.notes || '')}" maxlength="200" placeholder="Any notes…" />
        </div>
        <div class="meal-edit-bottom">
          <label class="ego-check-label">
            <input type="checkbox" class="ego-checkbox edit-ego-cb" ${meal.ego ? 'checked' : ''} />
            <span class="ego-check-box"></span>
            <span>Verified by Ego-san ✓</span>
          </label>
          <div class="edit-actions">
            <button class="btn-edit-save">Save</button>
            <button class="btn-edit-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;

    el.querySelector('.edit-meal-name').focus();

    el.querySelector('.btn-edit-save').addEventListener('click', () => {
      const newName = el.querySelector('.edit-meal-name').value.trim();
      if (!newName) { showToast('Meal name is required.'); return; }

      const meals = load(KEYS.meals) ?? [];
      const m     = meals.find(x => x.id === meal.id);
      if (m) {
        m.name     = newName;
        m.cal      = parseInt(el.querySelector('.edit-meal-cal').value)      || 0;
        m.protein  = parseFloat(el.querySelector('.edit-meal-protein').value) || 0;
        m.datetime = el.querySelector('.edit-meal-dt').value;
        m.ego      = el.querySelector('.edit-ego-cb').checked;
        m.notes    = el.querySelector('.edit-meal-notes').value.trim();
      }
      save(KEYS.meals, meals);
      renderAll();
      showToast('✏️ Meal updated!');
    });

    el.querySelector('.btn-edit-cancel').addEventListener('click', () => renderAll());
  }

  function saveMeal() {
    const name     = document.getElementById('mealName').value.trim();
    const cal      = document.getElementById('mealCal').value;
    const protein  = document.getElementById('mealProtein').value;
    const datetime = document.getElementById('mealDatetime').value;
    const ego      = document.getElementById('mealEgo').checked;
    const notes    = document.getElementById('mealNotes').value.trim();

    if (!name) { document.getElementById('mealName').focus(); showToast('Meal name is required.'); return; }

    const meals = load(KEYS.meals) ?? [];
    meals.unshift(createMeal(name, cal, protein, datetime, ego, notes));
    save(KEYS.meals, meals);

    ['mealName','mealCal','mealProtein','mealDatetime','mealNotes'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('mealEgo').checked = false;

    renderAll();
    showToast('🍱 Meal logged!');
  }

  function deleteMeal(id, el) {
    el.classList.add('removing');
    setTimeout(() => {
      save(KEYS.meals, (load(KEYS.meals) ?? []).filter(m => m.id !== id));
      renderAll();
    }, 220);
  }

  function init() {
    const now = new Date(), pad = n => String(n).padStart(2,'0');
    document.getElementById('mealDatetime').value =
      `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    renderAll();
    document.getElementById('mealSaveBtn').addEventListener('click', saveMeal);
  }

  return { init, renderAll };
})();

/* ═══════════════════════════════════════════════════════
   MODULE: CLOUD SYNC — Firebase Realtime Database
   Free Spark plan — no credit card required.
   Stores all data at: users/isagi/ in your RTDB.
   Replace FIREBASE_CONFIG values with your project's config.
   Until configured, the app works offline-only (localStorage).
═══════════════════════════════════════════════════════ */
const CloudSync = (() => {
  // ┌──────────────────────────────────────────────────────────┐
  // │  PASTE YOUR FIREBASE CONFIG HERE                         │
  // │  Firebase Console → Project Settings → Your apps        │
  // │  → Web app → firebaseConfig                             │
  // │  Make sure to include databaseURL (shown below)          │
  // └──────────────────────────────────────────────────────────┘
  const FIREBASE_CONFIG = {
    apiKey:            'YOUR_API_KEY',
    authDomain:        'YOUR_PROJECT_ID.firebaseapp.com',
    databaseURL:       'https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com',
    projectId:         'YOUR_PROJECT_ID',
    storageBucket:     'YOUR_PROJECT_ID.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId:             'YOUR_APP_ID',
  };

  // Keys synced to RTDB (session key stays local-only)
  const SYNC_KEYS = [KEYS.todos, KEYS.goals, KEYS.meals, KEYS.streak];
  const USER_PATH = 'users/isagi';

  let db = null, pushTimer = null, lastPushAt = 0;

  function fieldOf(key) { return key.replace('dashboard_', ''); }

  function isConfigured() {
    return typeof FIREBASE_CONFIG.apiKey === 'string' &&
           FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY' &&
           FIREBASE_CONFIG.apiKey.length > 10 &&
           !FIREBASE_CONFIG.databaseURL.includes('YOUR_PROJECT_ID');
  }

  function init() {
    if (!isConfigured() || typeof firebase === 'undefined') return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.database();
    } catch (e) {
      console.warn('[CloudSync] init failed:', e);
      db = null;
    }
  }

  async function pull() {
    if (!db) return;
    try {
      const snap = await db.ref(USER_PATH).get();
      if (!snap.exists()) return;
      const data = snap.val();
      SYNC_KEYS.forEach(key => {
        const val = data[fieldOf(key)];
        if (val !== undefined && val !== null) saveLocal(key, val);
      });
    } catch (e) {
      console.warn('[CloudSync] pull failed:', e);
    }
  }

  function schedulePush() {
    if (!db) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        const payload = {};
        SYNC_KEYS.forEach(key => { payload[fieldOf(key)] = load(key) ?? null; });
        await db.ref(USER_PATH).set(payload);
        lastPushAt = Date.now();
      } catch (e) {
        console.warn('[CloudSync] push failed:', e);
      }
    }, 2000);
  }

  function subscribe(onRemoteUpdate) {
    if (!db) return;
    db.ref(USER_PATH).on('value', snap => {
      if (!snap.exists()) return;
      if (Date.now() - lastPushAt < 5000) return; // suppress our own echo
      const data = snap.val();
      let changed = false;
      SYNC_KEYS.forEach(key => {
        const incoming = data[fieldOf(key)];
        if (incoming === undefined || incoming === null) return;
        if (JSON.stringify(load(key)) !== JSON.stringify(incoming)) {
          saveLocal(key, incoming);
          changed = true;
        }
      });
      if (changed) onRemoteUpdate();
    }, err => console.warn('[CloudSync] subscribe error:', err));
  }

  return { init, pull, schedulePush, subscribe };
})();

/* ═══════════════════════════════════════════════════════
   TABS
═══════════════════════════════════════════════════════ */
function initTabs() {
  const btns   = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(`tab-${btn.dataset.tab}`);
      if (panel) panel.classList.add('active');
    });
  });
}

/* ─── UTILS ─── */
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

/* ─── BOOT ─── */
document.addEventListener('DOMContentLoaded', () => Auth.init());
