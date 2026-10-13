"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions/result";
import { isOnline, reportNetworkFailure } from "@/lib/pwa/connectivity";
import { isNetworkError } from "@/lib/pwa/network-error";
import { showOfflineToast } from "@/lib/pwa/offline-guard";

/**
 * Runs a server action that returns ActionResult, shows a toast on error
 * (translated from the "errors" namespace) and refreshes server components on success.
 */
export function useAction<A extends unknown[], T>(
  fn: (...args: A) => Promise<ActionResult<T>>,
  opts: { success?: string; refresh?: boolean; onSuccess?: (data: T) => void } = {},
) {
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const run = React.useCallback(
    (...args: A) =>
      new Promise<ActionResult<T> | null>((resolve) => {
        // Offline (SPEC §8): nothing is sent, the user gets one clear message instead of a spinner.
        if (!isOnline()) {
          showOfflineToast(te("offline"));
          resolve(null);
          return;
        }
        start(async () => {
          try {
            const res = await fn(...args);
            if (res.ok) {
              setFieldErrors({});
              if (opts.success) toast.success(opts.success);
              if (opts.refresh !== false) router.refresh();
              opts.onSuccess?.((res as { data: T }).data);
            } else {
              setFieldErrors(res.fieldErrors ?? {});
              toast.error(te.has(res.error) ? te(res.error) : te("generic"));
            }
            resolve(res);
          } catch (e) {
            if (isNetworkError(e)) {
              reportNetworkFailure();
              showOfflineToast(te("offline"));
            } else {
              console.error(e);
              toast.error(te("generic"));
            }
            resolve(null);
          }
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, opts.success, opts.refresh],
  );

  const fieldError = (name: string) => (fieldErrors[name] ? (te.has(fieldErrors[name]) ? te(fieldErrors[name]) : te("invalid")) : undefined);
  return { run, pending, fieldError };
}
