/* ============================================================
   Service Desk — Supabase edition (user + admin)
   ============================================================ */

const sb = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_KEY
);

/* ---------- DOM ---------- */
const requestList = document.getElementById("requestList");
const adminRequestList = document.getElementById("adminRequestList");
const adminFilters = document.getElementById("adminFilters");
const requestForm = document.getElementById("requestForm");
const submitButton = document.getElementById("submitButton");
const toast = document.getElementById("toast");
const requestDetails = document.getElementById("requestDetails");
const confirmDialog = document.getElementById("confirmDialog");
const confirmCloseButton = document.getElementById("confirmCloseButton");
const cancelCloseButton = document.getElementById("cancelCloseButton");
const navElement = document.querySelector(".nav");

/* ---------- Состояние ---------- */
let requests = [];
let allRequests = [];
let currentRequestId = null;
let toastTimer = null;
let currentUser = null;
let currentProfile = null;
let adminFilter = "all";
let pendingCloseSource = null;

/* ============================================================
   Auth UI
   ============================================================ */

function injectAuthUI() {
  const authSection = document.createElement("section");
  authSection.id = "authPage";
  authSection.className = "page";
  authSection.hidden = true;
  authSection.innerHTML = `
    <div class="page-title-row">
      <div>
        <h1>Вход в Service Desk</h1>
        <p class="page-subtitle">Войдите или зарегистрируйтесь, чтобы создавать заявки.</p>
      </div>
    </div>

    <form id="authForm" class="form-card" novalidate>
      <div class="field">
        <label for="authEmail">Email <span class="required">*</span></label>
        <input id="authEmail" type="email" required
               placeholder="you@example.com"
               aria-describedby="authError">
      </div>

      <div class="field">
        <label for="authPassword">Пароль <span class="required">*</span></label>
        <input id="authPassword" type="password" required minlength="6"
               placeholder="Минимум 6 символов"
               aria-describedby="authError">
      </div>

      <div class="field-error" id="authError" role="alert"></div>

      <div class="actions">
        <button id="loginButton" class="button button-primary" type="submit">
          Войти
        </button>
        <button id="signupButton" class="button button-secondary" type="button">
          Зарегистрироваться
        </button>
      </div>
    </form>
  `;

  document.querySelector("main").appendChild(authSection);

  const logoutBtn = document.createElement("button");
  logoutBtn.id = "logoutButton";
  logoutBtn.className = "nav-link";
  logoutBtn.textContent = "Выйти";
  logoutBtn.hidden = true;
  navElement.appendChild(logoutBtn);

  return { authSection, logoutBtn };
}

const { authSection, logoutBtn } = injectAuthUI();

const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authError = document.getElementById("authError");
const loginButton = document.getElementById("loginButton");
const signupButton = document.getElementById("signupButton");

/* ============================================================
   Утилиты
   ============================================================ */

function showToast(message, type = "success") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function badgeClass(status) {
  if (status === "Новая") return "badge badge-new";
  if (status === "В работе") return "badge badge-work";
  if (status === "Закрыта") return "badge badge-closed";
  return "badge";
}

function formatDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("ru-RU"); } catch { return iso; }
}

function isAdmin() {
  return currentProfile?.role === "admin";
}

/* ============================================================
   Навигация
   ============================================================ */

function navigate(pageId) {
  document.querySelectorAll(".page").forEach((page) => {
    page.hidden = page.id !== pageId;
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.page === pageId);
  });

  /* ИЗМЕНЕНО: nav виден всегда, кроме экрана входа.
     Это надёжнее, чем работа с visibility в updateAuthUI/init. */
  if (navElement) navElement.hidden = (pageId === "authPage");

  if (pageId === "listPage")  renderRequests();
  if (pageId === "adminPage") renderAdminRequests();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.addEventListener("click", (event) => {
  const navigationTarget = event.target.closest("[data-page]");
  if (navigationTarget && currentUser) {
    event.preventDefault();
    navigate(navigationTarget.dataset.page);
  }
});

document.getElementById("openCreateButton").addEventListener("click", () => {
  navigate("createPage");
});

/* ============================================================
   Аутентификация
   ============================================================ */

function setAuthError(message) {
  authError.textContent = message || "";
}

function setAuthLoading(isLoading) {
  loginButton.disabled = isLoading;
  signupButton.disabled = isLoading;
  loginButton.textContent = isLoading ? "Подождите…" : "Войти";
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthError("");

  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || password.length < 6) {
    setAuthError("Введите корректный email и пароль (минимум 6 символов).");
    return;
  }

  setAuthLoading(true);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  setAuthLoading(false);

  if (error) setAuthError("Неверный email или пароль.");
});

signupButton.addEventListener("click", async () => {
  setAuthError("");

  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || password.length < 6) {
    setAuthError("Введите корректный email и пароль (минимум 6 символов).");
    return;
  }

  setAuthLoading(true);
  const { data, error } = await sb.auth.signUp({ email, password });
  setAuthLoading(false);

  if (error) { setAuthError(error.message); return; }

  if (data.user && !data.session) {
    showToast("Проверьте почту и подтвердите регистрацию.");
  } else {
    showToast("Регистрация выполнена.");
  }
});

logoutBtn.addEventListener("click", async () => {
  await sb.auth.signOut();
});

/* ============================================================
   Реакция на изменения сессии
   ============================================================ */

async function loadProfile(userId) {
  const { data, error } = await sb
    .from("profiles")
    .select("id, email, role")
    .eq("id", userId)
    .single();

  if (error) {
    console.warn("Профиль не найден, считаем роль = user.", error);
    return { id: userId, email: currentUser?.email, role: "user" };
  }
  return data;
}

async function updateAuthUI(user) {
  currentUser = user;

  if (!user) {
    currentProfile = null;
    requests = [];
    allRequests = [];
    currentRequestId = null;

    document.querySelectorAll('[data-role="admin"]').forEach((el) => {
      el.hidden = true;
    });
    logoutBtn.hidden = true;

    /* ИЗМЕНЕНО: убрали navElement.style.visibility = "hidden" —
       скрытием nav управляет navigate("authPage"). */

    navigate("authPage");
    return;
  }

  currentProfile = await loadProfile(user.id);

  /* ИЗМЕНЕНО: убрали navElement.style.visibility = "visible". */
  logoutBtn.hidden = false;
  logoutBtn.textContent = user.email ? `Выйти (${user.email})` : "Выйти";

  document.querySelectorAll('[data-role="admin"]').forEach((el) => {
    el.hidden = !isAdmin();
  });

  requests = await loadRequests();
  navigate("listPage");
}

sb.auth.onAuthStateChange((_event, session) => {
  updateAuthUI(session?.user ?? null);
});

/* ============================================================
   Данные
   ============================================================ */

/* Заявки текущего пользователя — фильтруем по user_id,
   чтобы админ в разделе «Мои заявки» видел только свои. */
async function loadRequests() {
  if (!currentUser) return [];

  const { data, error } = await sb
    .from("requests")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    showToast("Не удалось загрузить заявки.", "error");
    return [];
  }
  return data || [];
}

/* Все заявки — только для админа. RLS не даст обычному
   пользователю получить чужие строки, но проверяем и здесь. */
async function loadAllRequests() {
  if (!isAdmin()) return [];

  const { data, error } = await sb
    .from("requests")
    .select("*, profiles(email)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    showToast("Не удалось загрузить список заявок.", "error");
    return [];
  }
  return data || [];
}

async function createRequest(payload) {
  const { data, error } = await sb
    .from("requests")
    .insert([{ ...payload, user_id: currentUser.id }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateRequestStatus(id, status) {
  const { error } = await sb
    .from("requests")
    .update({ status })
    .eq("id", id);

  if (error) throw error;
}

/* ============================================================
   Валидация формы
   ============================================================ */

function clearValidation() {
  document.querySelectorAll(".field-error").forEach((el) => {
    if (el.id !== "authError") el.textContent = "";
  });
  requestForm.querySelectorAll("input, select, textarea").forEach((el) => {
    el.classList.remove("input-error");
  });
}

function setFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  const error = document.getElementById(`${fieldId}Error`);
  if (field) field.classList.add("input-error");
  if (error) error.textContent = message;
}

function validateForm() {
  clearValidation();
  let valid = true;

  const title = requestForm.elements.title.value.trim();
  const category = requestForm.elements.category.value;
  const description = requestForm.elements.description.value.trim();

  if (!title) {
    setFieldError("title", "Введите тему заявки.");
    valid = false;
  } else if (title.length < 3) {
    setFieldError("title", "Тема должна содержать не менее 3 символов.");
    valid = false;
  }

  if (!category) {
    setFieldError("category", "Выберите категорию.");
    valid = false;
  }

  if (description.length < 10) {
    setFieldError("description", "Описание должно содержать не менее 10 символов.");
    valid = false;
  }

  return valid;
}

/* ============================================================
   Создание заявки
   ============================================================ */

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    showToast("Сначала войдите в систему.", "error");
    return;
  }

  if (!validateForm()) {
    showToast("Исправьте ошибки в форме.", "error");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Сохранение…";

  try {
    const created = await createRequest({
      title: requestForm.elements.title.value.trim(),
      category: requestForm.elements.category.value,
      description: requestForm.elements.description.value.trim(),
      priority: requestForm.elements.priority.value,
      status: "Новая"
    });

    requests = await loadRequests();
    if (isAdmin()) allRequests = await loadAllRequests();

    requestForm.reset();
    clearValidation();
    navigate("listPage");
    showToast(`Заявка №${created.id} успешно создана.`);
  } catch (error) {
    console.error(error);
    showToast("Не удалось сохранить заявку. Повторите попытку.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Создать заявку";
  }
});

/* ============================================================
   Список моих заявок
   ============================================================ */

function renderRequests() {
  if (!currentUser) return;

  if (requests.length === 0) {
    requestList.innerHTML = `
      <div class="empty-state">
        <h2>Заявок пока нет</h2>
        <p>Создайте первую заявку, чтобы она появилась в этом списке.</p>
        <button class="button button-primary" data-page="createPage">Создать заявку</button>
      </div>
    `;
    return;
  }

  requestList.innerHTML = requests.map((item) => `
    <article class="request-card" tabindex="0" data-request-id="${item.id}"
             role="button" aria-label="Открыть заявку №${item.id}">
      <h2>№${item.id}. ${escapeHtml(item.title)}</h2>
      <div class="meta">
        <span>${escapeHtml(item.category)}</span>
        <span>${escapeHtml(item.priority)}</span>
        <span class="${badgeClass(item.status)}">${escapeHtml(item.status)}</span>
        <span>${escapeHtml(formatDate(item.created_at))}</span>
      </div>
    </article>
  `).join("");
}

requestList.addEventListener("click", openRequestFromEvent);
requestList.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openRequestFromEvent(event);
  }
});

function openRequestFromEvent(event) {
  const card = event.target.closest("[data-request-id]");
  if (!card) return;
  openRequest(Number(card.dataset.requestId));
}

/* ============================================================
   Админ-панель
   ============================================================ */

adminFilters.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-filter]");
  if (!btn) return;
  adminFilter = btn.dataset.filter;

  adminFilters.querySelectorAll(".filter-button").forEach((b) => {
    b.classList.toggle("active", b === btn);
  });

  renderAdminRequests();
});

function renderAdminRequests() {
  if (!isAdmin()) return;

  const list = adminFilter === "all"
    ? allRequests
    : allRequests.filter((r) => r.status === adminFilter);

  if (list.length === 0) {
    adminRequestList.innerHTML = `
      <div class="empty-state">
        <h2>Заявок не найдено</h2>
        <p>${adminFilter === "all"
          ? "Пользователи ещё не создавали заявок."
          : `Нет заявок со статусом «${adminFilter}».`}</p>
      </div>
    `;
    return;
  }

  adminRequestList.innerHTML = list.map((item) => {
    const authorEmail = item.profiles?.email || "—";
    const actions = [];

    if (item.status === "Новая") {
      actions.push(`<button class="button button-primary" data-admin-action="work" data-id="${item.id}">Взять в работу</button>`);
    } else if (item.status === "В работе") {
      actions.push(`<button class="button button-danger" data-admin-action="close" data-id="${item.id}">Закрыть заявку</button>`);
    }

    return `
      <article class="request-card admin-card" data-admin-id="${item.id}">
        <h2>№${item.id}. ${escapeHtml(item.title)}</h2>
        <div class="meta">
          <span>${escapeHtml(item.category)}</span>
          <span>${escapeHtml(item.priority)}</span>
          <span class="${badgeClass(item.status)}">${escapeHtml(item.status)}</span>
          <span class="admin-author">👤 ${escapeHtml(authorEmail)}</span>
          <span>${escapeHtml(formatDate(item.created_at))}</span>
        </div>
        <p class="admin-description">${escapeHtml(item.description)}</p>
        ${actions.length ? `<div class="actions admin-actions">${actions.join("")}</div>` : ""}
      </article>
    `;
  }).join("");
}

adminRequestList.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-admin-action]");
  if (!btn) return;

  if (!isAdmin()) {
    showToast("Недостаточно прав.", "error");
    return;
  }

  const id = Number(btn.dataset.id);
  const action = btn.dataset.adminAction;
  const item = allRequests.find((r) => r.id === id);
  if (!item) return;

  if (action === "work") {
    btn.disabled = true;
    try {
      await updateRequestStatus(id, "В работе");
      item.status = "В работе";
      requests = await loadRequests();
      renderAdminRequests();
      showToast("Заявка переведена в работу.");
    } catch (err) {
      console.error(err);
      showToast("Не удалось изменить статус. Повторите попытку.", "error");
      btn.disabled = false;
    }
    return;
  }

  if (action === "close") {
    currentRequestId = id;
    pendingCloseSource = "admin";
    confirmDialog.showModal();
  }
});

/* ============================================================
   Карточка заявки
   ============================================================ */

function openRequest(id) {
  const item = requests.find((r) => r.id === id)
    || allRequests.find((r) => r.id === id);

  if (!item) {
    showToast("Заявка не найдена.", "error");
    navigate("listPage");
    return;
  }

  currentRequestId = id;
  renderRequestDetails(item);
  navigate("detailPage");
}

/* Кнопки смены статуса показываются ТОЛЬКО админу.
   Обычный пользователь видит только пояснение о статусе. */
function renderRequestDetails(item) {
  let actionHtml = "";

  if (isAdmin()) {
    if (item.status === "Новая") {
      actionHtml = '<button id="advanceButton" class="button button-primary">Взять в работу</button>';
    } else if (item.status === "В работе") {
      actionHtml = '<button id="advanceButton" class="button button-primary">Закрыть заявку</button>';
    } else {
      actionHtml = '<p class="detail-note">Заявка закрыта. Дальнейшие действия недоступны.</p>';
    }
  } else {
    if (item.status === "Закрыта") {
      actionHtml = '<p class="detail-note">Заявка закрыта. Работа завершена.</p>';
    } else {
      actionHtml = '<p class="detail-note">Заявка обрабатывается технической поддержкой.</p>';
    }
  }

  const authorRow = isAdmin() && item.profiles?.email
    ? `<div class="detail-row">
         <div class="detail-label">Автор</div>
         <div class="detail-value">${escapeHtml(item.profiles.email)}</div>
       </div>`
    : "";

  requestDetails.innerHTML = `
    <div class="detail-card">
      <h1>Заявка №${item.id}</h1>

      <div class="detail-row">
        <div class="detail-label">Тема</div>
        <div class="detail-value">${escapeHtml(item.title)}</div>
      </div>

      <div class="detail-row">
        <div class="detail-label">Категория</div>
        <div class="detail-value">${escapeHtml(item.category)}</div>
      </div>

      <div class="detail-row">
        <div class="detail-label">Приоритет</div>
        <div class="detail-value">${escapeHtml(item.priority)}</div>
      </div>

      <div class="detail-row">
        <div class="detail-label">Статус</div>
        <div class="detail-value">
          <span class="${badgeClass(item.status)}">${escapeHtml(item.status)}</span>
        </div>
      </div>

      ${authorRow}

      <div class="detail-row">
        <div class="detail-label">Создана</div>
        <div class="detail-value">${escapeHtml(formatDate(item.created_at))}</div>
      </div>

      <div class="detail-row">
        <div class="detail-label">Описание</div>
        <div class="detail-value detail-description">${escapeHtml(item.description)}</div>
      </div>

      <div class="detail-actions">${actionHtml}</div>
    </div>
  `;

  const advanceButton = document.getElementById("advanceButton");
  if (advanceButton) advanceButton.addEventListener("click", advanceStatus);
}

/* ============================================================
   Переходы состояния
   ============================================================ */

async function advanceStatus() {
  if (!isAdmin()) {
    showToast("Недостаточно прав для изменения статуса.", "error");
    return;
  }

  const item = requests.find((r) => r.id === currentRequestId)
    || allRequests.find((r) => r.id === currentRequestId);

  if (!item) {
    showToast("Заявка не найдена.", "error");
    navigate("listPage");
    return;
  }

  if (item.status === "Новая") {
    try {
      await updateRequestStatus(item.id, "В работе");
      item.status = "В работе";
      requests = await loadRequests();
      if (isAdmin()) allRequests = await loadAllRequests();
      renderRequestDetails(item);
      if (isAdmin()) renderAdminRequests();
      showToast("Заявка переведена в работу.");
    } catch (err) {
      console.error(err);
      showToast("Не удалось изменить статус. Повторите попытку.", "error");
    }
    return;
  }

  if (item.status === "В работе") {
    pendingCloseSource = "user";
    confirmDialog.showModal();
  }
}

confirmCloseButton.addEventListener("click", async () => {
  if (!isAdmin()) {
    confirmDialog.close();
    showToast("Недостаточно прав для изменения статуса.", "error");
    return;
  }

  const item = requests.find((r) => r.id === currentRequestId)
    || allRequests.find((r) => r.id === currentRequestId);

  if (item) {
    try {
      await updateRequestStatus(item.id, "Закрыта");
      item.status = "Закрыта";
      requests = await loadRequests();
      if (isAdmin()) allRequests = await loadAllRequests();
      renderRequestDetails(item);
      if (isAdmin()) renderAdminRequests();
      showToast("Заявка закрыта.");
    } catch (err) {
      console.error(err);
      showToast("Не удалось закрыть заявку. Повторите попытку.", "error");
    }
  }

  confirmDialog.close();
  pendingCloseSource = null;
});

cancelCloseButton.addEventListener("click", () => {
  confirmDialog.close();
  pendingCloseSource = null;
});

/* ============================================================
   Инициализация
   ============================================================ */

(async function init() {
  try {
    const { data: { session } } = await sb.auth.getSession();

    if (session?.user) {
      await updateAuthUI(session.user);
      requests = await loadRequests();
      if (isAdmin()) allRequests = await loadAllRequests();
      renderRequests();
      navigate("listPage");
    } else {
      navigate("authPage");
    }
  } catch (error) {
    console.error("[Service Desk] Ошибка инициализации:", error);

    /* Показываем понятное сообщение вместо белого экрана. */
    document.querySelector("main").insertAdjacentHTML("afterbegin", `
      <div style="padding:16px;margin-bottom:16px;border:1px solid #dc2626;border-radius:8px;background:#fef2f2;color:#991b1b;font-family:Arial,sans-serif;">
        <strong>Ошибка инициализации:</strong> ${String(error.message || error)}
      </div>
    `);
  }
})();