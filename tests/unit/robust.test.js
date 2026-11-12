import { describe, expect, it } from "vitest";
import RobustStego from "../../robust.js";

function image(width = 256, height = 256) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = (i / 4) % 256; data[i + 1] = (i / 9) % 256; data[i + 2] = (i / 17) % 256; data[i + 3] = 255; }
  return { data, width, height };
}

describe("modo resistente", () => {
  it("ajusta dimensões ao limite e em blocos de 8", () => {
    expect(RobustStego.fittedSize(3000, 1000)).toEqual({ width: 1280, height: 424 });
    expect(RobustStego.fittedSize(7, 7)).toEqual({ width: 8, height: 8 });
  });

  it("embute e extrai salt e payload", () => {
    const source = image(), salt = new Uint8Array(RobustStego.SALT_BYTES).fill(9), payload = new TextEncoder().encode("payload secreto");
    const encoded = RobustStego.embed(source, salt, payload);
    const decoded = RobustStego.extract(encoded);
    expect(decoded.salt).toEqual(salt);
    expect(decoded.payload).toEqual(payload);
    expect(source.data).not.toEqual(encoded.data);
  });

  it("rejeita imagem sem cabeçalho e entradas inválidas", () => {
    expect(() => RobustStego.extract(image())).toThrow(/Sem mensagem/);
    expect(() => RobustStego.embed(image(), new Uint8Array(1), new Uint8Array(1))).toThrow("Salt inválido");
    expect(() => RobustStego.embed({ ...image(), width: 255 }, new Uint8Array(16), new Uint8Array(1))).toThrow("múltiplas de 8");
  });

  it("informa capacidade nula para imagens pequenas", () => {
    expect(RobustStego.capacityBytes(8, 8)).toBe(0);
  });
});
