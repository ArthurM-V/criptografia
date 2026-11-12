import { expect, test } from "@playwright/test";

test("mantém os controles desabilitados até receber os dados necessários", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#hide-button")).toBeDisabled();
  await page.getByRole("button", { name: "Ver imagens de amostra" }).click();
  await expect(page.locator("#samples-drawer")).toHaveAttribute("aria-hidden", "false");
  await page.getByRole("button", { name: "Fechar amostras" }).click();
  await expect(page.locator("#samples-drawer")).toHaveAttribute("aria-hidden", "true");
  await page.getByRole("tab", { name: "Revelar mensagem" }).click();
  await expect(page.locator("#reveal-button")).toBeDisabled();
});

test("esconde e revela uma mensagem no modo de máxima capacidade", async ({ page }) => {
  await page.goto("/");
  await page.locator("#hide-mode").selectOption("lossless");
  await page.locator("#hide-image").setInputFiles("images/sample_1.jpg");
  await expect(page.locator("#hide-button")).toBeEnabled();
  await page.locator("#message").fill("Mensagem automatizada: Olá 🔐");
  await page.locator("#hide-button").click();
  await expect(page.locator("#hide-modal")).toBeVisible();
  const key = await page.locator("#decryption-key").textContent();
  const png = await page.locator("#encoded-canvas").evaluate((canvas) => canvas.toDataURL("image/png").split(",")[1]);

  await page.locator("#close-result-modal").click();
  await page.getByRole("tab", { name: "Revelar mensagem" }).click();
  await page.locator("#reveal-image").setInputFiles({ name: "oculto.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.locator("#reveal-password").fill(key || "");
  await page.locator("#reveal-button").click();
  await expect(page.locator("#revealed-text")).toHaveText("Mensagem automatizada: Olá 🔐");
  await expect(page.locator("#reveal-status")).toContainText("autenticada");
});
