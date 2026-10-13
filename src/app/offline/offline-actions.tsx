"use client";

import * as React from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * «Повторить» reloads the page the user asked for; it also retries by itself when the network comes back.
 * Labels come from the page in both languages (one precached copy for every reader).
 */
export function OfflineActions({ labels }: { labels: { retry: string; home: string; checking: string } }) {
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    const onOnline = () => window.location.reload();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return (
    <div className="mt-6 grid gap-2">
      <Button
        size="lg"
        className="w-full"
        data-testid="offline-retry"
        disabled={checking}
        onClick={() => {
          setChecking(true);
          window.location.reload();
        }}
      >
        <RotateCw className={checking ? "animate-spin" : undefined} /> {checking ? labels.checking : labels.retry}
      </Button>
      {/* A full page load on purpose: the service worker answers it from the saved copy of the home page
          (a client-side navigation would need the network for its data request). */}
      <Button
        variant="ghost"
        className="w-full"
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see the comment above
        onClick={() => window.location.assign("/")}
      >
        {labels.home}
      </Button>
    </div>
  );
}
