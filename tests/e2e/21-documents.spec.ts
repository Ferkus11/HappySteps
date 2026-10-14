import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { PHONES, expectToast, login, switchContext } from "./helpers";

config({ path: ".env.local", quiet: true });

test.describe.configure({ mode: "serial" });

const db = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 2 });
const RUN = Date.now().toString(36);
const PDF_TITLE = `E2E справка ${RUN}`;
const PHOTO_TITLE = `E2E фото ${RUN}`;
const MED_BOOK = `E2E медкнижка ${RUN}`;
const BIG_SCAN = `E2E скан 6 МБ ${RUN}`;
// 1×1 PNG and a minimal PDF
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");

let alikhan = "";
let misha = "";
let teacherId = "";
let pdfId = "";
let photoId = "";

const day = (offset: number) => {
  const d = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date())}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

test.beforeAll(async () => {
  // Re-runnable: drop documents created by earlier runs of this spec.
  await db.query("delete from child_documents where title like 'E2E %'");
  await db.query("delete from staff_documents where title like 'E2E %'");
  const ch = await db.query("select id, full_name from children where full_name in ('Ахметов Алихан Даниярович', 'Смирнов Миша Олегович')");
  alikhan = ch.rows.find((r) => r.full_name.startsWith("Ахметов")).id;
  misha = ch.rows.find((r) => r.full_name.startsWith("Смирнов")).id;
  teacherId = (await db.query("select id from profiles where phone = $1", [PHONES.teacher])).rows[0].id;
});
test.afterAll(async () => {
  await db.end();
});

async function upload(page: Page, scope: ReturnType<Page["getByTestId"]>, opts: { input: "doc-file" | "doc-camera"; name: string; mime: string; buffer: Buffer; title: string; expires?: string; type?: string }) {
  await scope.getByTestId("doc-upload").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId(opts.input).setInputFiles({ name: opts.name, mimeType: opts.mime, buffer: opts.buffer });
  await expect(dialog.getByTestId("doc-picked")).toContainText(opts.name);
  if (opts.type) await dialog.getByTestId("doc-type").selectOption(opts.type);
  if (opts.expires) await dialog.getByTestId("doc-expires").fill(opts.expires);
  await dialog.getByTestId("doc-title").fill(opts.title);
  await dialog.getByTestId("doc-upload-submit").click();
  await expectToast(page, "Документ загружен");
  await expect(dialog).toBeHidden();
}

test("parent uploads a PDF and a photo into Алихан's medical folder", async ({ page }) => {
  await login(page, PHONES.parent);
  await page.goto("/documents");
  const folder = page.getByTestId(`child-folder-${alikhan}`);
  await expect(folder).toContainText("Ахметов Алихан");
  // the seeded vaccination certificate is there
  await folder.getByTestId("doc-tab-vaccination").click();
  await expect(folder.getByTestId("doc-panel-vaccination")).toContainText("Прививочный сертификат");
  // «Загрузить» takes the open tab as the default section
  await folder.getByTestId("doc-tab-medical").click();
  await upload(page, folder, { input: "doc-file", name: "spravka.pdf", mime: "application/pdf", buffer: PDF, title: PDF_TITLE });
  await upload(page, folder, { input: "doc-camera", name: "photo.png", mime: "image/png", buffer: PNG, title: PHOTO_TITLE });
  const panel = folder.getByTestId("doc-panel-medical");
  await expect(panel).toContainText(PDF_TITLE);
  await expect(panel).toContainText(PHOTO_TITLE);
  // own uploads can be deleted by the parent; the head's/seeded ones are view only for them
  await expect(panel.getByTestId("doc-row").filter({ hasText: PDF_TITLE }).getByTestId("doc-delete")).toBeVisible();
  const rows = await db.query("select id, title, mime, path from child_documents where title in ($1, $2)", [PDF_TITLE, PHOTO_TITLE]);
  pdfId = rows.rows.find((r) => r.title === PDF_TITLE).id;
  photoId = rows.rows.find((r) => r.title === PHOTO_TITLE).id;
  expect(rows.rows.find((r) => r.title === PHOTO_TITLE).mime).toBe("image/png");
  expect(rows.rows.every((r) => r.path.includes(`/${alikhan}/`))).toBe(true);
});

test("teacher of Солнышко sees them read-only; photo opens in a lightbox, PDF via a signed link", async ({ page }) => {
  await login(page, PHONES.teacher);
  await page.goto("/documents");
  await page.getByTestId("group-children").getByTestId(`child-row-${alikhan}`).click();
  await page.waitForURL(`**/documents/child/${alikhan}`);
  const folder = page.getByTestId(`child-folder-${alikhan}`);
  await expect(folder.getByTestId("doc-view-only")).toBeVisible();
  await expect(folder.getByTestId("doc-upload")).toHaveCount(0);
  const panel = folder.getByTestId("doc-panel-medical");
  await expect(panel).toContainText(PDF_TITLE);
  await expect(panel.getByTestId("doc-delete")).toHaveCount(0);
  await panel.getByTestId("doc-row").filter({ hasText: PHOTO_TITLE }).getByTestId("doc-open").click();
  const img = page.getByTestId("doc-lightbox-img");
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  const href = await panel.getByTestId("doc-row").filter({ hasText: PDF_TITLE }).getByTestId("doc-open").getAttribute("href");
  expect(href).toBe(`/documents/file/${pdfId}`);
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  // the child card shows the counts and links to the folder
  await page.goto(`/children/${alikhan}`);
  await expect(page.getByTestId("child-doc-count-medical")).toContainText("2");
});

test("head finds the child, deletes the photo (audited)", async ({ page }) => {
  await login(page, PHONES.head);
  await page.goto("/documents");
  await page.getByTestId("doc-search").fill("Алихан");
  await page.getByTestId("doc-search").press("Enter");
  await page.waitForURL(/q=/);
  await page.getByTestId(`child-row-${alikhan}`).click();
  const folder = page.getByTestId(`child-folder-${alikhan}`);
  await expect(folder.getByTestId("doc-upload")).toBeVisible();
  const row = folder.getByTestId("doc-panel-medical").getByTestId("doc-row").filter({ hasText: PHOTO_TITLE });
  await row.getByTestId("doc-delete").click();
  await page.getByTestId("confirm-ok").click();
  await expectToast(page, "Документ удалён");
  await expect(folder.getByTestId("doc-panel-medical")).not.toContainText(PHOTO_TITLE);
  const a = await db.query("select details from audit_log where action = 'document.delete' and entity_id = $1", [photoId]);
  expect(a.rows[0].details).toMatchObject({ title: PHOTO_TITLE, category: "medical" });
  await page.goto("/audit");
  await expect(page.getByText("Удалён документ").first()).toBeVisible();
  // Details are translated sentences: the title, the category's name, the child — never ids, keys or JSON.
  const auditRow = page.getByTestId("audit-row").filter({ hasText: PHOTO_TITLE }).first();
  await expect(auditRow.getByTestId("audit-detail")).toContainText(`«${PHOTO_TITLE}» · Медицинские справки · Ахметов Алихан`);
  const details = await page.getByTestId("audit-detail").allInnerTexts();
  expect(details.filter((d) => /[0-9a-f]{8}-[0-9a-f]{4}-|\bnull\b|\b[a-z_]+: /.test(d))).toEqual([]);
});

test("other parents and the Звёздочки teacher cannot open the folder (UI, URL, file link, forged upload)", async ({ page }) => {
  await login(page, PHONES.teacherParent);
  if (!(await page.getByTestId("account-menu").innerText()).includes("Родитель")) await switchContext(page, "Happy Steps E2E", "Родитель");
  await page.goto("/documents");
  await expect(page.getByTestId(`child-folder-${misha}`)).toBeVisible();
  await expect(page.getByTestId(`child-folder-${alikhan}`)).toHaveCount(0);
  expect((await page.goto(`/documents/child/${alikhan}`))?.status()).toBe(404);
  expect((await page.request.get(`/documents/file/${pdfId}`, { maxRedirects: 0 })).status()).toBe(404);
  // forged upload: point the form at Алихан
  await page.goto("/documents");
  const folder = page.getByTestId(`child-folder-${misha}`);
  await folder.getByTestId("doc-upload").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("doc-file").setInputFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: PDF });
  await dialog.getByTestId("doc-title").fill(`E2E подделка ${RUN}`);
  await dialog.locator('input[name="childId"]').evaluate((el: HTMLInputElement, id) => (el.value = id), alikhan);
  await dialog.getByTestId("doc-upload-submit").click();
  await expectToast(page, "Недостаточно прав");
  expect((await db.query("select count(*)::int as n from child_documents where title = $1", [`E2E подделка ${RUN}`])).rows[0].n).toBe(0);
  await page.keyboard.press("Escape");
  // as the teacher of Звёздочки: no Алихан in the list, folder is 404
  await switchContext(page, "Happy Steps E2E", "Воспитатель");
  await page.goto("/documents");
  await expect(page.getByTestId(`child-row-${alikhan}`)).toHaveCount(0);
  expect((await page.goto(`/documents/child/${alikhan}`))?.status()).toBe(404);
});

test("parentB (other garden) sees nothing of garden A", async ({ page }) => {
  await login(page, PHONES.parentB);
  await page.goto("/documents");
  await expect(page.getByText("Ахметов Алихан")).toHaveCount(0);
  expect((await page.goto(`/documents/child/${alikhan}`))?.status()).toBe(404);
  expect((await page.request.get(`/documents/file/${pdfId}`, { maxRedirects: 0 })).status()).toBe(404);
  expect((await page.goto(`/documents/staff/${teacherId}`))?.status()).toBe(404);
});

test("teacher uploads own med book with expiry → head sees it in «Истекающие документы»", async ({ page }) => {
  await login(page, PHONES.teacher);
  await page.goto("/documents");
  const mine = page.getByTestId("my-documents");
  await upload(page, mine, { input: "doc-file", name: "medbook.pdf", mime: "application/pdf", buffer: PDF, title: MED_BOOK, type: "med_book", expires: day(10) });
  const row = mine.getByTestId("doc-row").filter({ hasText: MED_BOOK });
  await expect(row.getByTestId("expiry-badge")).toHaveText("истекает через 10 дней");
  // the teacher's own dashboard reminds them too
  await page.goto("/");
  await expect(page.getByTestId("my-expiring-documents")).toContainText(MED_BOOK);

  await login(page, PHONES.head);
  // the head's «Требует внимания» has the expiring-documents line (no separate card) leading to the list
  await expect(page.getByTestId("expiring-documents")).toHaveCount(0);
  const line = page.locator('[data-testid="attention-item"][data-kind="documents"]');
  await expect(line).toBeVisible();
  await line.click();
  await page.waitForURL("**/documents?tab=staff&filter=expiring");
  await expect(page.getByTestId("staff-documents")).toContainText(MED_BOOK);
  await expect(page.getByTestId("staff-documents")).toContainText("Нурланова Асель");
  // employee card shows the documents too
  await page.goto(`/staff/${teacherId}`);
  await expect(page.getByTestId("staff-documents-card")).toContainText(MED_BOOK);
});

test("a 6 MB scan goes from the browser straight to storage (over Vercel's 4.5 MB body limit) and opens via a signed link", async ({ page }) => {
  // D-035: no server action receives file bytes — the browser PUTs them to Storage with a signed upload URL.
  const big = Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024 - PDF.length, 0x20)]);
  let largestAppPost = 0;
  let storagePuts = 0;
  page.on("request", (r) => {
    if (r.url().includes("/storage/v1/object/upload/sign/") && r.method() === "PUT") storagePuts++;
    else if (r.method() === "POST" && !r.url().includes("/storage/v1/")) largestAppPost = Math.max(largestAppPost, r.postDataBuffer()?.length ?? 0);
  });
  await login(page, PHONES.teacher);
  await page.goto("/documents");
  const mine = page.getByTestId("my-documents");
  await upload(page, mine, { input: "doc-file", name: "scan.pdf", mime: "application/pdf", buffer: big, title: BIG_SCAN, type: "contract" });
  expect(storagePuts).toBe(1);
  expect(largestAppPost).toBeLessThan(64 * 1024);
  const row = await db.query("select id, size, mime, path from staff_documents where title = $1", [BIG_SCAN]);
  expect(row.rows[0]).toMatchObject({ size: big.length, mime: "application/pdf" });
  expect(row.rows[0].path).toMatch(new RegExp(`/${teacherId}/[0-9a-f-]{36}\\.pdf$`));
  // opens through the app's link → short-lived signed URL of the private object, bytes intact
  const res = await page.request.get(`/documents/file/${row.rows[0].id}?k=s`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect(res.url()).toContain("token=");
  const body = await res.body();
  expect(body.length).toBe(big.length);
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  // tidy up through the UI (own upload)
  await mine.getByTestId("doc-row").filter({ hasText: BIG_SCAN }).getByTestId("doc-delete").click();
  await page.getByTestId("confirm-ok").click();
  await expectToast(page, "Документ удалён");
});

test("accountant sees staff documents read-only and no child folders", async ({ page }) => {
  await login(page, PHONES.accountant);
  await page.goto("/documents");
  await expect(page.getByTestId("my-documents")).toBeVisible();
  await page.getByTestId(`staff-row-${PHONES.teacher}`).click();
  await page.waitForURL(`**/documents/staff/${teacherId}`);
  const folder = page.getByTestId(`staff-folder-${teacherId}`);
  await expect(folder).toContainText(MED_BOOK);
  await expect(folder.getByTestId("doc-view-only")).toBeVisible();
  await expect(folder.getByTestId("doc-upload")).toHaveCount(0);
  await expect(folder.getByTestId("doc-delete")).toHaveCount(0);
  expect((await page.goto(`/documents/child/${alikhan}`))?.status()).toBe(404);
});

test("cook sees only own documents", async ({ page }) => {
  await login(page, PHONES.cook);
  await page.goto("/documents");
  await expect(page.getByTestId("my-documents")).toBeVisible();
  await expect(page.getByTestId("staff-documents")).toHaveCount(0);
  await expect(page.getByText(MED_BOOK)).toHaveCount(0);
  expect((await page.goto(`/documents/staff/${teacherId}`))?.status()).toBe(404);
  expect((await page.goto(`/documents/child/${alikhan}`))?.status()).toBe(404);
});

test("expiry cron notifies the employee and the head once per threshold", async ({ request }) => {
  await db.query("delete from staff_document_reminders");
  await db.query("delete from notifications where type = 'document.expiring'");
  const call = () => request.get("/api/cron/document-expiry", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect((await request.get("/api/cron/document-expiry")).status()).toBe(401);
  const first = await call();
  expect(first.status()).toBe(200);
  expect((await first.json()).sent).toBeGreaterThanOrEqual(2); // seeded med book (20 days) + the E2E one (10 days)
  const n = await db.query(
    "select p.phone, n.url from notifications n join profiles p on p.id = n.user_id where n.type = 'document.expiring' and n.params->>'document' = $1",
    [MED_BOOK],
  );
  expect(n.rows.map((r) => r.phone).sort()).toEqual([PHONES.head, PHONES.teacher].sort());
  expect(n.rows.find((r) => r.phone === PHONES.head).url).toBe(`/documents/staff/${teacherId}`);
  const second = await call();
  expect((await second.json()).sent).toBe(0);
  await db.query("delete from notifications where type = 'document.expiring'");
});

test("clean-up by the owners of the uploads: teacher deletes own med book, parent own PDF", async ({ page }) => {
  await login(page, PHONES.teacher);
  await page.goto("/documents");
  await page.getByTestId("my-documents").getByTestId("doc-row").filter({ hasText: MED_BOOK }).getByTestId("doc-delete").click();
  await page.getByTestId("confirm-ok").click();
  await expectToast(page, "Документ удалён");
  // the seeded med book was uploaded by the head — the teacher cannot delete it
  await expect(page.getByTestId("my-documents").getByTestId("doc-row").filter({ hasText: "Медицинская книжка" }).getByTestId("doc-delete")).toHaveCount(0);

  await login(page, PHONES.parent);
  await page.goto(`/documents/child/${alikhan}`);
  const folder = page.getByTestId(`child-folder-${alikhan}`);
  await folder.getByTestId("doc-panel-medical").getByTestId("doc-row").filter({ hasText: PDF_TITLE }).getByTestId("doc-delete").click();
  await page.getByTestId("confirm-ok").click();
  await expectToast(page, "Документ удалён");
  expect((await db.query("select count(*)::int as n from child_documents where title like 'E2E %'")).rows[0].n).toBe(0);
});
