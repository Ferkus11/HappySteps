"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { withUserValues } from "@/components/ui/user-text";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  chatContactsAction,
  startDirectChatAction,
  type ChatContact,
} from "@/app/(app)/chats/actions";
import { useOfflineGuard } from "@/lib/pwa/offline-guard";

/** «Новый чат»: people the current user may write to (rules in SQL: parents never see other parents). */
export function NewChatDialog() {
  const t = useTranslations("chats");
  const tr = useTranslations("roles");
  const te = useTranslations("errors");
  const offline = useOfflineGuard();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [contacts, setContacts] = React.useState<ChatContact[] | null>(null);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || contacts) return;
    chatContactsAction()
      .then((r) =>
        r.ok
          ? setContacts(r.data)
          : toast.error(te.has(r.error) ? te(r.error) : te("generic")),
      )
      .catch(() => toast.error(te("generic")));
  }, [open, contacts, te]);

  const needle = q.trim().toLowerCase();
  const list = (contacts ?? []).filter(
    (c) =>
      !needle ||
      `${c.full_name} ${c.hint ?? ""} ${tr(c.role)}`
        .toLowerCase()
        .includes(needle),
  );

  async function start(c: ChatContact) {
    if (offline.blocked()) return;
    setBusy(c.user_id);
    try {
      const r = await startDirectChatAction(c.user_id).catch((e) => {
        if (!offline.failed(e)) throw e;
        return null;
      });
      if (!r) return;
      if (!r.ok)
        return toast.error(te.has(r.error) ? te(r.error) : te("generic"));
      setOpen(false);
      router.push(`/chats/${r.data.id}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        setQ("");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" data-testid="new-chat">
          <Plus /> {t("newChat")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("newChat")} description={t("newChatHint")}>
        <label className="relative mb-3 block">
          <span className="sr-only">{t("searchPeople")}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPeople")}
            className="pl-10"
            data-testid="new-chat-search"
          />
        </label>
        {!contacts ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title={t("noContacts")}
            hint={contacts.length ? undefined : t("noContactsHint")}
            className="py-6"
          />
        ) : (
          <ul
            className="-mx-2 max-h-[55dvh] overflow-y-auto"
            data-testid="contact-list"
          >
            {list.map((c) => (
              <li key={c.user_id}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => start(c)}
                  data-testid="contact"
                  className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-muted disabled:opacity-60"
                >
                  <Avatar name={c.full_name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span data-user-content className="block truncate text-[15px] font-semibold text-text">
                      {c.full_name}
                    </span>
                    <span className="block truncate text-[13px] text-muted">
                      {tr(c.role)}
                      {c.hint ? (
                        c.role === "parent" ? (
                          <>
                            {" · "}
                            {withUserValues((v) => t("parentOf", v), { names: c.hint })}
                          </>
                        ) : (
                          <>
                            {" · "}
                            <span data-user-content>{c.hint}</span>
                          </>
                        )
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
