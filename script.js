"use strict";

const PBKDF2_ITERATIONS = 600000;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const $ = (s) => document.querySelector(s);
const ui = {
  hideImage: $("#hide-image"), revealImage: $("#reveal-image"), message: $("#message"), revealPassword: $("#reveal-password"), hideButton: $("#hide-button"), revealButton: $("#reveal-button"), hideStatus: $("#hide-status"), revealStatus: $("#reveal-status"), hideInfo: $("#hide-image-info"), revealInfo: $("#reveal-image-info"), hideMeta: $("#hide-image-meta"), revealMeta: $("#reveal-image-meta"), hideFileCard: $("#hide-file-card"), revealFileCard: $("#reveal-file-card"), capacityBox: $("#capacity-box"), capacityValue: $("#capacity-value"), capacityBar: $("#capacity-bar"), capacityUsage: $("#capacity-usage"), capacityPercent: $("#capacity-percent"), capacityDetail: $("#capacity-detail"), messageCount: $("#message-count"), messageSize: $("#message-size"), original: $("#original-canvas"), encoded: $("#encoded-canvas"), hideModal: $("#hide-modal"), closeModal: $("#close-result-modal"), reopenResult: $("#reopen-result"), downloadToast: $("#download-toast"), payloadSummary: $("#payload-summary"), download: $("#download-link"), decryptionKey: $("#decryption-key"), copyKey: $("#copy-key-button"), keyCopyStatus: $("#key-copy-status"), revealResult: $("#revealed-result"), revealedText: $("#revealed-text"), copy: $("#copy-button"), samplesToggle: $("#samples-toggle"), hideMode: $("#hide-mode"), modeHint: $("#mode-hint"), resultWarning: $("#result-warning"), sampleDrawer: $("#samples-drawer"), closeSamples: $("#close-samples")
};
let hideSource, hideSourceName, revealSource, downloadUrl, outputPendingDownload = false, generatedKey = "", decryptionKeyCopied = false, toastTimer;

const { HEADER_BITS, capacity, embed, extract } = StegoCore;

function formatBytes(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`; }
function outputFileName(name) {
  const extensionAt = name.lastIndexOf(".");
  const base = extensionAt > 0 ? name.slice(0, extensionAt) : name;
  return `${base || "imagem"}_o.png`;
}
function status(el, text = "", error = false) { el.textContent = text; el.classList.toggle("error", error); }
function currentCapacity() { return ui.hideMode.value === "robust" ? RobustStego.capacityBytes(hideSource.width, hideSource.height) : capacity(hideSource); }
function refreshCapacity() { if (!hideSource) return; ui.capacityValue.textContent = formatBytes(currentCapacity()); updateCapacityEstimate(); }
function updateModeHint() {
  ui.modeHint.textContent = ui.hideMode.value === "robust"
    ? "Sobrevive à compressão JPEG de WhatsApp, Telegram e redes sociais. A imagem é reduzida para até 1280 px e a capacidade é menor."
    : "Maior capacidade e nenhuma alteração visível, mas só funciona com o PNG original (envie como arquivo/documento).";
}
function updateButtons() { ui.hideButton.disabled = !hideSource; ui.revealButton.disabled = !(revealSource && ui.revealPassword.value); }
function updateMessageInfo() {
  const text = ui.message.value, bytes = encoder.encode(text).length;
  ui.messageCount.textContent = `${text.length.toLocaleString("pt-BR")} caracteres`; ui.messageSize.textContent = `${formatBytes(bytes)} UTF‑8`;
  updateCapacityEstimate(); updateButtons();
}
function setCapacityUsage(used, max, exact = false) {
  const percent = max ? Math.min(100, used / max * 100) : 0;
  ui.capacityBar.style.width = `${percent}%`; ui.capacityUsage.textContent = `${exact ? "Uso final" : "Uso estimado"}: ${formatBytes(used)} de ${formatBytes(max)}`; ui.capacityPercent.textContent = `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
  ui.capacityDetail.textContent = exact ? "Valor final após compressão e criptografia." : "Estimativa antes da compressão e da criptografia.";
}
function updateCapacityEstimate() {
  if (!hideSource) return;
  const max = currentCapacity(), estimated = encoder.encode(ui.message.value).length + 32;
  setCapacityUsage(estimated, max);
}
function openResultModal() {
  if (!ui.hideModal || !ui.closeModal) return;
  ui.hideModal.hidden = false; ui.hideModal.classList.remove("is-hidden"); document.body.classList.add("has-modal"); ui.closeModal.focus();
}
function closeResultModal() {
  if (!ui.hideModal) return;
  ui.hideModal.hidden = true; ui.hideModal.classList.add("is-hidden"); document.body.classList.remove("has-modal");
  if ((outputPendingDownload || hasUncopiedKey()) && ui.reopenResult) { ui.reopenResult.hidden = false; ui.reopenResult.classList.remove("is-hidden"); }
}
function openSamples() {
  if (!ui.sampleDrawer) return;
  ui.sampleDrawer.classList.add("is-open"); ui.sampleDrawer.setAttribute("aria-hidden", "false"); ui.samplesToggle?.setAttribute("aria-expanded", "true"); ui.closeSamples?.focus();
}
function closeSamples() {
  if (!ui.sampleDrawer) return;
  ui.sampleDrawer.classList.remove("is-open"); ui.sampleDrawer.setAttribute("aria-hidden", "true"); ui.samplesToggle?.setAttribute("aria-expanded", "false"); ui.samplesToggle?.focus();
}
async function selectSample(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error("Não foi possível carregar esta imagem de amostra.");
    const blob = await response.blob(), name = path.split("/").pop() || "sample.jpg";
    await chooseImage([new File([blob], name, { type: blob.type || "image/jpeg" })], "hide");
    activate("hide"); closeSamples();
  } catch (e) { status(ui.hideStatus, e.message || "Não foi possível carregar esta imagem de amostra.", true); }
}
function clearSecretFields() {
  ui.message.value = ""; updateMessageInfo();
}
function showDownloadToast() {
  if (!ui.downloadToast) return;
  clearTimeout(toastTimer); ui.downloadToast.hidden = false; ui.downloadToast.classList.remove("is-hidden");
  toastTimer = setTimeout(() => { ui.downloadToast.hidden = true; ui.downloadToast.classList.add("is-hidden"); }, 10000);
}
function createDecryptionKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const random = crypto.getRandomValues(new Uint8Array(40));
  return Array.from(random, value => alphabet[value % alphabet.length]).join("").match(/.{1,5}/g).join("-");
}
function hasUncopiedKey() { return Boolean(generatedKey && !decryptionKeyCopied); }
function setGeneratedKey(key) {
  generatedKey = key; decryptionKeyCopied = false; ui.decryptionKey.textContent = key;
  ui.copyKey.textContent = "Copiar chave de descriptografia"; ui.copyKey.classList.remove("is-copied"); ui.keyCopyStatus.textContent = "";
}
async function copyText(text) {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const field = document.createElement("textarea"); field.value = text; field.setAttribute("readonly", ""); field.style.position = "fixed"; field.style.opacity = "0"; document.body.append(field); field.select();
  const copied = document.execCommand("copy"); field.remove(); if (!copied) throw new Error("Não foi possível copiar a chave.");
}
async function copyDecryptionKey() {
  if (!generatedKey) return;
  try {
    await copyText(generatedKey); decryptionKeyCopied = true; ui.copyKey.textContent = "Chave copiada"; ui.copyKey.classList.add("is-copied"); ui.keyCopyStatus.textContent = "Copiada para a área de transferência.";
  } catch {
    ui.keyCopyStatus.textContent = "Não foi possível copiar automaticamente. Selecione a chave e copie manualmente.";
  }
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Não foi possível abrir esta imagem neste navegador. Tente convertê-la para PNG ou JPEG.")); image.src = url; });
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb", willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height, { colorSpace: "srgb" });
  } finally { URL.revokeObjectURL(url); }
}
async function chooseImage(files, mode) {
  try {
    const list = Array.from(files || []);
    if (list.length > 1) throw new Error("Envie apenas uma imagem por vez.");
    const [file] = list;
    if (!file) return;
    const image = await loadImage(file);
    if (image.width * image.height * 3 < HEADER_BITS) throw new Error("A imagem é pequena demais para conter um cabeçalho.");
    if (mode === "hide") {
      hideSource = image; hideSourceName = file.name; ui.hideInfo.textContent = file.name; ui.hideMeta.textContent = `${image.width} × ${image.height} px · ${formatBytes(file.size)}`; ui.hideFileCard.hidden = false; ui.hideFileCard.classList.remove("is-hidden");
      ui.capacityBox.classList.remove("is-hidden"); refreshCapacity(); status(ui.hideStatus);
    } else { revealSource = image; ui.revealInfo.textContent = file.name; ui.revealMeta.textContent = `${image.width} × ${image.height} px · ${formatBytes(file.size)}`; ui.revealFileCard.hidden = false; ui.revealFileCard.classList.remove("is-hidden"); status(ui.revealStatus); }
    updateButtons();
  } catch (e) { status(mode === "hide" ? ui.hideStatus : ui.revealStatus, e.message, true); }
}

const ROBUST_AAD = new Uint8Array([0x4f, 0x52, 1]);
async function keyAndIv(password, salt) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, base, 352));
  return { key: await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]), iv: bits.slice(32, 44) };
}
async function embedRobust(image, text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(RobustStego.SALT_BYTES)), { key, iv } = await keyAndIv(password, salt);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ROBUST_AAD }, key, await compress(encoder.encode(text))));
  const max = RobustStego.capacityBytes(image.width, image.height);
  if (encrypted.length > max) throw new Error(`A mensagem protegida ocupa ${formatBytes(encrypted.length)}, mas o modo resistente comporta ${formatBytes(max)} nesta imagem. Use uma imagem maior, encurte o texto ou escolha “Máxima capacidade”.`);
  const result = RobustStego.embed(image, salt, encrypted);
  return { output: new ImageData(result.data, result.width, result.height, { colorSpace: "srgb" }), encryptedLength: encrypted.length, max };
}
async function extractRobust(image, password) {
  const { salt, payload } = RobustStego.extract(image), { key, iv } = await keyAndIv(password, salt);
  try { const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: ROBUST_AAD }, key, payload); return decoder.decode(await decompress(new Uint8Array(plain))); }
  catch { throw new Error("Chave incorreta ou imagem alterada demais (compressão forte, redimensionamento, corte ou filtro)."); }
}
async function extractAny(image, password) {
  let lsbError;
  try { return await extract(image, password); } catch (e) { lsbError = e; }
  try { return await extractRobust(image, password); }
  catch (e) {
    if (e.code !== "NO_ROBUST") throw e;
    if (lsbError.code === "NO_LSB") throw new Error("Nenhuma mensagem encontrada. A imagem pode ter sido redimensionada, cortada ou comprimida demais — ou foi gerada em “Máxima capacidade” e perdeu os dados ao ser reenviada como foto.");
    throw lsbError;
  }
}
function draw(canvas, image) { canvas.width = image.width; canvas.height = image.height; canvas.getContext("2d", { alpha: false, colorSpace: "srgb" }).putImageData(image, 0, 0); }
function png(canvas) { return new Promise(resolve => canvas.toBlob(resolve, "image/png")); }
function setResultWarning(robust) {
  ui.resultWarning.innerHTML = robust
    ? "<strong>Pode enviar como foto.</strong> O modo resistente sobrevive à compressão JPEG de apps de mensagem e redes sociais, mas não a redimensionamento, corte, filtros ou capturas de tela. Quem receber deve enviar a imagem ao site sem editá‑la."
    : "<strong>Use somente o PNG baixado.</strong> Para compartilhá‑lo, envie como arquivo/documento: aplicativos que reenviam como foto, JPEG, WebP, redimensionamento e redes sociais podem destruir a mensagem.";
}
async function hide() {
  try {
    ui.hideButton.disabled = true; status(ui.hideStatus, "Comprimindo e criptografando sua mensagem…");
    const key = createDecryptionKey(), robust = ui.hideMode.value === "robust", source = robust ? RobustStego.fit(hideSource) : hideSource; const result = robust ? await embedRobust(source, ui.message.value, key) : await embed(source, ui.message.value, key); draw(ui.original, source); draw(ui.encoded, result.output); setResultWarning(robust);
    const blob = await png(ui.encoded); if (!blob) throw new Error("Não foi possível gerar o PNG."); if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = URL.createObjectURL(blob); ui.download.href = downloadUrl; ui.download.download = outputFileName(hideSourceName || "imagem");
    setGeneratedKey(key); outputPendingDownload = true; if (ui.reopenResult) { ui.reopenResult.hidden = true; ui.reopenResult.classList.add("is-hidden"); } setCapacityUsage(result.encryptedLength, result.max, true); ui.payloadSummary.textContent = `Payload criptografado: ${formatBytes(result.encryptedLength)} de ${formatBytes(result.max)}.`; status(ui.hideStatus); openResultModal();
  } catch (e) { status(ui.hideStatus, e.message || "Não foi possível esconder a mensagem.", true); } finally { updateButtons(); }
}
async function reveal() {
  try { ui.revealButton.disabled = true; status(ui.revealStatus, "Lendo, verificando e descriptografando…"); const text = await extractAny(revealSource, ui.revealPassword.value); ui.revealedText.textContent = text; ui.revealResult.classList.remove("is-hidden"); status(ui.revealStatus, "Mensagem autenticada e revelada."); }
  catch (e) { ui.revealResult.classList.add("is-hidden"); status(ui.revealStatus, e.message || "Não foi possível revelar a mensagem.", true); } finally { updateButtons(); }
}
function wireDrop(zoneSelector, input, mode) {
  const zone = $(zoneSelector); ["dragenter", "dragover"].forEach(event => zone.addEventListener(event, e => { e.preventDefault(); zone.classList.add("is-dragging"); })); ["dragleave", "drop"].forEach(event => zone.addEventListener(event, e => { e.preventDefault(); zone.classList.remove("is-dragging"); }));
  zone.addEventListener("drop", e => chooseImage(e.dataTransfer.files, mode)); input.addEventListener("change", () => { chooseImage(input.files, mode); input.value = ""; });
}
function activate(mode) {
  const hiding = mode === "hide"; $("#hide-panel").hidden = !hiding; $("#reveal-panel").hidden = hiding; $("#hide-panel").classList.toggle("is-hidden", !hiding); $("#reveal-panel").classList.toggle("is-hidden", hiding); $("#hide-tab").classList.toggle("is-active", hiding); $("#reveal-tab").classList.toggle("is-active", !hiding); $("#hide-tab").setAttribute("aria-selected", hiding); $("#reveal-tab").setAttribute("aria-selected", !hiding);
}
$("#hide-tab").addEventListener("click", () => activate("hide")); $("#reveal-tab").addEventListener("click", () => activate("reveal"));
document.querySelectorAll("[data-toggle-password]").forEach(button => button.addEventListener("click", () => { const input = document.getElementById(button.dataset.togglePassword); input.type = input.type === "password" ? "text" : "password"; button.textContent = input.type === "password" ? "◉" : "◌"; }));
ui.message.addEventListener("input", updateMessageInfo); ui.revealPassword.addEventListener("input", updateButtons); ui.revealPassword.addEventListener("keydown", event => { if (event.key === "Enter" && !ui.revealButton.disabled) { event.preventDefault(); reveal(); } }); ui.hideButton.addEventListener("click", hide); ui.revealButton.addEventListener("click", reveal);
ui.closeModal?.addEventListener("click", closeResultModal); document.querySelector("[data-close-result-modal]")?.addEventListener("click", closeResultModal); ui.reopenResult?.addEventListener("click", () => { ui.reopenResult.hidden = true; ui.reopenResult.classList.add("is-hidden"); openResultModal(); });
ui.samplesToggle?.addEventListener("click", openSamples); ui.closeSamples?.addEventListener("click", closeSamples); document.querySelectorAll("[data-sample]").forEach(button => button.addEventListener("click", () => selectSample(button.dataset.sample)));
ui.download.addEventListener("click", () => { outputPendingDownload = false; if (ui.reopenResult) { ui.reopenResult.hidden = true; ui.reopenResult.classList.add("is-hidden"); } ui.payloadSummary.textContent = ""; clearSecretFields(); showDownloadToast(); });
document.addEventListener("keydown", event => { if (event.key !== "Escape") return; if (ui.sampleDrawer?.classList.contains("is-open")) { closeSamples(); return; } if (ui.hideModal && !ui.hideModal.hidden) closeResultModal(); });
ui.copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(ui.revealedText.textContent); ui.copy.textContent = "Copiado"; setTimeout(() => ui.copy.textContent = "Copiar texto", 1400); } catch { ui.copy.textContent = "Copie manualmente"; } });
ui.copyKey.addEventListener("click", copyDecryptionKey);
window.addEventListener("beforeunload", event => { if (!hasUncopiedKey()) return; event.preventDefault(); event.returnValue = ""; });
ui.hideMode.addEventListener("change", () => { updateModeHint(); refreshCapacity(); }); updateModeHint(); wireDrop("#hide-drop-zone", ui.hideImage, "hide"); wireDrop("#reveal-drop-zone", ui.revealImage, "reveal"); updateMessageInfo();
