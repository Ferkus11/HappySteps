import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/format";
import { EXPIRY_WINDOW_DAYS, type ChildCategory, type StaffDocType } from "@/lib/documents-logic";

export interface ChildDoc {
  id: string;
  childId: string;
  category: ChildCategory;
  title: string;
  mime: string;
  size: number;
  uploadedBy: string | null;
  uploaderName: string | null;
  createdAt: string;
}

export interface StaffDoc {
  id: string;
  userId: string;
  personName: string;
  type: StaffDocType;
  title: string;
  expiresOn: string | null;
  mime: string;
  size: number;
  uploadedBy: string | null;
  createdAt: string;
}

type ChildRow = {
  id: string;
  child_id: string;
  category: ChildCategory;
  title: string;
  mime: string;
  size: number;
  uploaded_by: string | null;
  created_at: string;
  uploader: { full_name: string } | null;
};

/** Documents of the given children that the current user may see (RLS: child_docs_can_view). */
export async function listChildDocuments(supabase: SupabaseClient, kgId: string, childIds?: string[]): Promise<ChildDoc[]> {
  let q = supabase
    .from("child_documents")
    .select("id, child_id, category, title, mime, size, uploaded_by, created_at, uploader:profiles!child_documents_uploaded_by_fkey(full_name)")
    .eq("kindergarten_id", kgId)
    .order("created_at", { ascending: false });
  if (childIds) {
    if (!childIds.length) return [];
    q = q.in("child_id", childIds);
  }
  const { data } = await q;
  return ((data ?? []) as unknown as ChildRow[]).map((r) => ({
    id: r.id,
    childId: r.child_id,
    category: r.category,
    title: r.title,
    mime: r.mime,
    size: r.size,
    uploadedBy: r.uploaded_by,
    uploaderName: r.uploader?.full_name ?? null,
    createdAt: r.created_at,
  }));
}

type StaffRow = {
  id: string;
  user_id: string;
  type: StaffDocType;
  title: string;
  expires_on: string | null;
  mime: string;
  size: number;
  uploaded_by: string | null;
  created_at: string;
  person: { full_name: string } | null;
};

/**
 * Staff documents visible to the current user (RLS: owner/head/accountant all, others own).
 * `expiringFrom` (today) keeps only documents expired or expiring within 30 days, soonest first.
 */
export async function listStaffDocuments(
  supabase: SupabaseClient,
  kgId: string,
  opts: { userId?: string; expiringFrom?: string } = {},
): Promise<StaffDoc[]> {
  let q = supabase
    .from("staff_documents")
    .select("id, user_id, type, title, expires_on, mime, size, uploaded_by, created_at, person:profiles!staff_documents_user_id_fkey(full_name)")
    .eq("kindergarten_id", kgId);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  if (opts.expiringFrom) {
    q = q.not("expires_on", "is", null).lte("expires_on", addDays(opts.expiringFrom, EXPIRY_WINDOW_DAYS)).order("expires_on");
  } else {
    q = q.order("created_at", { ascending: false });
  }
  const { data } = await q;
  return ((data ?? []) as unknown as StaffRow[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    personName: r.person?.full_name ?? "—",
    type: r.type,
    title: r.title,
    expiresOn: r.expires_on,
    mime: r.mime,
    size: r.size,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  }));
}

/** May the current user see this child's folder? (owner/head, the child's parents, the group's teacher) */
export async function canViewChildDocs(supabase: SupabaseClient, childId: string): Promise<boolean> {
  const { data } = await supabase.rpc("child_docs_can_view", { c: childId });
  return data === true;
}

export async function canUploadChildDocs(supabase: SupabaseClient, childId: string): Promise<boolean> {
  const { data } = await supabase.rpc("child_docs_can_upload", { c: childId });
  return data === true;
}

export async function canViewStaffDocs(supabase: SupabaseClient, kgId: string, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("staff_docs_can_view", { kg: kgId, u: userId });
  return data === true;
}

export async function canUploadStaffDocs(supabase: SupabaseClient, kgId: string, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("staff_docs_can_upload", { kg: kgId, u: userId });
  return data === true;
}
