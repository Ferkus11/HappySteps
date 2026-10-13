import { getTranslations } from "next-intl/server";
import { Phone, Users } from "lucide-react";
import type { Club, RosterRow } from "@/lib/clubs-data";
import { confirmOutcome, type ClubStats } from "@/lib/clubs";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmEnrollmentButton, ReasonButton, WriteButton } from "./actions";
import { EnrollmentBadge } from "./bits";

export interface RosterRights {
  decide: boolean; // confirm / reject (owner, head, the club's teacher)
  exclude: boolean; // owner, head
  write: boolean; // «Написать» parents
  contactsAll: boolean; // owner, head, accountant: contacts/allergies for requests and the queue too (club teacher: enrolled only)
}

function Parents({ row, rights }: { row: RosterRow; rights: RosterRights }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {row.parents.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-surface-muted px-3 py-2" data-testid="roster-parent">
          <div className="min-w-0 flex-1 text-sm">
            <div data-user-content className="truncate font-semibold">{p.name}</div>
            <a href={`tel:${p.phone}`} className="inline-flex min-h-11 items-center gap-1.5 text-[13px] text-sky-strong" data-testid="parent-phone" data-phone={p.phone}>
              <Phone className="size-3.5" aria-hidden />
              {formatPhone(p.phone)}
            </a>
          </div>
          {rights.write ? <WriteButton userId={p.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

async function Row({ row, club, stats, rights, tz }: { row: RosterRow; club: Club; stats: ClubStats; rights: RosterRights; tz: string }) {
  const t = await getTranslations("clubs");
  const outcome = confirmOutcome({ status: row.status, position: row.queue_position }, stats);
  const age = row.age;
  return (
    <li className="py-3 first:pt-0 last:pb-0" data-testid="roster-row" data-child={row.child_name} data-status={row.status}>
      <div className="flex items-start gap-3">
        <Avatar name={row.child_name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span data-user-content className="font-bold">{row.child_name}</span>
            {row.status !== "active" ? <EnrollmentBadge status={row.status} position={row.queue_position} /> : null}
            {row.status === "queued" && outcome === "active" ? <Badge tone="success">{t("queueReady")}</Badge> : null}
          </div>
          <div className="text-[13px] text-muted">
            {t("childAge", { count: age })}
            {row.group_name ? (
  <>
    {" · "}
    <span data-user-content>{row.group_name}</span>
  </>
) : null}
            {" · "}
            {row.status === "active" && row.started_on ? t("since", { date: formatDate(row.started_on, tz) }) : t("requestedAt", { date: formatDate(row.requested_at, tz) })}
          </div>
          {row.allergies ? <div className="mt-0.5 text-[13px] font-semibold text-warning">{t("allergies", { text: row.allergies })}</div> : null}
        </div>
      </div>
      {row.parents.length ? (
        <Parents row={row} rights={rights} />
      ) : row.status === "active" || rights.contactsAll ? (
        <p className="mt-2 text-[13px] text-faint">{t("noParents")}</p>
      ) : null}
      {(rights.decide && row.status !== "active") || (rights.exclude && row.status === "active") ? (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {rights.decide && row.status !== "active" ? (
            <>
              <ReasonButton enrollmentId={row.enrollment_id} kind="reject" child={row.child_name} club={club.name} />
              <ConfirmEnrollmentButton enrollmentId={row.enrollment_id} disabled={outcome === "full" || outcome === "order"} />
            </>
          ) : null}
          {rights.exclude && row.status === "active" ? <ReasonButton enrollmentId={row.enrollment_id} kind="exclude" child={row.child_name} club={club.name} /> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Requests, queue and the attending children of one club. */
export async function ClubRoster({ club, rows, stats, rights, tz }: { club: Club; rows: RosterRow[]; stats: ClubStats; rights: RosterRights; tz: string }) {
  const t = await getTranslations("clubs");
  const requests = rows.filter((r) => r.status === "requested");
  const queue = rows.filter((r) => r.status === "queued");
  const attending = rows.filter((r) => r.status === "active");
  const section = (title: string, list: RosterRow[], testid: string, extra?: React.ReactNode) =>
    list.length ? (
      <Card data-testid={testid}>
        <CardHeader title={title} action={extra} />
        <ul className="divide-y divide-border">
          {list.map((r) => (
            <Row key={r.enrollment_id} row={r} club={club} stats={stats} rights={rights} tz={tz} />
          ))}
        </ul>
      </Card>
    ) : null;
  return (
    <div className="space-y-4">
      {section(t("requests"), requests, "club-requests", <Badge tone="sky">{t("requestsCount", { count: requests.length })}</Badge>)}
      {section(t("queue"), queue, "club-queue", <Badge tone="warning">{t("places.queue", { count: queue.length })}</Badge>)}
      {attending.length ? (
        section(t("attending"), attending, "club-attending", <Badge tone="success">{t("places.attending", { active: stats.active, capacity: stats.capacity })}</Badge>)
      ) : (
        <Card data-testid="club-attending">
          <CardHeader title={t("attending")} />
          <EmptyState icon={Users} title={t("noAttending")} className="py-6" />
        </Card>
      )}
    </div>
  );
}
