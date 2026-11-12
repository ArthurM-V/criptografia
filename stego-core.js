"use strict";

(function (root) {
  const MAGIC = new Uint8Array([0x4f, 0x43, 0x55, 0x4c]);
  const VERSION = 1;
  const SALT_BYTES = 16, IV_BYTES = 12, HEADER_BYTES = 4 + 1 + SALT_BYTES + IV_BYTES + 4;
  const HEADER_BITS = HEADER_BYTES * 8, PBKDF2_ITERATIONS = 600000;
  const encoder = new TextEncoder(), decoder = new TextDecoder();

  function formatBytes(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`; }
  function capacity(image) { return Math.floor((image.width * image.height * 3 - HEADER_BITS) / 8); }
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
  async function compress(bytes) {
    if (!("CompressionStream" in root)) throw new Error("Navegador sem suporte a CompressionStream. Use uma versão recente de Chrome, Edge, Firefox ou Safari.");
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new root.CompressionStream("deflate"))).arrayBuffer());
  }
  async function decompress(bytes) {
    if (!("DecompressionStream" in root)) throw new Error("Navegador sem suporte à descompressão.");
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new root.DecompressionStream("deflate"))).arrayBuffer());
  }
  function copyImage(image) {
    const data = new Uint8ClampedArray(image.data);
    return typeof root.ImageData === "function" ? new root.ImageData(data, image.width, image.height, { colorSpace: "srgb" }) : { data, width: image.width, height: image.height };
  }
  async function embed(image, text, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)), iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new Uint8Array([...MAGIC, VERSION]) }, await keyFrom(password, salt), await compress(encoder.encode(text))));
    const max = capacity(image); if (encrypted.length > max) throw new Error(`A mensagem protegida ocupa ${formatBytes(encrypted.length)}, mas a imagem comporta ${formatBytes(max)}.`);
    const output = copyImage(image);
    const header = new Uint8Array(HEADER_BYTES); header.set(MAGIC); header[4] = VERSION; header.set(salt, 5); header.set(iv, 5 + SALT_BYTES); header.set(u32(encrypted.length), 5 + SALT_BYTES + IV_BYTES);
    let i = 0; eachBit(header, bit => setBit(output.data, i++, bit)); const index = await permutation(password, salt, image.width * image.height * 3 - HEADER_BITS); i = 0; eachBit(encrypted, bit => setBit(output.data, index(i++), bit));
    return { output, encryptedLength: encrypted.length, max };
  }
  async function extract(image, password) {
    const pixels = image.width * image.height * 3; if (pixels < HEADER_BITS) throw Object.assign(new Error("Esta imagem não contém uma mensagem do Oculto."), { code: "NO_LSB" });
    const header = readBytes(image.data, HEADER_BYTES, i => i); if (!same(header.slice(0, 4), MAGIC) || header[4] !== VERSION) throw Object.assign(new Error("Imagem sem mensagem compatível ou arquivo alterado."), { code: "NO_LSB" });
    const salt = header.slice(5, 5 + SALT_BYTES), iv = header.slice(5 + SALT_BYTES, 5 + SALT_BYTES + IV_BYTES), length = fromU32(header, 5 + SALT_BYTES + IV_BYTES);
    if (length < 17 || length > capacity(image)) throw new Error("Cabeçalho inválido ou imagem corrompida.");
    const index = await permutation(password, salt, pixels - HEADER_BITS), encrypted = readBytes(image.data, length, index);
    try { const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new Uint8Array([...MAGIC, VERSION]) }, await keyFrom(password, salt), encrypted); return decoder.decode(await decompress(new Uint8Array(plain))); }
    catch { throw new Error("Chave incorreta ou imagem sem mensagem íntegra."); }
  }

  const api = { HEADER_BITS, PBKDF2_ITERATIONS, capacity, u32, fromU32, permutation, compress, decompress, embed, extract };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.StegoCore = api;
})(typeof window !== "undefined" ? window : globalThis);
