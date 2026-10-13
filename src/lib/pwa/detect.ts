/**
 * Pure platform checks for the PWA install help (unit-tested in tests/unit/pwa.test.ts).
 * Everything takes plain values so it can run outside a browser.
 */

export interface PlatformInfo {
  userAgent: string;
  /** navigator.maxTouchPoints — iPadOS Safari reports a Mac user agent but has touch. */
  maxTouchPoints?: number;
  /** navigator.standalone — iOS-only, true when opened from the Home Screen. */
  iosStandalone?: boolean;
  /** matchMedia("(display-mode: standalone)").matches (or fullscreen / minimal-ui). */
  displayModeStandalone?: boolean;
}

/** iPhone, iPod or iPad (including iPadOS 13+ that pretends to be a Mac). */
export function isIos({ userAgent, maxTouchPoints = 0 }: PlatformInfo): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/** Running as an installed app (Home Screen on iOS, installed PWA elsewhere). */
export function isStandalone({ iosStandalone, displayModeStandalone }: PlatformInfo): boolean {
  return iosStandalone === true || displayModeStandalone === true;
}

/** Safari itself (not Chrome/Firefox/Edge/in-app browsers on iOS, which can't always add to the Home Screen). */
export function isIosSafari(info: PlatformInfo): boolean {
  if (!isIos(info)) return false;
  const ua = info.userAgent;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|GSA\/|Instagram|FBAN|FBAV|Telegram|WhatsApp/i.test(ua)) return false;
  return /Safari\//.test(ua) && /Version\//.test(ua);
}

/** The iOS «Add to Home Screen» help is useful only on iOS, outside the installed app. */
export function shouldOfferIosInstall(info: PlatformInfo, dismissed: boolean): boolean {
  return !dismissed && isIos(info) && !isStandalone(info);
}

/** Reads PlatformInfo from the current browser (call only on the client). */
export function readPlatform(): PlatformInfo {
  const nav = navigator as Navigator & { standalone?: boolean };
  let displayModeStandalone = false;
  try {
    displayModeStandalone = ["standalone", "fullscreen", "minimal-ui"].some((m) => window.matchMedia(`(display-mode: ${m})`).matches);
  } catch {
    displayModeStandalone = false;
  }
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    iosStandalone: nav.standalone,
    displayModeStandalone,
  };
}

export const IOS_INSTALL_DISMISSED_KEY = "hs_ios_install_dismissed";

export function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(IOS_INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDismissed() {
  try {
    window.localStorage.setItem(IOS_INSTALL_DISMISSED_KEY, "1");
  } catch {
    // private mode / blocked storage: the sheet simply shows again next time
  }
}
