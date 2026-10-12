"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Copy, Download, ExternalLink, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { encodeQr, qrSvg } from "@/lib/qr";

/** Draws the QR code on a canvas and saves it as PNG (big enough to print on A4). */
function downloadPng(url: string, fileName: string) {
  const { modules, size } = encodeQr(url);
  const scale = 16;
  const margin = 4;
  const px = (size + margin * 2) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, px, px);
  g.fillStyle = "#000000";
  modules.forEach((row, y) => row.forEach((dark, x) => dark && g.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale)));
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

/** Link of the public application form + QR code, «Скопировать», «Открыть», «Скачать QR-код». */
export function FormLinkPanel({ url, fileName }: { url: string; fileName: string }) {
  const t = useTranslations("waitlist");
  const svg = React.useMemo(() => qrSvg(url, { margin: 2, title: t("qrAlt") }), [url, t]);
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start" data-testid="form-link">
      <div
        className="mx-auto size-44 shrink-0 overflow-hidden rounded-2xl border border-border bg-white p-1.5 sm:mx-0 [&_svg]:size-full"
        data-testid="form-qr"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="min-w-0 flex-1 space-y-3">
        <p className="text-sm text-muted">{t("formLinkHint")}</p>
        <p className="rounded-xl bg-surface-muted px-3 py-2 font-mono text-[12px] break-all" data-testid="form-url">
          {url}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(url).catch(() => {});
              toast.success(t("linkCopied"));
            }}
          >
            <Copy /> {t("copyLink")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => downloadPng(url, fileName)} data-testid="form-qr-download">
            <Download /> {t("downloadQr")}
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink /> {t("openForm")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function FormLinkButton({ url, fileName }: { url: string; fileName: string }) {
  const t = useTranslations("waitlist");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="form-link-open">
          <QrCode /> {t("formLink")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("formLinkTitle")} className="md:w-[600px]">
        <FormLinkPanel url={url} fileName={fileName} />
      </DialogContent>
    </Dialog>
  );
}
