"use strict";
// Modo resistente a compartilhamento: embute bits no domínio da DCT 8×8 (mesmo domínio do JPEG)
// usando QIM + repetição com decodificação suave. Sobrevive a recompressão JPEG moderada
// (WhatsApp, Telegram, Instagram…) desde que a imagem NÃO seja redimensionada/cortada.
(function (root) {
  const DELTA = 36;                 // passo do QIM: maior = mais resistente, mais visível
  const MAX_SIDE = 1280;            // lado maior da saída (abaixo do limite dos apps → sem redimensionamento)
  const HEADER_REPEAT = 15, MIN_REPEAT = 5, MAX_REPEAT = 40;
  const SALT_BYTES = 16, HEADER_BYTES = 2 + 2 + SALT_BYTES + 1; // magia, tamanho, salt, CRC8
  const MAGIC = [0x4f, 0x52];       // "OR"
  const COEFS = [[1, 1], [0, 2], [2, 0], [1, 2], [2, 1], [2, 2], [0, 3], [3, 0]]; // [vertical, horizontal]
  const K = COEFS.length, HEADER_BITS = HEADER_BYTES * 8;

  const C = Array.from({ length: 8 }, (_, u) => Array.from({ length: 8 }, (_, x) => (u ? 0.5 : Math.SQRT1_2 / 2) * Math.cos((2 * x + 1) * u * Math.PI / 16)));
  const BASIS = COEFS.map(([u, v]) => { const b = new Float64Array(64); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b[y * 8 + x] = C[u][y] * C[v][x]; return b; });

  function fittedSize(w, h) {
    const s = Math.min(1, MAX_SIDE / Math.max(w, h));
    return { width: Math.max(8, Math.floor(w * s / 8) * 8), height: Math.max(8, Math.floor(h * s / 8) * 8) };
  }
  function cellsFor(w, h) { return Math.floor(w / 8) * Math.floor(h / 8) * K; }
  function capacityBytes(w, h) {
    const f = fittedSize(w, h), avail = cellsFor(f.width, f.height) - HEADER_BITS * HEADER_REPEAT;
    return Math.max(0, Math.min(65535, Math.floor(avail / MIN_REPEAT / 8)));
  }
  // Redimensiona (se preciso) e corta para múltiplos de 8, devolvendo ImageData. Só no navegador.
  function fit(image) {
    const { width, height } = fittedSize(image.width, image.height);
    const src = document.createElement("canvas"); src.width = image.width; src.height = image.height;
    src.getContext("2d", { colorSpace: "srgb" }).putImageData(image, 0, 0);
    const dst = document.createElement("canvas"); dst.width = width; dst.height = height;
    const ctx = dst.getContext("2d", { alpha: false, colorSpace: "srgb", willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, image.width, image.height, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height, { colorSpace: "srgb" });
  }
  function crc8(bytes) { let c = 0; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 128 ? ((c << 1) ^ 7) & 255 : (c << 1) & 255; } return c; }

  function layout(total) {
    const hdrCells = HEADER_BITS * HEADER_REPEAT, hdr = new Int32Array(hdrCells), taken = new Uint8Array(total);
    for (let i = 0; i < hdrCells; i++) { hdr[i] = Math.floor(i * total / hdrCells); taken[hdr[i]] = 1; }
    const rest = new Int32Array(total - hdrCells); let n = 0;
    for (let i = 0; i < total; i++) if (!taken[i]) rest[n++] = i;
    return { hdr, rest };
  }
  function repeatFor(avail, bits) { return Math.min(MAX_REPEAT, Math.floor(avail / bits)); }
  function bitsOf(bytes) { const out = new Uint8Array(bytes.length * 8); for (let i = 0; i < out.length; i++) out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1; return out; }
  function lumaBlock(data, width, bx, by, out) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = ((by * 8 + y) * width + bx * 8 + x) * 4; out[y * 8 + x] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]; }
  }
  function coef(block, k) { const b = BASIS[k]; let s = 0; for (let i = 0; i < 64; i++) s += block[i] * b[i]; return s; }
  function qim(c, bit) { return bit ? (Math.round(c / DELTA - 0.5) + 0.5) * DELTA : Math.round(c / DELTA) * DELTA; }
  function soft(c) { const v = c / DELTA; return Math.abs(v - Math.round(v)) - Math.abs(v - (Math.round(v - 0.5) + 0.5)); } // >0 → bit 1

  // image: {data(RGBA), width, height}, já ajustada com fit(). Devolve uma cópia modificada.
  function embed(image, salt, payload) {
    if (salt.length !== SALT_BYTES) throw new Error("Salt inválido.");
    if (payload.length > 65535) throw new Error("Mensagem grande demais para o modo resistente.");
    const { width, height } = image, bw = width >> 3, bh = height >> 3, total = bw * bh * K;
    if (width % 8 || height % 8) throw new Error("A imagem precisa ter dimensões múltiplas de 8.");
    const head = new Uint8Array(HEADER_BYTES); head.set(MAGIC); head[2] = payload.length >> 8; head[3] = payload.length & 255; head.set(salt, 4); head[HEADER_BYTES - 1] = crc8(head.subarray(0, HEADER_BYTES - 1));
    const { hdr, rest } = layout(total), bitForCell = new Int8Array(total).fill(-1);
    const hb = bitsOf(head); for (let t = 0; t < HEADER_REPEAT; t++) for (let j = 0; j < HEADER_BITS; j++) bitForCell[hdr[t * HEADER_BITS + j]] = hb[j];
    const pb = bitsOf(payload), R = repeatFor(rest.length, pb.length);
    if (R < MIN_REPEAT) throw new Error(`A mensagem protegida ocupa ${payload.length} B, mas o modo resistente comporta ${capacityBytes(width, height)} B nesta imagem.`);
    const used = pb.length * R; for (let k = 0; k < used; k++) bitForCell[rest[Math.floor(k * rest.length / used)]] = pb[k % pb.length];
    const out = new Uint8ClampedArray(image.data), block = new Float64Array(64), delta = new Float64Array(64);
    for (let by_ = 0; by_ < bh; by_++) for (let bx = 0; bx < bw; bx++) {
      const base = (by_ * bw + bx) * K; let any = false; for (let k = 0; k < K; k++) if (bitForCell[base + k] >= 0) { any = true; break; }
      if (!any) continue;
      lumaBlock(image.data, width, bx, by_, block); delta.fill(0);
      for (let k = 0; k < K; k++) { const bit = bitForCell[base + k]; if (bit < 0) continue; const c = coef(block, k), d = qim(c, bit) - c, b = BASIS[k]; for (let i = 0; i < 64; i++) delta[i] += d * b[i]; }
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = ((by_ * 8 + y) * width + bx * 8 + x) * 4, d = delta[y * 8 + x]; out[p] = Math.round(image.data[p] + d); out[p + 1] = Math.round(image.data[p + 1] + d); out[p + 2] = Math.round(image.data[p + 2] + d); }
    }
    return { data: out, width, height, payloadBytes: payload.length, repeat: R, max: capacityBytes(width, height) };
  }
  // Devolve { salt, payload } ou lança Error com code "NO_ROBUST" se não houver cabeçalho válido.
  function extract(image) {
    const { width, height } = image, bw = width >> 3, bh = height >> 3, total = bw * bh * K, notFound = () => Object.assign(new Error("Sem mensagem do modo resistente."), { code: "NO_ROBUST" });
    if (total <= HEADER_BITS * HEADER_REPEAT) throw notFound();
    const { hdr, rest } = layout(total), cache = new Float64Array(total).fill(NaN), block = new Float64Array(64);
    const cell = (i) => { if (!Number.isNaN(cache[i])) return cache[i]; const blk = Math.floor(i / K), k = i % K; lumaBlock(image.data, width, blk % bw, Math.floor(blk / bw), block); return (cache[i] = soft(coef(block, k))); };
    const readBits = (cells, bits, repeat) => { const out = new Uint8Array(bits); for (let j = 0; j < bits; j++) { let s = 0; for (let t = 0; t < repeat; t++) s += cell(cells(t * bits + j)); out[j] = s > 0 ? 1 : 0; } return out; };
    const toBytes = (bits) => { const out = new Uint8Array(bits.length >> 3); for (let i = 0; i < bits.length; i++) out[i >> 3] = (out[i >> 3] << 1) | bits[i]; return out; };
    const head = toBytes(readBits(i => hdr[i], HEADER_BITS, HEADER_REPEAT));
    if (head[0] !== MAGIC[0] || head[1] !== MAGIC[1] || crc8(head.subarray(0, HEADER_BYTES - 1)) !== head[HEADER_BYTES - 1]) throw notFound();
    const length = (head[2] << 8) | head[3], bits = length * 8, R = repeatFor(rest.length, bits);
    if (!length || R < MIN_REPEAT) throw notFound();
    const used = bits * R, payload = toBytes(readBits(i => rest[Math.floor(i * rest.length / used)], bits, R));
    return { salt: head.slice(4, 4 + SALT_BYTES), payload };
  }
  const api = { fit, fittedSize, capacityBytes, embed, extract, SALT_BYTES };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.RobustStego = api;
})(typeof window !== "undefined" ? window : globalThis);