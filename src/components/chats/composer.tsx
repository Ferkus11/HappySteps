"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  FileText,
  Image as ImageIcon,
  Moon,
  Paperclip,
  Pencil,
  Reply,
  SendHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CHAT_ACCEPT,
  CHAT_FILE_MAX,
  CHAT_FILE_TYPES,
  CHAT_TEXT_MAX,
  type ChatMessage,
} from "@/lib/chats-logic";
import { prepareDocumentFile } from "@/lib/heic";

export interface Draft {
  body: string;
  file: File | null;
  replyTo: ChatMessage | null;
}

export function Composer({
  replyTo,
  replyAuthor,
  editing,
  quietHint,
  onCancel,
  onSend,
}: {
  replyTo: ChatMessage | null;
  replyAuthor: string;
  editing: ChatMessage | null;
  quietHint: boolean;
  onCancel: () => void;
  onSend: (d: Draft) => Promise<boolean>;
}) {
  const t = useTranslations("chats");
  const te = useTranslations("errors");
  const [text, setText] = React.useState(editing?.body ?? "");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const area = React.useRef<HTMLTextAreaElement>(null);

  // auto-grow up to ~6 lines
  React.useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);
  React.useEffect(() => {
    if (replyTo || editing) area.current?.focus();
  }, [replyTo, editing]);

  async function pick(list: FileList | null) {
    const f = list?.[0];
    if (input.current) input.current.value = "";
    if (!f) return;
    try {
      // HEIC photos from iPhones are converted to JPEG in the browser (shared with documents)
      const n = await prepareDocumentFile(f);
      if (!CHAT_FILE_TYPES[n.type]) return toast.error(te("fileType"));
      if (n.size > CHAT_FILE_MAX) return toast.error(te("fileTooLarge"));
      setFile(n);
    } catch {
      toast.error(te("fileType"));
    }
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const body = text.trim();
    if (!body && !file) return;
    setBusy(true);
    try {
      const ok = await onSend({
        body,
        file: editing ? null : file,
        replyTo: editing ? null : replyTo,
      });
      if (ok) {
        setText("");
        setFile(null);
      }
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  }

  const banner = editing ? (
    <ContextBar
      icon={Pencil}
      title={t("editing")}
      text={editing.body}
      onClose={onCancel}
    />
  ) : replyTo ? (
    <ContextBar
      icon={Reply}
      title={t("replyTo", { name: replyAuthor })}
      text={
        replyTo.body ||
        (replyTo.files[0]?.kind === "pdf" ? t("file") : t("photo"))
      }
      onClose={onCancel}
    />
  ) : null;

  return (
    <form
      onSubmit={submit}
      className="pb-safe border-t border-border/70 bg-surface px-2 pt-2 md:px-4"
      data-testid="composer"
    >
      {quietHint ? (
        <p
          className="mb-2 flex items-start gap-2 rounded-xl bg-tile-unmarked px-3 py-2 text-[13px] text-tile-unmarked-fg"
          data-testid="quiet-hint"
        >
          <Moon className="mt-0.5 size-4 shrink-0" aria-hidden />{" "}
          {t("quietHint")}
        </p>
      ) : null}
      {banner}
      {file ? (
        <div
          className="mb-2 flex items-center gap-2 rounded-xl bg-surface-muted px-3 py-2 text-sm"
          data-testid="composer-file"
        >
          {file.type === "application/pdf" ? (
            <FileText className="size-4 shrink-0 text-sky-strong" aria-hidden />
          ) : (
            <ImageIcon
              className="size-4 shrink-0 text-sky-strong"
              aria-hidden
            />
          )}
          <span data-user-content className="min-w-0 flex-1 truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => setFile(null)}
            className="-my-1 -mr-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface"
            aria-label={t("removeFile")}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-1.5 pb-2">
        {!editing ? (
          <>
            <input
              ref={input}
              type="file"
              accept={CHAT_ACCEPT}
              className="hidden"
              onChange={(e) => pick(e.target.files)}
              data-testid="composer-file-input"
            />
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-muted hover:text-text"
              aria-label={t("attach")}
              data-testid="composer-attach"
            >
              <Paperclip className="size-5" />
            </button>
          </>
        ) : null}
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("placeholder")}</span>
          <textarea
            ref={area}
            rows={1}
            value={text}
            maxLength={CHAT_TEXT_MAX}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                window.matchMedia("(pointer: fine)").matches
              ) {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape" && (editing || replyTo)) onCancel();
            }}
            placeholder={t("placeholder")}
            className="block max-h-40 min-h-11 w-full resize-none rounded-2xl border border-border bg-surface-muted px-4 py-2.5 text-[15px] leading-snug text-text placeholder:text-faint focus:border-brand focus:bg-surface focus:outline-none focus-visible:outline-none"
            data-testid="composer-input"
          />
        </label>
        <button
          type="submit"
          disabled={busy || (!text.trim() && !file)}
          className={cn(
            "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-brand text-brand-fg shadow-sm transition-opacity hover:bg-brand-strong disabled:cursor-default disabled:opacity-40",
          )}
          aria-label={editing ? t("saveEdit") : t("send")}
          data-testid="composer-send"
        >
          <SendHorizontal className="size-5" />
        </button>
      </div>
    </form>
  );
}

function ContextBar({
  icon: Icon,
  title,
  text,
  onClose,
}: {
  icon: typeof Reply;
  title: string;
  text: string;
  onClose: () => void;
}) {
  const tc = useTranslations("common");
  return (
    <div
      className="mb-2 flex items-center gap-2 rounded-xl border-l-[3px] border-sky bg-sky-soft/60 py-1.5 pr-1 pl-3"
      data-testid="composer-context"
    >
      <Icon className="size-4 shrink-0 text-sky-strong" aria-hidden />
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="font-bold text-sky-strong">{title}</div>
        <div className="truncate text-muted">{text}</div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="-my-1.5 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface"
        aria-label={tc("cancel")}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
