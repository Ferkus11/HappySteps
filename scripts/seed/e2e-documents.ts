/**
 * Fixtures for documents (stage 3B). Idempotent: rows are found by title and refreshed; files are
 * tiny but real objects in the private buckets, so the viewer links work in e2e and demos.
 * - the teacher's medical book expires in 20 days (shows in «Истекающие документы»);
 * - Алихан has a vaccination certificate (PDF).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./lib";

interface Ids {
  users: Record<string, string>;
  kindergartens: { A: string };
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plus = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** A minimal valid one-page PDF. */
export function tinyPdf(text = "Happy Steps"): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "", // stream, filled below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const content = `BT /F1 18 Tf 30 100 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// Deterministic object names so re-seeding overwrites instead of piling up files.
const TEACHER_DOC = "5e7a1d0c-0000-4000-8000-00000000d001";
const CHILD_DOC = "5e7a1d0c-0000-4000-8000-00000000d002";

export async function seedDocuments(db: SupabaseClient, ids: Ids) {
  const A = ids.kindergartens.A;
  const { teacher, head, parent } = ids.users;

  const { data: alikhan } = await db.from("children").select("id").eq("kindergarten_id", A).eq("full_name", "Ахметов Алихан Даниярович").single();
  const childId = alikhan!.id as string;

  const put = async (bucket: string, path: string, body: Buffer, contentType: string) => {
    must(await db.storage.from(bucket).upload(path, body, { contentType, upsert: true }), `upload ${bucket}/${path}`);
  };

  // Staff document of the teacher, expiring in 20 days.
  const staffPath = `${A}/${teacher}/${TEACHER_DOC}.pdf`;
  const staffPdf = tinyPdf("Med book");
  await put("staff-documents", staffPath, staffPdf, "application/pdf");
  const staffRow = { kindergarten_id: A, user_id: teacher, type: "med_book", title: "Медицинская книжка", expires_on: plus(today(), 20), path: staffPath, mime: "application/pdf", size: staffPdf.length, uploaded_by: head };
  const { data: s } = await db.from("staff_documents").select("id").eq("path", staffPath).maybeSingle();
  if (s) must(await db.from("staff_documents").update(staffRow).eq("id", s.id), "staff document");
  else must(await db.from("staff_documents").insert(staffRow), "staff document");
  // Fresh reminders for the refreshed expiry date.
  await db.from("staff_document_reminders").delete().eq("kindergarten_id", A);

  // Child document of Алихан.
  const childPath = `${A}/${childId}/${CHILD_DOC}.pdf`;
  const childPdf = tinyPdf("Vaccination");
  await put("child-documents", childPath, childPdf, "application/pdf");
  const childRow = { kindergarten_id: A, child_id: childId, category: "vaccination", title: "Прививочный сертификат", path: childPath, mime: "application/pdf", size: childPdf.length, uploaded_by: parent };
  const { data: c } = await db.from("child_documents").select("id").eq("path", childPath).maybeSingle();
  if (c) must(await db.from("child_documents").update(childRow).eq("id", c.id), "child document");
  else must(await db.from("child_documents").insert(childRow), "child document");
}
