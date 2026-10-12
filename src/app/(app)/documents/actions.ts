"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import { zOptionalDate, zUuid } from "@/lib/validation";
import { canUploadChildDocs, canUploadStaffDocs } from "@/lib/documents";
import {
  CHILD_BUCKET,
  CHILD_CATEGORIES,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_SIZE,
  STAFF_BUCKET,
  STAFF_DOC_TYPES,
  sniffMime,
  titleFromFileName,
} from "@/lib/documents-logic";

const zTitle = z
  .string()
  .max(200, "tooLong")
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const childSchema = z.object({ childId: zUuid, category: z.enum(CHILD_CATEGORIES), title: zTitle });
const staffSchema = z.object({ userId: zUuid, type: z.enum(STAFF_DOC_TYPES), title: zTitle, expiresOn: zOptionalDate });

/** Validates the uploaded file: size and the real type from its first bytes (HEIC is converted in the browser). */
async function readFile(form: FormData): Promise<{ file: File; mime: string; ext: string }> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ActionError("invalid");
  if (file.size > MAX_DOCUMENT_SIZE) throw new ActionError("fileTooLarge");
  const mime = sniffMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  const ext = mime ? DOCUMENT_TYPES[mime] : undefined;
  if (!mime || !ext) throw new ActionError("fileType");
  return { file, mime, ext };
}

const str = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v : undefined;
};

/**
 * Uploads one file into a child's folder. Allowed: the child's parents and owner/head (checked here with the
 * user's own client — `child_docs_can_upload` — before the service role writes the object and the row).
 */
export async function uploadChildDocumentAction(form: FormData) {
  return kgAction(["owner", "head", "parent"], async (ctx, supabase) => {
    const v = parse(childSchema, { childId: str(form, "childId"), category: str(form, "category"), title: str(form, "title") });
    const { data: child } = await supabase.from("children").select("id").eq("id", v.childId).eq("kindergarten_id", ctx.kg.id).maybeSingle();
    if (!child || !(await canUploadChildDocs(supabase, v.childId))) throw new ActionError("forbidden");
    const { file, mime, ext } = await readFile(form);
    const t = await getTranslations("documents");
    const title = v.title ?? (titleFromFileName(file.name) || t(`categories.${v.category}`));
    const path = `${ctx.kg.id}/${v.childId}/${randomUUID()}.${ext}`;
    const service = createServiceClient();
    const up = await service.storage.from(CHILD_BUCKET).upload(path, file, { contentType: mime });
    if (up.error) throw new ActionError("generic");
    // Permission checked above; rows are written by the server only.
    const ins = await service
      .from("child_documents")
      .insert({ kindergarten_id: ctx.kg.id, child_id: v.childId, category: v.category, title, path, mime, size: file.size, uploaded_by: ctx.userId })
      .select("id")
      .single();
    if (ins.error) {
      await service.storage.from(CHILD_BUCKET).remove([path]);
      check(ins);
    }
    return { id: ins.data!.id as string };
  });
}

/** Uploads one staff document: the employee themself or owner/head (`staff_docs_can_upload`). */
export async function uploadStaffDocumentAction(form: FormData) {
  return kgAction(["owner", "head", "accountant", "teacher", "club_teacher", "cook"], async (ctx, supabase) => {
    const v = parse(staffSchema, {
      userId: str(form, "userId"),
      type: str(form, "type"),
      title: str(form, "title"),
      expiresOn: str(form, "expiresOn"),
    });
    if (!(await canUploadStaffDocs(supabase, ctx.kg.id, v.userId))) throw new ActionError("forbidden");
    const { file, mime, ext } = await readFile(form);
    const t = await getTranslations("documents");
    const title = v.title ?? t(`types.${v.type}`);
    const path = `${ctx.kg.id}/${v.userId}/${randomUUID()}.${ext}`;
    const service = createServiceClient();
    const up = await service.storage.from(STAFF_BUCKET).upload(path, file, { contentType: mime });
    if (up.error) throw new ActionError("generic");
    const ins = await service
      .from("staff_documents")
      .insert({
        kindergarten_id: ctx.kg.id,
        user_id: v.userId,
        type: v.type,
        title,
        expires_on: v.expiresOn,
        path,
        mime,
        size: file.size,
        uploaded_by: ctx.userId,
      })
      .select("id")
      .single();
    if (ins.error) {
      await service.storage.from(STAFF_BUCKET).remove([path]);
      check(ins);
    }
    return { id: ins.data!.id as string };
  });
}

/** Deletes a child document (RLS: owner/head any, a parent only own uploads) and its file; audited. */
export async function deleteChildDocumentAction(id: string) {
  return kgAction(["owner", "head", "parent"], async (ctx, supabase) => {
    zUuid.parse(id);
    const { data: before } = await supabase.from("child_documents").select("child_id, children(full_name)").eq("id", id).maybeSingle();
    const removed = check(await supabase.from("child_documents").delete().eq("id", id).eq("kindergarten_id", ctx.kg.id).select("path, title, category"));
    if (!removed.length) throw new ActionError("forbidden");
    await createServiceClient().storage.from(CHILD_BUCKET).remove([removed[0].path as string]);
    const child = (before as unknown as { children: { full_name: string } | null } | null)?.children?.full_name;
    await audit(supabase, ctx.kg.id, "document.delete", "child_document", id, {
      child: child ?? before?.child_id ?? null,
      category: removed[0].category,
      title: removed[0].title,
    });
  });
}

/** Deletes a staff document (RLS: owner/head any, an employee own uploads of own documents); audited. */
export async function deleteStaffDocumentAction(id: string) {
  return kgAction(["owner", "head", "accountant", "teacher", "club_teacher", "cook"], async (ctx, supabase) => {
    zUuid.parse(id);
    const { data: before } = await supabase
      .from("staff_documents")
      .select("user_id, person:profiles!staff_documents_user_id_fkey(full_name)")
      .eq("id", id)
      .maybeSingle();
    const removed = check(await supabase.from("staff_documents").delete().eq("id", id).eq("kindergarten_id", ctx.kg.id).select("path, title, type"));
    if (!removed.length) throw new ActionError("forbidden");
    await createServiceClient().storage.from(STAFF_BUCKET).remove([removed[0].path as string]);
    const person = (before as unknown as { person: { full_name: string } | null } | null)?.person?.full_name;
    await audit(supabase, ctx.kg.id, "document.delete", "staff_document", id, {
      person: person ?? before?.user_id ?? null,
      type: removed[0].type,
      title: removed[0].title,
    });
  });
}
