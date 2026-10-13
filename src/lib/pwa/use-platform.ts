"use client";

import * as React from "react";
import { readPlatform, type PlatformInfo } from "./detect";

let cached: PlatformInfo | null = null;
const getSnapshot = () => (cached ??= readPlatform());
const getServerSnapshot = () => null;
const subscribe = () => () => undefined; // the platform doesn't change during a visit

/** The browser's PlatformInfo after hydration; null on the server and during hydration. */
export function usePlatform(): PlatformInfo | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
