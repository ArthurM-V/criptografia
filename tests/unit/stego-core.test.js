import { describe, expect, it } from "vitest";
import StegoCore from "../../stego-core.js";

function image(width = 160, height = 160) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i / 4) % 251; data[i + 1] = (i / 7) % 251; data[i + 2] = (i / 13) % 251; data[i + 3] = 255;
  }
  return { data, width, height };
}

describe("núcleo LSB", () => {
  it("oculta e recupera texto Unicode sem mudar o objeto original", async () => {
    const source = image(), before = new Uint8ClampedArray(source.data);
    const result = await StegoCore.embed(source, "Olá, mundo! 🔐\n漢字", "chave-de-teste");

    await expect(StegoCore.extract(result.output, "chave-de-teste")).resolves.toBe("Olá, mundo! 🔐\n漢字");
    expect(source.data).toEqual(before);
    expect(result.encryptedLength).toBeGreaterThan(16);
  });

  it("rejeita uma chave incorreta", async () => {
    const result = await StegoCore.embed(image(), "segredo", "chave-certa");
    await expect(StegoCore.extract(result.output, "chave-errada")).rejects.toThrow("Chave incorreta");
  });

  it("detecta cabeçalho ausente e payload corrompido", async () => {
    await expect(StegoCore.extract(image(), "qualquer")).rejects.toMatchObject({ code: "NO_LSB" });
    const result = await StegoCore.embed(image(), "segredo", "chave");
    result.output.data[0] ^= 1;
    await expect(StegoCore.extract(result.output, "chave")).rejects.toMatchObject({ code: "NO_LSB" });
  });

  it("calcula capacidade e serializa inteiros de 32 bits", () => {
    expect(StegoCore.capacity({ width: 1, height: 1 })).toBeLessThan(0);
    for (const value of [0, 1, 65535, 0xffffffff]) expect(StegoCore.fromU32(StegoCore.u32(value), 0)).toBe(value >>> 0);
  });

  it("gera índices de payload únicos e fora do cabeçalho", async () => {
    const index = await StegoCore.permutation("chave", new Uint8Array(16).fill(4), 1000);
    const values = Array.from({ length: 1000 }, (_, i) => index(i));
    expect(new Set(values).size).toBe(1000);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(StegoCore.HEADER_BITS);
  });

  it("recusa payload maior que a imagem", async () => {
    const incompressible = Array.from({ length: 300 }, (_, i) => String.fromCharCode(33 + ((i * 73) % 90))).join("");
    await expect(StegoCore.embed(image(16, 16), incompressible, "chave")).rejects.toThrow("imagem comporta");
  });
});
