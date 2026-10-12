import { getTranslations } from "next-intl/server";
import { Baby, Inbox } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ring } from "@/components/ui/ring";
import { Stat, StatusTile } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { navFor } from "@/lib/nav";
import { isRole } from "@/lib/auth/roles";

export const metadata = { robots: { index: false } };

/** Design-system preview used for visual checks (no data, no auth). */
export default async function Styleguide({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role: r } = await searchParams;
  const role = isRole(r) ? r : "owner";
  const tr = await getTranslations("roles");
  const tc = await getTranslations("common");
  return (
    <AppShell
      nav={navFor(role)}
      kindergarten={{ name: "Happy Steps" }}
      user={{ fullName: "Айгерим Сапарова", phone: "+7 (701) 123-45-67" }}
      roleLabel={tr(role)}
      contexts={[]}
      currentContext={null}
      unreadChats={3}
      unreadNotifications={2}
    >
      <h1 className="mb-5 text-[26px] font-extrabold tracking-tight">{tc("styleguide")}</h1>
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <Stat value="118" label="Детей" sub="+3 за месяц" />
        </Card>
        <Card className="flex items-center justify-between">
          <Stat value="6" label="Групп" />
          <Ring value={86} />
        </Card>
        <Card className="flex items-center justify-between">
          <Stat value="97 / 21" label="Пришли / отсутствуют" />
          <Ring value={82} color="var(--sky)" />
        </Card>
        <Card className="flex items-center justify-between">
          <Stat value="74%" label="Оплачено" sub={<span className="text-danger">Долг 412 000 ₸</span>} />
          <Ring value={74} color="var(--success)" />
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Учёт рабочего времени" href="/styleguide" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatusTile tone="work" value={18} label="На работе" />
          <StatusTile tone="late" value={2} label="Опоздал" />
          <StatusTile tone="absent" value={1} label="Отсутствует" />
          <StatusTile tone="unmarked" value={3} label="Не отметились" />
        </div>
      </Card>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Кнопки и бейджи" />
          <div className="flex flex-wrap gap-2">
            <Button>Начать рабочий день</Button>
            <Button variant="secondary">Вторичная</Button>
            <Button variant="outline">Контурная</Button>
            <Button variant="ghost">Тихая</Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="success">Оплачено</Badge>
            <Badge tone="warning">На проверке</Badge>
            <Badge tone="danger">Просрочен</Badge>
            <Badge tone="sky">Новая</Badge>
            <Badge tone="brand">Важное</Badge>
            <Badge tone="lavender">Очередь</Badge>
          </div>
          <p className="mt-4 text-sm">Қазақ әліпбиі: Әә Ғғ Ққ Ңң Өө Ұұ Үү Һһ Іі — «Бүгін балабақшада»</p>
        </Card>
        <Card>
          <CardHeader title="Форма" />
          <div className="space-y-3">
            <Field label="ФИО" htmlFor="sg-name">
              <Input id="sg-name" placeholder="Нұрлан Әбілов" />
            </Field>
            <Field label="Группа" htmlFor="sg-group" error="Обязательное поле">
              <Select id="sg-group" aria-invalid>
                <option>Солнышко</option>
              </Select>
            </Field>
            <Skeleton className="h-11" />
          </div>
        </Card>
      </div>
      <Card className="mt-4">
        <EmptyState icon={Inbox} title="Здесь пока пусто" hint="Добавьте первого ребёнка, и он появится в списке." action={<Button><Baby /> Добавить ребёнка</Button>} />
      </Card>
    </AppShell>
  );
}
