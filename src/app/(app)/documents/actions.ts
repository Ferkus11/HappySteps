"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KgContext } from "@/lib/auth/context";
import { commitUpload, prepareUpload, type PreparedUpload } from "@/lib/uploads";
import type { DeclaredFile } from "@/lib/uploads-core";
import { getTranslations } from "next-intl/server";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";
import { zOptionalDate, zUuid } from "@/lib/validation";
import { canUploadChildDocs, canUploadStaffDocs } from "@/lib/documents";
import { CHILD_BUCKET, CHILD_CATEGORIES, STAFF_BUCKET, STAFF_DOC_TYPES, titleFromFileName } from "@/lib/documents-logic";

const zTitle = z
  .string()
  .max(200, "tooLong")
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const childSchema = z.object({ childId: zUuid, category: z.enum(CHILD_CATEGORIES), title: zTitle, ticket: z.string().max(4096) });
const staffSchema = z.object({ userId: zUuid, type: z.enum(STAFF_DOC_TYPES), title: zTitle, expiresOn: zOptionalDate, ticket: z.string().max(4096) });

export type ChildDocumentInput = z.input<typeof childSchema>;
export type StaffDocumentInput = z.input<typeof staffSchema>;

/** Allowed: the child's parents and owner/head (checked with the user's own client — `child_docs_can_upload`). */
async function assertChildUpload(ctx: KgContext, supabase: SupabaseClient, childId: string) {
  const { data: child } = await supabase.from("children").select("id").eq("id", childId).eq("kindergarten_id", ctx.kg.id).maybeSingle();
  if (!child || !(await canUploadChildDocs(supabase, childId))) throw new ActionError("forbidden");
}

/** Step A of a child document upload (D-035): permission, limits, signed upload URL in the child's folder. */
export async function prepareChildDocumentAction(childId: string, file: DeclaredFile) {
  return kgAction(["owner", "head", "parent"], async (ctx, supabase): Promise<PreparedUpload> => {
    zUuid.parse(childId);
    await assertChildUpload(ctx, supabase, childId);
    const prefix = `${ctx.kg.id}/${childId}/`;
    return prepareUpload("childDocument", ctx, { target: childId, prefix, file, path: (ext, id) => `${prefix}${id}.${ext}` });
  });
}

/**
 * Step C: re-checks permission, verifies the stored file (size and the real type from its first bytes; HEIC is
 * converted in the browser) and writes the row (server only).
 */
export async function commitChildDocumentAction(input: ChildDocumentInput) {
  return kgAction(["owner", "head", "parent"], async (ctx, supabase) => {
    const v = parse(childSchema, input);
    await assertChildUpload(ctx, supabase, v.childId);
    const file = await commitUpload("childDocument", ctx, v.ticket, { target: v.childId, prefix: `${ctx.kg.id}/${v.childId}/` });
    const t = await getTranslations("documents");
    const title = v.title ?? (titleFromFileName(file.name) || t(`categories.${v.category}`));
    const service = createServiceClient();
    // Permission checked above; rows are written by the server only.
    const ins = await service
      .from("child_documents")
      .insert({ kindergarten_id: ctx.kg.id, child_id: v.childId, category: v.category, title, path: file.path, mime: file.mime, size: file.size, uploaded_by: ctx.userId })
      .select("id")
      .single();
    if (ins.error) {
      if (ins.error.code !== "23505") await service.storage.from(CHILD_BUCKET).remove([file.path]);
      check(ins);
    }
    return { id: ins.data!.id as string };
  });
}

const STAFF_ROLES = ["owner", "head", "accountant", "teacher", "club_teacher", "cook"] as const;

/** Step A of a staff document upload: the employee themself or owner/head (`staff_docs_can_upload`). */
export async function prepareStaffDocumentAction(userId: string, file: DeclaredFile) {
  return kgAction([...STAFF_ROLES], async (ctx, supabase): Promise<PreparedUpload> => {
    zUuid.parse(userId);
    if (!(await canUploadStaffDocs(supabase, ctx.kg.id, userId))) throw new ActionError("forbidden");
    const prefix = `${ctx.kg.id}/${userId}/`;
    return prepareUpload("staffDocument", ctx, { target: userId, prefix, file, path: (ext, id) => `${prefix}${id}.${ext}` });
  });
}

/** Step C of a staff document upload: re-check, verify the stored file, write the row. */
export async function commitStaffDocumentAction(input: StaffDocumentInput) {
  return kgAction([...STAFF_ROLES], async (ctx, supabase) => {
    const v = parse(staffSchema, input);
    if (!(await canUploadStaffDocs(supabase, ctx.kg.id, v.userId))) throw new ActionError("forbidden");
    const file = await commitUpload("staffDocument", ctx, v.ticket, { target: v.userId, prefix: `${ctx.kg.id}/${v.userId}/` });
    const t = await getTranslations("documents");
    const title = v.title ?? t(`types.${v.type}`);
    const service = createServiceClient();
    const ins = await service
      .from("staff_documents")
      .insert({
        kindergarten_id: ctx.kg.id,
        user_id: v.userId,
        type: v.type,
        title,
        expires_on: v.expiresOn,
        path: file.path,
        mime: file.mime,
        size: file.size,
        uploaded_by: ctx.userId,
      })
      .select("id")
      .single();
    if (ins.error) {
      if (ins.error.code !== "23505") await service.storage.from(STAFF_BUCKET).remove([file.path]);
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
