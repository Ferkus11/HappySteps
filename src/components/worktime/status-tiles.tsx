import { getTranslations } from "next-intl/server";
import { StatusTile } from "@/components/ui/stat";
import type { TileCounts } from "@/lib/worktime";

/** The four work-time tiles (SPEC §5.2): at work · late · absent · not marked. */
export async function WorktimeTiles({ counts, href }: { counts: TileCounts; href?: (status: keyof TileCounts) => string }) {
  const t = await getTranslations("worktime");
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatusTile tone="work" value={counts.work} label={t("tiles.work")} href={href?.("work")} testId="tile-work" />
      <StatusTile tone="late" value={counts.late} label={t("tiles.late")} href={href?.("late")} testId="tile-late" />
      <StatusTile tone="absent" value={counts.absent} label={t("tiles.absent")} href={href?.("absent")} testId="tile-absent" />
      <StatusTile tone="unmarked" value={counts.unmarked} label={t("tiles.unmarked")} href={href?.("unmarked")} testId="tile-unmarked" />
    </div>
  );
}
