document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "reminder-miniapp-state";
  const CONFIGS_KEY = "reminder-miniapp-configs";
  const form = document.getElementById("reminder-form");
  const statusBox = document.getElementById("status");
  const recipientInput = document.getElementById("recipient-input");
  const addRecipientBtn = document.getElementById("add-recipient-btn");
  const clearAllBtn = document.getElementById("clear-all-btn");
  const saveConfigBtn = document.getElementById("save-config-btn");
  const refreshJobsBtn = document.getElementById("refresh-jobs-btn");
  const recipientTable = document.getElementById("recipient-table");
  const selectedFilesBox = document.getElementById("selected-files");
  const fileInput = document.getElementById("files");
  const configNameInput = document.getElementById("config-name");
  const savedConfigsList = document.getElementById("saved-configs-list");
  const recipients = [];
  let selectedFiles = [];

  function getSavedConfigs() {
    try {
      const raw = localStorage.getItem(CONFIGS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("Ошибка чтения сохранённых конфигураций", error);
      return [];
    }
  }

  function saveConfigs(configs) {
    localStorage.setItem(CONFIGS_KEY, JSON.stringify(configs));
  }

  function getCurrentConfigPayload() {
    return {
      name: configNameInput.value.trim(),
      recipients: [...recipients],
      message: document.getElementById("message").value.trim(),
      intervalSeconds: document.getElementById("interval_seconds").value,
      repeatCount: document.getElementById("repeat_count").value,
      recipientIntervalSeconds: document.getElementById(
        "recipient_interval_seconds",
      ).value,
    };
  }

  function renderSavedConfigs() {
    const configs = getSavedConfigs();
    savedConfigsList.innerHTML = "";

    if (!configs.length) {
      const empty = document.createElement("div");
      empty.className = "saved-config-empty";
      empty.textContent = "Сохранённых конфигураций нет";
      savedConfigsList.appendChild(empty);
      return;
    }

    configs.forEach((config) => {
      const card = document.createElement("div");
      card.className = "saved-config-card";

      const title = document.createElement("div");
      title.className = "saved-config-title";
      title.textContent = config.name || "Без названия";

      const summary = document.createElement("div");
      summary.className = "saved-config-summary";
      const recipientsText =
        Array.isArray(config.recipients) && config.recipients.length
          ? config.recipients.join(", ")
          : "Нет получателей";
      summary.textContent = `${recipientsText} · ${config.message || "Нет текста"} · ${config.intervalSeconds || 0}s · ${config.repeatCount || 1}x`;

      const actions = document.createElement("div");
      actions.className = "config-actions";

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "secondary-btn small-btn";
      applyBtn.textContent = "Применить";
      applyBtn.addEventListener("click", () => {
        applySavedConfig(config);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "secondary-btn danger-btn small-btn";
      deleteBtn.textContent = "Удалить";
      deleteBtn.addEventListener("click", () => {
        removeSavedConfig(config.name);
      });

      actions.appendChild(applyBtn);
      actions.appendChild(deleteBtn);
      card.appendChild(title);
      card.appendChild(summary);
      card.appendChild(actions);
      savedConfigsList.appendChild(card);
    });
  }

  function applySavedConfig(config) {
    recipients.length = 0;
    if (Array.isArray(config.recipients)) {
      recipients.push(...config.recipients);
    }

    document.getElementById("message").value = config.message || "";
    document.getElementById("interval_seconds").value =
      config.intervalSeconds || 3600;
    document.getElementById("repeat_count").value = config.repeatCount || 1;
    document.getElementById("recipient_interval_seconds").value =
      config.recipientIntervalSeconds || 0;
    configNameInput.value = config.name || "";
    saveState();
    renderRecipients();
    saveConfigBtn.textContent = "Сохранить конфигурацию";
    statusBox.textContent = `Конфигурация «${config.name || "Без названия"}» применена.`;
    statusBox.classList.remove("error");
    statusBox.classList.add("success");
  }

  function removeSavedConfig(name) {
    const normalized = (name || "").trim();
    if (!normalized) return;
    const configs = getSavedConfigs().filter(
      (config) =>
        (config.name || "").toLowerCase() !== normalized.toLowerCase(),
    );
    saveConfigs(configs);
    renderSavedConfigs();
    statusBox.textContent = "Конфигурация удалена.";
    statusBox.classList.remove("error");
    statusBox.classList.add("success");
  }

  function saveCurrentConfig() {
    const name = configNameInput.value.trim();
    if (!name) {
      statusBox.textContent = "Введите название конфигурации";
      statusBox.classList.add("error");
      return;
    }

    const configs = getSavedConfigs();
    const payload = {
      name,
      ...getCurrentConfigPayload(),
    };

    const index = configs.findIndex(
      (config) => (config.name || "").toLowerCase() === name.toLowerCase(),
    );
    if (index >= 0) {
      configs[index] = payload;
    } else {
      configs.unshift(payload);
    }

    saveConfigs(configs);
    renderSavedConfigs();
    statusBox.textContent = `Конфигурация «${name}» сохранена.`;
    statusBox.classList.remove("error");
    statusBox.classList.add("success");
  }

  function saveState() {
    const payload = {
      name: configNameInput.value.trim(),
      recipients,
      message: document.getElementById("message").value,
      intervalSeconds: document.getElementById("interval_seconds").value,
      repeatCount: document.getElementById("repeat_count").value,
      recipientIntervalSeconds: document.getElementById(
        "recipient_interval_seconds",
      ).value,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);

      if (state.name !== undefined) {
        configNameInput.value = state.name || "";
      }

      if (Array.isArray(state.recipients)) {
        recipients.push(...state.recipients);
      }

      if (state.message) {
        document.getElementById("message").value = state.message;
      }
      if (state.intervalSeconds) {
        document.getElementById("interval_seconds").value =
          state.intervalSeconds;
      }
      if (state.repeatCount) {
        document.getElementById("repeat_count").value = state.repeatCount;
      }
      if (state.recipientIntervalSeconds !== undefined) {
        document.getElementById("recipient_interval_seconds").value =
          state.recipientIntervalSeconds;
      }
    } catch (error) {
      console.warn("Ошибка чтения localStorage", error);
    }
  }

  function normalizeRecipient(value) {
    return (value || "").trim().replace(/^@+/, "").replace(/\s+/g, "");
  }

  function renderRecipients() {
    recipientTable.innerHTML = "";

    if (!recipients.length) {
      const empty = document.createElement("div");
      empty.className = "recipient-empty";
      empty.textContent = "Пока никого не добавлено";
      recipientTable.appendChild(empty);
      return;
    }

    recipients.forEach((recipient) => {
      const item = document.createElement("div");
      item.className = "recipient-chip";
      item.textContent = recipient;
      item.title = "Кликните, чтобы удалить";
      item.addEventListener("click", () => {
        const index = recipients.indexOf(recipient);
        if (index >= 0) {
          recipients.splice(index, 1);
          saveState();
          renderRecipients();
        }
      });
      recipientTable.appendChild(item);
    });
  }

  function renderSelectedFiles() {
    selectedFilesBox.innerHTML = "";

    if (!selectedFiles.length) {
      selectedFilesBox.textContent = "Файлы не выбраны";
      selectedFilesBox.classList.add("empty");
      return;
    }

    selectedFilesBox.classList.remove("empty");
    selectedFiles.forEach((file) => {
      const item = document.createElement("div");
      item.className = "selected-file";
      item.textContent = file.name;
      selectedFilesBox.appendChild(item);
    });
  }

  function syncFileInput() {
    const dataTransfer = new DataTransfer();
    selectedFiles.forEach((file) => dataTransfer.items.add(file));
    fileInput.files = dataTransfer.files;
  }

  fileInput.addEventListener("change", () => {
    selectedFiles = Array.from(fileInput.files || []);
    renderSelectedFiles();
    saveState();
  });

  function addRecipient() {
    const raw = recipientInput.value.trim();
    if (!raw) {
      statusBox.textContent = "Введите ник или chat_id";
      statusBox.classList.add("error");
      return;
    }

    const normalized = normalizeRecipient(raw);
    if (!normalized) {
      statusBox.textContent = "Некорректный получатель";
      statusBox.classList.add("error");
      return;
    }

    const index = recipients.indexOf(normalized);
    if (index >= 0) {
      recipients.splice(index, 1);
    } else {
      recipients.push(normalized);
    }

    recipientInput.value = "";
    saveState();
    renderRecipients();
    statusBox.textContent = "";
    statusBox.classList.remove("error");
  }

  addRecipientBtn.addEventListener("click", addRecipient);
  recipientInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addRecipient();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    statusBox.textContent = "Создаём напоминание...";
    statusBox.classList.remove("error");

    if (!recipients.length) {
      statusBox.textContent = "Добавьте хотя бы одного получателя";
      statusBox.classList.add("error");
      return;
    }

    const formData = new FormData();
    const message = document.getElementById("message").value.trim();
    const intervalSeconds = Number(
      document.getElementById("interval_seconds").value || 60,
    );
    const repeatCount = Number(
      document.getElementById("repeat_count").value || 1,
    );
    const recipientIntervalSeconds = Number(
      document.getElementById("recipient_interval_seconds").value || 0,
    );

    if (!message) {
      statusBox.textContent = "Укажите текст сообщения";
      statusBox.classList.add("error");
      return;
    }

    formData.append("targets", JSON.stringify(recipients));
    formData.append("message", message);
    formData.append("interval_seconds", String(intervalSeconds));
    formData.append("repeat_count", String(repeatCount));
    formData.append(
      "recipient_interval_seconds",
      String(recipientIntervalSeconds),
    );

    selectedFiles.forEach((file) => {
      formData.append("files", file);
    });

    try {
      const response = await fetch("/api/create-reminder", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Не удалось создать напоминание");
      }

      statusBox.textContent =
        "Напоминание создано и будет отправлено с вашего аккаунта.";
      statusBox.classList.add("success");
      saveState();
      renderRecipients();
      renderSelectedFiles();
      syncFileInput();
      await refreshJobs();
    } catch (error) {
      statusBox.textContent = error.message;
      statusBox.classList.add("error");
    }
  });

  function clearFormState() {
    recipients.length = 0;
    selectedFiles = [];
    recipientInput.value = "";
    configNameInput.value = "";
    document.getElementById("message").value = "";
    document.getElementById("interval_seconds").value = "3600";
    document.getElementById("repeat_count").value = "3";
    document.getElementById("recipient_interval_seconds").value = "0";
    fileInput.value = "";
    localStorage.removeItem(STORAGE_KEY);
    renderRecipients();
    renderSelectedFiles();
    statusBox.textContent = "";
    statusBox.classList.remove("error", "success");
  }

  clearAllBtn.addEventListener("click", clearFormState);
  saveConfigBtn.addEventListener("click", saveCurrentConfig);
  document.getElementById("message").addEventListener("input", saveState);
  document
    .getElementById("interval_seconds")
    .addEventListener("input", saveState);
  document.getElementById("repeat_count").addEventListener("input", saveState);
  document
    .getElementById("recipient_interval_seconds")
    .addEventListener("input", saveState);
  configNameInput.addEventListener("input", saveState);

  async function cancelJob(jobId) {
    try {
      const response = await fetch("/api/cancel-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Не удалось отменить напоминание");
      }

      await refreshJobs();
    } catch (error) {
      console.error("Ошибка отмены:", error);
      alert("Ошибка: " + error.message);
    }
  }

  async function refreshJobs() {
    const jobsList = document.getElementById("jobs-list");
    try {
      const response = await fetch("/api/jobs");
      const data = await response.json();
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];

      if (!jobs.length) {
        jobsList.innerHTML =
          '<div class="job-empty">Активных напоминаний нет</div>';
        return;
      }

      jobsList.innerHTML = jobs
        .map((job) => {
          const targets = Array.isArray(job.targets)
            ? job.targets.join(", ")
            : job.target || "";
          const recipientDelay = Number(job.recipient_interval_seconds || 0);
          return `
                    <div class="job-item">
                        <div class="job-content">
                            <div class="job-title">${targets}</div>
                            <div class="job-meta">${job.message}</div>
                            <div class="job-meta small">Повторы: ${job.repeat_count} · Интервал: ${job.interval_seconds}s · Между получателями: ${recipientDelay}s</div>
                        </div>
                        <button type="button" class="cancel-job-btn danger-btn" data-job-id="${job.id}">Отменить</button>
                    </div>
                `;
        })
        .join("");

      document.querySelectorAll(".cancel-job-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const jobId = btn.dataset.jobId;
          await cancelJob(jobId);
        });
      });
    } catch (error) {
      jobsList.innerHTML =
        '<div class="job-empty">Не удалось загрузить список</div>';
    }
  }

  function switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === tabName);
    });
  }

  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  refreshJobsBtn.addEventListener("click", refreshJobs);

  loadState();
  renderRecipients();
  renderSelectedFiles();
  renderSavedConfigs();
  refreshJobs();
  setInterval(refreshJobs, 5000);
});
