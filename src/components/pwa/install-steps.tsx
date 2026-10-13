import { useTranslations } from "next-intl";

/** iOS Safari «Share» glyph: a square tray with an arrow up. */
function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
    </svg>
  );
}

/** «Add to Home Screen» glyph: a rounded square with a plus. */
function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

/** The app icon as it appears on the Home Screen. */
function AppIcon() {
  return (
    <span className="grid size-5 place-items-center rounded-[6px] bg-brand text-[11px] leading-none font-extrabold text-brand-fg" aria-hidden>
      H
    </span>
  );
}

/** The three «Add to Home Screen» steps for iPhone / iPad. */
export function IosInstallSteps({ showSafariHint = false }: { showSafariHint?: boolean }) {
  const t = useTranslations("pwa");
  const steps = [
    { icon: <ShareIcon />, text: t("iosStep1") },
    { icon: <AddIcon />, text: t("iosStep2") },
    { icon: <AppIcon />, text: t("iosStep3") },
  ];
  return (
    <div>
      <ol className="grid gap-2.5" data-testid="ios-install-steps">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-3 rounded-2xl bg-surface-muted p-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-[13px] font-extrabold text-muted shadow-card">{i + 1}</span>
            <span className="min-w-0 flex-1 text-[15px] leading-snug font-semibold text-text">{s.text}</span>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-soft text-sky-strong">{s.icon}</span>
          </li>
        ))}
      </ol>
      {showSafariHint ? <p className="mt-3 text-sm text-muted">{t("iosNotSafari")}</p> : null}
    </div>
  );
}
