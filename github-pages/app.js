const layouts = {
  "2x2": { cols: 2, rows: 2 },
  "3x3": { cols: 3, rows: 3 },
  "4x3": { cols: 4, rows: 3 },
};
const themes = ["Forest", "Water", "Home", "Sky", "Night", "Urban", "Unassigned"];
const colorOrder = ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Neutral"];
const colorAccents = { Red: "#ef4444", Orange: "#f97316", Yellow: "#eab308", Green: "#22c55e", Blue: "#3b82f6", Purple: "#a855f7", Neutral: "#a1a1aa" };
const defaults = { layout: "3x3", mode: "color", rainbow: true, reverse: false, fullPages: false, orders: { manual: [] } };

const state = { ...structuredClone(defaults), cards: [], page: 0, pages: [], sorted: [], dragId: null, dropSlot: null, selectedId: null, lastFlip: 0 };
const $ = (selector) => document.querySelector(selector);
const dbPromise = openDatabase();
let toastTimer;
let confirmHandler = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("binder-studio-pages", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("cards")) db.createObjectStore("cards", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllCards() {
  const db = await dbPromise;
  return requestPromise(db.transaction("cards", "readonly").objectStore("cards").getAll());
}

async function putCard(card) {
  const db = await dbPromise;
  return requestPromise(db.transaction("cards", "readwrite").objectStore("cards").put({
    id: card.id, name: card.name, blob: card.blob, dominantHex: card.dominantHex, hue: card.hue, colorGroup: card.colorGroup, theme: card.theme, createdAt: card.createdAt,
  }));
}

async function deleteCardRecord(id) {
  const db = await dbPromise;
  return requestPromise(db.transaction("cards", "readwrite").objectStore("cards").delete(id));
}

async function loadSettings() {
  const db = await dbPromise;
  const row = await requestPromise(db.transaction("settings", "readonly").objectStore("settings").get("app"));
  return row?.value;
}

async function saveSettings() {
  const db = await dbPromise;
  const value = { layout: state.layout, mode: state.mode, rainbow: state.rainbow, reverse: state.reverse, fullPages: state.fullPages, orders: state.orders };
  return requestPromise(db.transaction("settings", "readwrite").objectStore("settings").put({ key: "app", value }));
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function rgbToHsl(r, g, b) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === rr) hue = 60 * (((gg - bb) / delta) % 6);
    else if (max === gg) hue = 60 * ((bb - rr) / delta + 2);
    else hue = 60 * ((rr - gg) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { hue: Math.round(hue), saturation: saturation * 100, lightness: lightness * 100 };
}

function colorGroupFromHsl(hue, saturation, lightness) {
  if (saturation < 14 || lightness < 11 || lightness > 92) return "Neutral";
  if (hue < 15 || hue >= 290) return "Red";
  if (hue < 45) return "Orange";
  if (hue < 70) return "Yellow";
  if (hue < 165) return "Green";
  if (hue < 255) return "Blue";
  return "Purple";
}

function themeFromColor(group) {
  if (group === "Green" || group === "Yellow") return "Forest";
  if (group === "Blue") return "Water";
  if (group === "Red" || group === "Orange") return "Home";
  if (group === "Purple") return "Night";
  return "Unassigned";
}

async function analyzeFile(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 32; canvas.height = 44;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, 32, 44); bitmap.close();
  const pixels = context.getImageData(0, 0, 32, 44).data;
  let r = 0, g = 0, b = 0, weight = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const pr = pixels[index], pg = pixels[index + 1], pb = pixels[index + 2], alpha = pixels[index + 3] / 255;
    const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb), saturation = max ? (max - min) / max : 0, brightness = (pr + pg + pb) / 3;
    if (alpha < .5 || brightness > 247 || brightness < 8) continue;
    const pixelWeight = alpha * (.35 + saturation);
    r += pr * pixelWeight; g += pg * pixelWeight; b += pb * pixelWeight; weight += pixelWeight;
  }
  const red = Math.round(r / Math.max(weight, 1)), green = Math.round(g / Math.max(weight, 1)), blue = Math.round(b / Math.max(weight, 1));
  const hsl = rgbToHsl(red, green, blue);
  const dominantHex = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  const colorGroup = colorGroupFromHsl(hsl.hue, hsl.saturation, hsl.lightness);
  return { dominantHex, hue: hsl.hue, colorGroup, theme: themeFromColor(colorGroup) };
}

function cleanName(filename) {
  return filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ensureOrders() {
  const ids = state.cards.map((card) => card.id);
  for (const mode of ["manual", "color", "theme"]) {
    if (!state.orders[mode]) continue;
    state.orders[mode] = state.orders[mode].filter((id) => ids.includes(id));
    for (const id of ids) if (!state.orders[mode].includes(id)) state.orders[mode].push(id);
  }
  if (!state.orders.manual) state.orders.manual = [...ids];
}

function sortedCards() {
  const cards = [...state.cards];
  const saved = state.orders[state.mode];
  if (saved?.length) {
    const positions = new Map(saved.map((id, index) => [id, index]));
    cards.sort((a, b) => (positions.get(a.id) ?? 1e9) - (positions.get(b.id) ?? 1e9));
  } else if (state.mode === "theme") {
    cards.sort((a, b) => themes.indexOf(a.theme) - themes.indexOf(b.theme) || a.hue - b.hue);
  } else if (state.mode === "color" && state.rainbow) {
    cards.sort((a, b) => a.hue - b.hue);
  } else if (state.mode === "color") {
    cards.sort((a, b) => colorOrder.indexOf(a.colorGroup) - colorOrder.indexOf(b.colorGroup) || a.name.localeCompare(b.name));
  }
  return state.reverse && state.mode !== "manual" ? cards.reverse() : cards;
}

function buildPages(cards) {
  const capacity = layouts[state.layout].cols * layouts[state.layout].rows;
  const slots = [];
  cards.forEach((card, index) => {
    const previous = cards[index - 1];
    const changed = previous && state.mode !== "manual" && (state.mode === "color" ? previous.colorGroup !== card.colorGroup : previous.theme !== card.theme);
    if (state.fullPages && state.mode !== "manual" && changed) while (slots.length % capacity) slots.push(null);
    slots.push(card);
  });
  if (!slots.length) return [Array(capacity).fill(null)];
  const pages = [];
  for (let index = 0; index < slots.length; index += capacity) pages.push([...slots.slice(index, index + capacity), ...Array(Math.max(0, capacity - slots.slice(index, index + capacity).length)).fill(null)]);
  return pages;
}

function render() {
  ensureOrders();
  state.sorted = sortedCards();
  state.pages = buildPages(state.sorted);
  state.page = Math.max(0, Math.min(state.page, state.pages.length - 1));
  renderControls(); renderBinder();
}

function renderControls() {
  document.querySelectorAll("[data-layout]").forEach((button) => button.classList.toggle("active", button.dataset.layout === state.layout));
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  $("#rainbow").checked = state.rainbow; $("#reverse").checked = state.reverse; $("#full-pages").checked = state.fullPages;
  const rainbowLabel = $("#rainbow").closest("label"), reverseLabel = $("#reverse").closest("label"), fullLabel = $("#full-pages").closest("label");
  $("#rainbow").disabled = state.mode !== "color"; rainbowLabel.classList.toggle("disabled", state.mode !== "color");
  $("#reverse").disabled = state.mode === "manual"; reverseLabel.classList.toggle("disabled", state.mode === "manual");
  $("#full-pages").disabled = state.mode === "manual"; fullLabel.classList.toggle("disabled", state.mode === "manual");
  $("#full-pages-help").textContent = `Leave empty pockets before the next ${state.mode === "color" ? "color" : "theme"}.`;
  $("#group-status").textContent = state.fullPages ? "Grouped: each section begins on a fresh page." : "Continuous: every open pocket is filled.";
  $("#preview-title").textContent = state.mode === "color" ? (state.rainbow ? "Color spectrum" : "Color families") : state.mode === "theme" ? "Themes & locations" : "Manual order";
  $("#card-count").lastChild.textContent = state.cards.length ? `${state.cards.length} card${state.cards.length === 1 ? "" : "s"}` : "Empty binder";
  $("#reset").disabled = state.cards.length === 0;
}

function renderBinder() {
  const layout = layouts[state.layout], page = state.pages[state.page];
  const pockets = $("#pockets"); pockets.replaceChildren();
  pockets.style.gridTemplateColumns = `repeat(${layout.cols},minmax(0,1fr))`;
  pockets.style.gridTemplateRows = `repeat(${layout.rows},minmax(0,1fr))`;
  page.forEach((card, index) => {
    const slot = state.page * layout.cols * layout.rows + index;
    const pocket = document.createElement(card ? "button" : "div");
    pocket.className = `pocket ${card ? "card" : "empty"}`;
    pocket.dataset.slot = String(slot);
    pocket.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(pocket, slot); checkPageEdge(event); });
    pocket.addEventListener("drop", (event) => dropCard(event, slot));
    if (card) {
      pocket.type = "button"; pocket.draggable = true; pocket.setAttribute("aria-label", `Edit ${card.name}`);
      const frame = document.createElement("div"), image = document.createElement("img"); image.src = card.imageUrl; image.alt = card.name; frame.append(image); pocket.append(frame);
      pocket.addEventListener("click", () => openCard(card.id));
      pocket.addEventListener("dragstart", (event) => { state.dragId = card.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", card.id); requestAnimationFrame(() => pocket.classList.add("drag-source")); });
      pocket.addEventListener("dragend", clearDrag);
    }
    pockets.append(pocket);
  });
  $("#page-label").textContent = `${state.page + 1} / ${state.pages.length}`;
  $("#previous").disabled = state.page === 0; $("#next").disabled = state.page === state.pages.length - 1;
  renderBadges(page); renderDots();
}

function renderBadges(page) {
  const holder = $("#group-badges"); holder.replaceChildren();
  if (state.mode === "manual") return;
  const groups = [...new Set(page.filter(Boolean).map((card) => state.mode === "color" ? card.colorGroup : card.theme))];
  groups.forEach((group) => {
    const badge = document.createElement("span"); badge.className = "badge";
    if (state.mode === "color") { const dot = document.createElement("i"); dot.style.background = colorAccents[group] || colorAccents.Neutral; badge.append(dot); }
    badge.append(document.createTextNode(group)); holder.append(badge);
  });
}

function renderDots() {
  const holder = $("#page-dots"); holder.replaceChildren();
  const start = Math.max(0, state.page - 3), end = Math.min(state.pages.length, state.page + 4);
  for (let index = start; index < end; index++) {
    const dot = document.createElement("button"); dot.className = index === state.page ? "active" : ""; dot.setAttribute("aria-label", `Go to page ${index + 1}`);
    dot.addEventListener("click", () => { state.page = index; renderBinder(); }); holder.append(dot);
  }
}

function setDropTarget(element, slot) {
  document.querySelectorAll(".drop-target").forEach((item) => item.classList.remove("drop-target"));
  element.classList.add("drop-target"); state.dropSlot = slot;
}

function clearDrag() {
  state.dragId = null; state.dropSlot = null;
  document.querySelectorAll(".drop-target,.drag-source").forEach((item) => item.classList.remove("drop-target", "drag-source"));
}

function checkPageEdge(event) {
  if (!state.dragId || Date.now() - state.lastFlip < 650) return;
  const rect = $("#binder").getBoundingClientRect(), edge = Math.max(42, rect.width * .12);
  if (event.clientX < rect.left + edge && state.page > 0) { state.lastFlip = Date.now(); state.page--; renderBinder(); }
  else if (event.clientX > rect.right - edge && state.page < state.pages.length - 1) { state.lastFlip = Date.now(); state.page++; renderBinder(); }
}

async function dropCard(event, targetSlot) {
  event.preventDefault(); event.stopPropagation();
  const sourceId = state.dragId || event.dataTransfer.getData("text/plain");
  const fromIndex = state.sorted.findIndex((card) => card.id === sourceId);
  if (fromIndex < 0) return clearDrag();
  const cardsBefore = state.pages.flat().slice(0, targetSlot).filter(Boolean).length;
  const reordered = [...state.sorted], [moved] = reordered.splice(fromIndex, 1);
  const target = Math.min(reordered.length, Math.max(0, cardsBefore - (fromIndex < cardsBefore ? 1 : 0)));
  reordered.splice(target, 0, moved);
  state.orders[state.mode] = (state.reverse && state.mode !== "manual" ? [...reordered].reverse() : reordered).map((card) => card.id);
  await saveSettings(); clearDrag(); render(); showToast(`Saved in ${state.mode} mode.`);
}

async function addFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  const wrap = $("#progress-wrap"), bar = $("#progress-bar"), label = $("#progress-label"); wrap.hidden = false;
  let cursor = 0, done = 0, added = 0;
  const workers = Array.from({ length: Math.min(4, files.length) }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      try {
        const analysis = await analyzeFile(file);
        const card = { id: crypto.randomUUID(), name: cleanName(file.name), blob: file, imageUrl: URL.createObjectURL(file), createdAt: Date.now() + cursor, ...analysis };
        await putCard(card); state.cards.push(card); added++;
        for (const mode of ["manual", "color", "theme"]) if (state.orders[mode]) state.orders[mode].push(card.id);
      } catch { /* Keep the rest of a large batch moving. */ }
      done++; bar.style.width = `${done / files.length * 100}%`; label.textContent = `Analyzing ${done} / ${files.length}`;
    }
  });
  await Promise.all(workers); await saveSettings(); wrap.hidden = true; bar.style.width = "0"; $("#file-input").value = ""; state.page = 0; render();
  showToast(`${added} card${added === 1 ? "" : "s"} analyzed and saved${added < files.length ? "; some images could not be read" : ""}.`, added ? "" : "error");
}

function openCard(id) {
  const card = state.cards.find((item) => item.id === id); if (!card) return;
  state.selectedId = id; $("#dialog-image").src = card.imageUrl; $("#dialog-image").alt = card.name; $("#dialog-name").textContent = card.name;
  $("#theme-select").value = card.theme; $("#color-swatch").style.background = card.dominantHex; $("#color-name").textContent = card.colorGroup; $("#color-value").textContent = `${card.dominantHex} · ${card.hue}°`;
  $("#card-dialog").showModal();
}

function askConfirmation(title, copy, action, handler) {
  $("#confirm-title").textContent = title; $("#confirm-copy").textContent = copy; $("#confirm-action").textContent = action; confirmHandler = handler; $("#confirm-dialog").showModal();
}

async function removeSelected() {
  const card = state.cards.find((item) => item.id === state.selectedId); if (!card) return;
  await deleteCardRecord(card.id); URL.revokeObjectURL(card.imageUrl); state.cards = state.cards.filter((item) => item.id !== card.id);
  for (const mode of Object.keys(state.orders)) state.orders[mode] = state.orders[mode].filter((id) => id !== card.id);
  await saveSettings(); $("#card-dialog").close(); state.selectedId = null; render(); showToast("Card removed.");
}

async function resetBinder() {
  const db = await dbPromise;
  await requestPromise(db.transaction("cards", "readwrite").objectStore("cards").clear());
  state.cards.forEach((card) => URL.revokeObjectURL(card.imageUrl)); Object.assign(state, structuredClone(defaults), { cards: [], page: 0, selectedId: null, dragId: null, dropSlot: null });
  await saveSettings(); render(); showToast("Binder reset. You can start fresh.");
}

function showToast(message, kind = "") {
  const toast = $("#toast"); toast.textContent = message; toast.className = `toast show ${kind}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.className = "toast", 3300);
}

function bindEvents() {
  $("#upload-top").addEventListener("click", () => $("#file-input").click()); $("#drop-zone").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", (event) => addFiles(event.target.files));
  const dropZone = $("#drop-zone");
  dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("dragging"); }); dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
  dropZone.addEventListener("drop", (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); addFiles(event.dataTransfer.files); });
  $("#layouts").addEventListener("click", (event) => { const value = event.target.closest("[data-layout]")?.dataset.layout; if (!value) return; state.layout = value; state.page = 0; saveSettings(); render(); });
  $("#modes").addEventListener("click", (event) => { const value = event.target.closest("[data-mode]")?.dataset.mode; if (!value) return; state.mode = value; if (value === "manual") { state.reverse = false; state.fullPages = false; } state.page = 0; saveSettings(); render(); });
  for (const [id, key] of [["#rainbow", "rainbow"], ["#reverse", "reverse"], ["#full-pages", "fullPages"]]) $(id).addEventListener("change", (event) => { state[key] = event.target.checked; state.page = 0; saveSettings(); render(); });
  $("#previous").addEventListener("click", () => { if (state.page > 0) { state.page--; renderBinder(); } }); $("#next").addEventListener("click", () => { if (state.page < state.pages.length - 1) { state.page++; renderBinder(); } });
  $("#binder").addEventListener("dragover", checkPageEdge); document.addEventListener("dragend", clearDrag);
  $(".dialog-close").addEventListener("click", () => $("#card-dialog").close());
  $("#theme-select").innerHTML = themes.map((theme) => `<option value="${theme}">${theme}</option>`).join("");
  $("#theme-select").addEventListener("change", async (event) => { const card = state.cards.find((item) => item.id === state.selectedId); if (!card) return; card.theme = event.target.value; await putCard(card); render(); showToast("Theme saved."); });
  $("#remove-card").addEventListener("click", () => askConfirmation("Remove this card?", "This removes the image and its saved binder details from this browser.", "Remove card", removeSelected));
  $("#reset").addEventListener("click", () => askConfirmation("Reset the entire binder?", "Every uploaded card, theme label, and saved order in this browser will be permanently removed.", "Reset everything", resetBinder));
  $("#confirm-cancel").addEventListener("click", () => { confirmHandler = null; $("#confirm-dialog").close(); });
  $("#confirm-action").addEventListener("click", async () => { const action = confirmHandler; confirmHandler = null; $("#confirm-dialog").close(); if (action) await action(); });
  for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
}

async function initialize() {
  bindEvents();
  try {
    const [records, saved] = await Promise.all([getAllCards(), loadSettings()]);
    if (saved) Object.assign(state, { ...defaults, ...saved, orders: saved.orders || { manual: [] } });
    state.cards = records.sort((a, b) => a.createdAt - b.createdAt).map((card) => ({ ...card, imageUrl: URL.createObjectURL(card.blob) }));
    ensureOrders(); await saveSettings(); render();
  } catch { render(); showToast("Browser storage is unavailable. Check this browser's privacy settings.", "error"); }
}

initialize();
