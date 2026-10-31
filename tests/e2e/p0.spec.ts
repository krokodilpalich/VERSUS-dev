import {
  test,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { createHmac, createHash } from "node:crypto";
import sharp from "sharp";
import { setTimeout } from "node:timers/promises";
import AxeBuilder from "@axe-core/playwright";
const origin = "http://localhost:3000";
const demoId = (key: string) => {
  const h = createHash("sha256")
    .update("VERSUS_DEMO_" + key)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
function otp() {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")
      .update(b)
      .digest(),
    o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
async function post(
  api: APIRequestContext,
  path: string,
  body: unknown = {},
  idempotent = false,
) {
  const key = idempotent ? crypto.randomUUID() : undefined;
  let response = await api.post(path, {
    headers: { Origin: origin, ...(key ? { "Idempotency-Key": key } : {}) },
    data: body,
  });
  for (let attempt = 0; response.status() === 429 && attempt < 4; attempt++) {
    // Respect the real auth limiter; never disable it or spoof client IPs in E2E.
    const delay = Math.min(
      61,
      Math.max(1, Number(response.headers()["retry-after"]) || 11),
    );
    await setTimeout(delay * 1000 + 100);
    response = await api.post(path, {
      headers: { Origin: origin, ...(key ? { "Idempotency-Key": key } : {}) },
      data: body,
    });
  }
  const json = await response.json();
  expect(response.ok(), `${path}: ${JSON.stringify(json)}`).toBe(true);
  return json.data ?? json;
}
async function login(context: BrowserContext, key: string) {
  const r = await post(context.request, "/api/auth/sign-in/email", {
    email: `${key}@versus.local`,
    password: "Versus-Demo-2026!",
  });
  if (r.twoFactorRedirect)
    await post(context.request, "/api/auth/two-factor/verify-totp", {
      code: otp(),
      trustDevice: false,
    });
}
async function mail(api: APIRequestContext, email: string, subject: string) {
  let id = "";
  await expect
    .poll(
      async () => {
        const r = await api.get("http://localhost:8025/api/v1/messages");
        const data = await r.json();
        const m = data.messages.find(
          (m: {
            ID: string;
            Created: string;
            To: { Address: string }[];
            Subject: string;
          }) =>
            m.To.some((t) => t.Address === email) &&
            m.Subject.includes(subject) &&
            new Date(m.Created).getTime() >= runId,
        );
        id = m?.ID;
        return !!id;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  const r = await api.get(`http://localhost:8025/api/v1/message/${id}`);
  return (await r.json()).Text as string;
}
let workId = "",
  workSlug = "",
  listingId = "",
  inquiryId = "",
  dealId = "",
  privateCollectionId = "";
const runId = Date.now();
const email = `artist-e2e-${runId}@versus.local`;
const workTitle = "DEMO E2E Работа " + runId;
const password = "Versus-E2E-2026!";
test.describe
  .serial("five P0 journeys through real HTTP/PostgreSQL/S3/SMTP", () => {
  test("1 · register, verify local email, author/series/upload, moderate and publish", async ({
    page,
    browser,
  }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Как к вам обращаться").fill("DEMO E2E Автор");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    await expect(page.getByRole("status")).toContainText("Аккаунт создан");
    const text = await mail(page.request, email, "подтвердите");
    const url = text.match(/https?:\/\/[^\s]+/)![0];
    await page.request.get(url);
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/dashboard/);
    await post(page.request, "/api/v1/onboarding", {
      displayName: "DEMO E2E Автор",
      roles: ["ARTIST"],
    });
    await post(page.request, "/api/v1/artists", {
      name: "DEMO E2E Автор",
      biography: "Вымышленный автор для сквозной проверки.",
      statement: "Оригинальные абстрактные тестовые композиции.",
      city: "Демо",
    });
    const series = await post(page.request, "/api/v1/series", {
      title: "DEMO E2E Серия",
      statement: "Демонстрационная серия исследования света и пространства.",
      yearStart: 2026,
    });
    const w = await post(page.request, "/api/v1/artworks", {
      title: workTitle,
      seriesId: series.id,
      captureYear: 2026,
      description:
        "Оригинальная демонстрационная композиция для сквозного тестирования.",
      genre: "Абстракция",
      colorMode: "BW",
      visibility: "PUBLIC",
      technique: "Пигментная печать",
      paper: "Хлопковая бумага",
      width: 300,
      height: 400,
      editionType: "LIMITED",
      editionTotal: 3,
      printYear: 2026,
      signed: true,
      rightsAccepted: true,
    });
    workId = w.id;
    workSlug = w.slug;
    await page.goto(`/dashboard/artworks/${workId}/edit`);
    const image = await sharp({
      create: { width: 500, height: 700, channels: 3, background: "#8e8b7c" },
    })
      .png()
      .toBuffer();
    await page.locator("input[type=file]").setInputFiles({
      name: "demo.png",
      mimeType: "image/png",
      buffer: image,
    });
    await page
      .getByLabel("Описание для доступности")
      .fill("DEMO абстрактная плоскость");
    await page.getByLabel("Правообладатель").fill("DEMO E2E Автор");
    await page.getByRole("button", { name: "Загрузить изображение" }).click();
    await expect(page.getByRole("status")).toContainText("сохранены");
    await page.getByRole("button", { name: "Отправить на модерацию" }).click();
    await expect(page).toHaveURL("/dashboard/portfolio");
    const admin = await browser.newContext();
    await login(admin, "admin");
    const ap = await admin.newPage();
    await ap.goto("/admin/artworks");
    const section = ap.locator("section").filter({
      has: ap.getByRole("heading", { name: workTitle, exact: true }),
    });
    await section
      .getByLabel("Обоснование решения")
      .fill("DEMO — права и полнота описания проверены для публикации.");
    await section
      .getByRole("button", { name: "Зафиксировать решение" })
      .click();
    await expect
      .poll(async () => {
        const r = await admin.request.get(`/api/v1/artworks/${workId}`);
        return (await r.json()).data.editorialStatus;
      })
      .toBe("PUBLISHED");
    const dossier = await (
      await page.request.get(`/api/v1/artworks/${workId}`)
    ).json();
    listingId = (
      await post(page.request, "/api/v1/listings", {
        copyId: dossier.data.copies[0].id,
        priceMode: "FIXED_PRICE",
        priceMinor: 2500000,
        rightsEvidence: "DEMO — автор обладает правами на тестовую композицию",
      })
    ).id;
    await page.goto(`/works/${workSlug}`);
    await expect(
      page.getByRole("heading", { name: workTitle, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".dossier-image img")).toBeVisible();
    await admin.close();
  });
  test("2 · collector search, private inquiry, operator reply and immutable offer", async ({
    page,
    browser,
  }) => {
    await login(page.context(), "collector4");
    await page.goto("/works");
    await page.getByLabel("Поиск", { exact: true }).fill(workTitle);
    await page.getByRole("button", { name: "Найти", exact: true }).click();
    await page.locator(".work-card").filter({ hasText: workTitle }).click();
    await page
      .getByLabel("Ваш запрос")
      .fill(
        "Прошу подтвердить условия и наличие этого демонстрационного отпечатка.",
      );
    await page
      .getByRole("button", { name: "Уточнить условия", exact: true })
      .click();
    await expect(page.getByRole("status").first()).toContainText("сохранены");
    const list = await (await page.request.get("/api/v1/me/inquiries")).json();
    inquiryId = list.data[0].id;
    const operator = await browser.newContext();
    await login(operator, "operator");
    const op = await operator.newPage();
    await op.goto(`/dashboard/inquiries/${inquiryId}`);
    await op
      .getByLabel("Сообщение", { exact: true })
      .fill(
        "Наличие подтверждено для демонстрационного сценария. Подготовим оферту.",
      );
    await op.getByRole("button", { name: "Отправить сообщение" }).click();
    await expect(op.getByRole("status")).toContainText("сохранены");
    await post(operator.request, `/api/v1/inquiries/${inquiryId}/offers`, {
      amountMinor: 2500000,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      terms:
        "DEMO — доставка согласуется отдельно. Комиссия по демонстрационной политике.",
      commissionPolicyId: demoId("policy"),
    });
    const stranger = await browser.newContext();
    await login(stranger, "collector5");
    expect(
      (await stranger.request.get(`/api/v1/inquiries/${inquiryId}`)).status(),
    ).toBe(404);
    await stranger.close();
    await operator.close();
  });
  test("3 · accept offer, block competing reserve, offline verification and sold copy", async ({
    page,
    browser,
  }) => {
    await login(page.context(), "collector4");
    await page.goto(`/dashboard/inquiries/${inquiryId}`);
    await page
      .getByRole("button", { name: "Принять оферту и зарезервировать" })
      .click();
    await expect(page.getByRole("status")).toContainText("сохранены");
    const i = await (
      await page.request.get(`/api/v1/inquiries/${inquiryId}`)
    ).json();
    dealId = i.data.deals[0].id;
    const other = await browser.newContext();
    await login(other, "collector5");
    const conflict = await other.request.post("/api/v1/reservations", {
      headers: { Origin: origin, "Idempotency-Key": crypto.randomUUID() },
      data: { listingId },
    });
    expect(conflict.status()).toBe(409);
    await other.close();
    const operator = await browser.newContext();
    await login(operator, "operator");
    await post(operator.request, `/api/v1/deals/${dealId}/request-completion`, {
      evidence: "DEMO — передача отпечатка и офлайн-акт проверяются.",
    });
    const op = await operator.newPage();
    await op.goto("/admin/deals");
    const record = op
      .locator("section")
      .filter({ hasText: "OFFLINE_COMPLETION_PENDING_VERIFICATION" })
      .first();
    await record
      .getByLabel(
        "Основание подтверждения / ID проверенного закрытого документа",
      )
      .fill(
        "DEMO — тестовый акт передачи подтверждён операционным сотрудником.",
      );
    await record
      .getByRole("button", { name: "Подтвердить офлайн-завершение" })
      .click();
    await expect
      .poll(async () => {
        const r = await page.request.get(`/api/v1/inquiries/${inquiryId}`);
        return (await r.json()).data.deals[0].status;
      })
      .toBe("OFFLINE_CONFIRMED");
    await page.reload();
    await expect(
      page.getByText("OFFLINE_CONFIRMED", { exact: false }),
    ).toBeVisible();
    const work = await (
      await page.request.get(`/api/v1/artworks/${workId}`)
    ).json();
    expect(work.data.copies[0].status).toBe("SOLD");
    await operator.close();
  });
  test("4 · admin hosts call, artist submits, receipt, late/external rejection", async ({
    page,
    browser,
  }) => {
    const admin = await browser.newContext();
    await login(admin, "admin");
    const c = await post(admin.request, "/api/v1/admin/open-calls", {
      title: "DEMO E2E Open Call",
      organizerName: "DEMO редакция",
      sourceType: "VERSUS_HOSTED",
      sourceUrl: null,
      description: "Демонстрационный конкурс для сквозного сценария.",
      requirements: "Только собственные авторские работы.",
      eligibility: "Совершеннолетние авторы в demo-среде.",
      startsAt: new Date(Date.now() - 3600000).toISOString(),
      deadlineAt: new Date(Date.now() + 3600000).toISOString(),
      timezone: "Europe/Moscow",
      maxWorks: 5,
      feeMinor: 0,
      isDemo: true,
    });
    await post(page.request, "/api/auth/sign-in/email", { email, password });
    await page.goto(`/open-calls/${c.slug}`);
    await page
      .getByLabel("Описание проекта / statement")
      .fill(
        "Оригинальный демонстрационный проект, исследующий свет и пространство.",
      );
    await page.getByLabel("Ваши работы").selectOption(workId);
    await page.getByLabel("Принимаю правила конкурса").check();
    await page.getByLabel("Согласен на передачу данных организатору").check();
    await page.getByRole("button", { name: "Подать заявку" }).click();
    await expect(page.getByRole("status")).toContainText("Квитанция");
    const closed = await page.request.post(
      `/api/v1/open-calls/${demoId("call2")}/applications`,
      {
        headers: { Origin: origin },
        data: {
          statement: "Демонстрационная попытка подачи после срока.",
          workIds: [workId],
          rulesAccepted: true,
          dataConsent: true,
        },
      },
    );
    expect(closed.status()).toBe(409);
    await page.goto("/open-calls/demo-call-3");
    await expect(
      page.getByRole("link", { name: "Перейти к организатору" }),
    ).toHaveAttribute("href", "https://example.com");
    await expect(
      page.getByRole("button", { name: "Подать заявку" }),
    ).toHaveCount(0);
    await admin.close();
  });
  test("5 · private collection, email-bound invite, unauthorized denial, immediate revoke", async ({
    page,
    browser,
  }) => {
    const admin = await browser.newContext();
    await login(admin, "admin");
    const c = await post(admin.request, "/api/v1/admin/collections", {
      title: "DEMO E2E Private selection",
      description: "Закрытая демонстрационная подборка для проверки доступа.",
      visibility: "INVITED_ONLY",
      workIds: [demoId("work30")],
    });
    privateCollectionId = c.id;
    await post(admin.request, "/api/v1/admin/invitations", {
      email: "collector6@versus.local",
    });
    const text = await mail(
      page.request,
      "collector6@versus.local",
      "приглашение",
    );
    const invite = text.match(/https?:\/\/[^\s]+/)![0];
    await login(page.context(), "collector6");
    await page.goto(invite);
    await page.getByRole("button", { name: "Принять приглашение" }).click();
    await expect(page).toHaveURL("/private");
    await page
      .locator(`a[href="/private/collections/${privateCollectionId}"]`)
      .click();
    await expect(
      page.getByRole("heading", { name: "DEMO E2E Private selection" }),
    ).toBeVisible();
    const visitor = await browser.newContext();
    const denied = await visitor.request.get(
      `/api/v1/private/collections/${privateCollectionId}`,
    );
    expect(denied.status()).toBe(401);
    await login(visitor, "collector7");
    expect(
      (
        await visitor.request.get(
          `/api/v1/private/collections/${privateCollectionId}`,
        )
      ).status(),
    ).toBe(404);
    const users = await (await admin.request.get("/api/v1/admin/users")).json();
    const user = users.data.find(
      (u: { email: string }) => u.email === "collector6@versus.local",
    );
    await post(admin.request, "/api/v1/admin/memberships/revoke", {
      userId: user.id,
      reason: "DEMO — проверка немедленного отзыва private-доступа.",
    });
    expect(
      (
        await page.request.get(
          `/api/v1/private/collections/${privateCollectionId}`,
        )
      ).status(),
    ).toBe(404);
    const sitemap = await (await visitor.request.get("/sitemap.xml")).text();
    expect(sitemap).not.toContain("demo-work-30");
    expect(sitemap).not.toContain("Private selection");
    await visitor.close();
    await admin.close();
  });
  test("public desktop/mobile and accessibility smoke", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({
      path: "test-results/home-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/home-mobile.png",
      fullPage: true,
    });
  });
});
