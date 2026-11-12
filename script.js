"use strict";

// Header stays in the first RGB bits so extraction can find the salt. The encrypted
// payload is spread through a deterministic, password-and-salt-derived permutation.
const MAGIC = new Uint8Array([0x4f, 0x43, 0x55, 0x4c]); // OCUL
const VERSION = 1;
const SALT_BYTES = 16, IV_BYTES = 12, HEADER_BYTES = 4 + 1 + SALT_BYTES + IV_BYTES + 4;
const HEADER_BITS = HEADER_BYTES * 8, PBKDF2_ITERATIONS = 600000;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const $ = (s) => document.querySelector(s);
const ui = {
  hideImage: $("#hide-image"), revealImage: $("#reveal-image"), message: $("#message"), revealPassword: $("#reveal-password"), hideButton: $("#hide-button"), revealButton: $("#reveal-button"), hideStatus: $("#hide-status"), revealStatus: $("#reveal-status"), hideInfo: $("#hide-image-info"), revealInfo: $("#reveal-image-info"), hideMeta: $("#hide-image-meta"), revealMeta: $("#reveal-image-meta"), hideFileCard: $("#hide-file-card"), revealFileCard: $("#reveal-file-card"), capacityBox: $("#capacity-box"), capacityValue: $("#capacity-value"), capacityBar: $("#capacity-bar"), capacityUsage: $("#capacity-usage"), capacityPercent: $("#capacity-percent"), capacityDetail: $("#capacity-detail"), messageCount: $("#message-count"), messageSize: $("#message-size"), original: $("#original-canvas"), encoded: $("#encoded-canvas"), hideModal: $("#hide-modal"), closeModal: $("#close-result-modal"), reopenResult: $("#reopen-result"), downloadToast: $("#download-toast"), payloadSummary: $("#payload-summary"), download: $("#download-link"), decryptionKey: $("#decryption-key"), copyKey: $("#copy-key-button"), keyCopyStatus: $("#key-copy-status"), revealResult: $("#revealed-result"), revealedText: $("#revealed-text"), copy: $("#copy-button"), samplesToggle: $("#samples-toggle"), sampleDrawer: $("#samples-drawer"), closeSamples: $("#close-samples")
};
let hideSource, hideSourceName, revealSource, downloadUrl, outputPendingDownload = false, generatedKey = "", decryptionKeyCopied = false, toastTimer;

function formatBytes(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`; }
function outputFileName(name) {
  const extensionAt = name.lastIndexOf(".");
  const base = extensionAt > 0 ? name.slice(0, extensionAt) : name;
  return `${base || "imagem"}_o.png`;
}
function status(el, text = "", error = false) { el.textContent = text; el.classList.toggle("error", error); }
function capacity(image) { return Math.floor((image.width * image.height * 3 - HEADER_BITS) / 8); }
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
  const max = capacity(hideSource), estimated = encoder.encode(ui.message.value).length + 32;
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
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Não foi possível abrir esta imagem.")); image.src = url; });
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
    if (mode === "reveal" && file.type !== "image/png") throw new Error("Para revelar, use o PNG original gerado pela ferramenta.");
    const image = await loadImage(file);
    if (image.width * image.height * 3 < HEADER_BITS) throw new Error("A imagem é pequena demais para conter um cabeçalho.");
    if (mode === "hide") {
      hideSource = image; hideSourceName = file.name; ui.hideInfo.textContent = file.name; ui.hideMeta.textContent = `${image.width} × ${image.height} px · ${formatBytes(file.size)}`; ui.hideFileCard.hidden = false; ui.hideFileCard.classList.remove("is-hidden");
      const cap = capacity(image); ui.capacityValue.textContent = formatBytes(cap); ui.capacityBox.classList.remove("is-hidden"); updateCapacityEstimate(); status(ui.hideStatus);
    } else { revealSource = image; ui.revealInfo.textContent = file.name; ui.revealMeta.textContent = `${image.width} × ${image.height} px · ${formatBytes(file.size)}`; ui.revealFileCard.hidden = false; ui.revealFileCard.classList.remove("is-hidden"); status(ui.revealStatus); }
    updateButtons();
  } catch (e) { status(mode === "hide" ? ui.hideStatus : ui.revealStatus, e.message, true); }
}

function rgbOffset(i) { return Math.floor(i / 3) * 4 + i % 3; }
function bitAt(data, i) { return data[rgbOffset(i)] & 1; }
function setBit(data, i, bit) { const at = rgbOffset(i); data[at] = (data[at] & 254) | bit; }
function eachBit(bytes, fn) { for (const byte of bytes) for (let shift = 7; shift >= 0; shift--) fn((byte >> shift) & 1); }
function readBytes(data, length, indexAt) { const out = new Uint8Array(length); for (let i = 0; i < length * 8; i++) out[i >> 3] = (out[i >> 3] << 1) | bitAt(data, indexAt(i)); return out; }
function u32(n) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
function fromU32(bytes, at) { return ((bytes[at] * 0x1000000 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]) >>> 0); }
function same(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
async function permutation(password, salt, count) {
  const pw = encoder.encode(password), joined = new Uint8Array(pw.length + salt.length); joined.set(pw); joined.set(salt, pw.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", joined)), view = new DataView(hash.buffer);
  const offset = view.getUint32(0) % count; let step = view.getUint32(4) % (count - 1) + 1;
  while (gcd(step, count) !== 1) step = step === count - 1 ? 1 : step + 1;
  return (i) => HEADER_BITS + ((offset + (i * step) % count) % count);
}
async function keyFrom(password, salt) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function compress(bytes) { if (!("CompressionStream" in window)) throw new Error("Navegador sem suporte a CompressionStream. Use uma versão recente de Chrome, Edge, Firefox ou Safari."); return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer()); }
async function decompress(bytes) { if (!("DecompressionStream" in window)) throw new Error("Navegador sem suporte à descompressão."); return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer()); }

async function embed(image, text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)), iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new Uint8Array([...MAGIC, VERSION]) }, await keyFrom(password, salt), await compress(encoder.encode(text))));
  const max = capacity(image); if (encrypted.length > max) throw new Error(`A mensagem protegida ocupa ${formatBytes(encrypted.length)}, mas a imagem comporta ${formatBytes(max)}.`);
  const output = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height, { colorSpace: "srgb" });
  const header = new Uint8Array(HEADER_BYTES); header.set(MAGIC); header[4] = VERSION; header.set(salt, 5); header.set(iv, 5 + SALT_BYTES); header.set(u32(encrypted.length), 5 + SALT_BYTES + IV_BYTES);
  let i = 0; eachBit(header, bit => setBit(output.data, i++, bit)); const index = await permutation(password, salt, image.width * image.height * 3 - HEADER_BITS); i = 0; eachBit(encrypted, bit => setBit(output.data, index(i++), bit));
  return { output, encryptedLength: encrypted.length, max };
}
async function extract(image, password) {
  const pixels = image.width * image.height * 3; if (pixels < HEADER_BITS) throw new Error("Esta imagem não contém uma mensagem do Oculto.");
  const header = readBytes(image.data, HEADER_BYTES, i => i); if (!same(header.slice(0, 4), MAGIC) || header[4] !== VERSION) throw new Error("Imagem sem mensagem compatível ou arquivo alterado.");
  const salt = header.slice(5, 5 + SALT_BYTES), iv = header.slice(5 + SALT_BYTES, 5 + SALT_BYTES + IV_BYTES), length = fromU32(header, 5 + SALT_BYTES + IV_BYTES);
  if (length < 17 || length > capacity(image)) throw new Error("Cabeçalho inválido ou imagem corrompida.");
  const index = await permutation(password, salt, pixels - HEADER_BITS), encrypted = readBytes(image.data, length, index);
  try { const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new Uint8Array([...MAGIC, VERSION]) }, await keyFrom(password, salt), encrypted); return decoder.decode(await decompress(new Uint8Array(plain))); }
  catch { throw new Error("Chave incorreta ou imagem sem mensagem íntegra."); }
}
function draw(canvas, image) { canvas.width = image.width; canvas.height = image.height; canvas.getContext("2d", { alpha: false, colorSpace: "srgb" }).putImageData(image, 0, 0); }
function png(canvas) { return new Promise(resolve => canvas.toBlob(resolve, "image/png")); }
async function hide() {
  try {
    ui.hideButton.disabled = true; status(ui.hideStatus, "Comprimindo e criptografando sua mensagem…");
    const key = createDecryptionKey(); const result = await embed(hideSource, ui.message.value, key); draw(ui.original, hideSource); draw(ui.encoded, result.output);
    const blob = await png(ui.encoded); if (!blob) throw new Error("Não foi possível gerar o PNG."); if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = URL.createObjectURL(blob); ui.download.href = downloadUrl; ui.download.download = outputFileName(hideSourceName || "imagem");
    setGeneratedKey(key); outputPendingDownload = true; if (ui.reopenResult) { ui.reopenResult.hidden = true; ui.reopenResult.classList.add("is-hidden"); } setCapacityUsage(result.encryptedLength, result.max, true); ui.payloadSummary.textContent = `Payload criptografado: ${formatBytes(result.encryptedLength)} de ${formatBytes(result.max)}.`; status(ui.hideStatus); openResultModal();
  } catch (e) { status(ui.hideStatus, e.message || "Não foi possível esconder a mensagem.", true); } finally { updateButtons(); }
}
async function reveal() {
  try { ui.revealButton.disabled = true; status(ui.revealStatus, "Lendo, verificando e descriptografando…"); const text = await extract(revealSource, ui.revealPassword.value); ui.revealedText.textContent = text; ui.revealResult.classList.remove("is-hidden"); status(ui.revealStatus, "Mensagem autenticada e revelada."); }
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
wireDrop("#hide-drop-zone", ui.hideImage, "hide"); wireDrop("#reveal-drop-zone", ui.revealImage, "reveal"); updateMessageInfo();
