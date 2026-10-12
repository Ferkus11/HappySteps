/**
 * Public holidays of the Republic of Kazakhstan (Labour Code, art. 84–85).
 * Secular holidays falling on a weekend move to the next working day; religious ones do not.
 * Government day-off transfers are announced yearly — the kindergarten adjusts them in settings.
 */
export interface KzHoliday {
  date: string;
  name: { ru: string; kk: string };
}

const KURBAN_AIT: Record<number, string> = {
  2025: "2025-06-06",
  2026: "2026-05-27",
  2027: "2027-05-16",
  2028: "2028-05-05",
};

const FIXED: { md: string; ru: string; kk: string; religious?: boolean }[] = [
  { md: "01-01", ru: "Новый год", kk: "Жаңа жыл" },
  { md: "01-02", ru: "Новый год", kk: "Жаңа жыл" },
  { md: "01-07", ru: "Рождество Христово", kk: "Православиелік Рождество", religious: true },
  { md: "03-08", ru: "Международный женский день", kk: "Халықаралық әйелдер күні" },
  { md: "03-21", ru: "Наурыз мейрамы", kk: "Наурыз мейрамы" },
  { md: "03-22", ru: "Наурыз мейрамы", kk: "Наурыз мейрамы" },
  { md: "03-23", ru: "Наурыз мейрамы", kk: "Наурыз мейрамы" },
  { md: "05-01", ru: "Праздник единства народа Казахстана", kk: "Қазақстан халқының бірлігі мерекесі" },
  { md: "05-07", ru: "День защитника Отечества", kk: "Отан қорғаушы күні" },
  { md: "05-09", ru: "День Победы", kk: "Жеңіс күні" },
  { md: "07-06", ru: "День Столицы", kk: "Астана күні" },
  { md: "08-30", ru: "День Конституции", kk: "Конституция күні" },
  { md: "10-25", ru: "День Республики", kk: "Республика күні" },
  { md: "12-16", ru: "День Независимости", kk: "Тәуелсіздік күні" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

export function kzHolidays(year: number): KzHoliday[] {
  const out: KzHoliday[] = [];
  const taken = new Set<string>();
  for (const h of FIXED) {
    const date = `${year}-${h.md}`;
    out.push({ date, name: { ru: h.ru, kk: h.kk } });
    taken.add(date);
  }
  if (KURBAN_AIT[year]) {
    out.push({ date: KURBAN_AIT[year], name: { ru: "Курбан айт", kk: "Құрбан айт" } });
    taken.add(KURBAN_AIT[year]);
  }
  // Transfer secular holidays that fall on a weekend to the next free working day.
  for (const h of FIXED) {
    if (h.religious) continue;
    const d = new Date(`${year}-${h.md}T00:00:00Z`);
    if (!isWeekend(d)) continue;
    const next = new Date(d);
    do next.setUTCDate(next.getUTCDate() + 1);
    while (isWeekend(next) || taken.has(iso(next)));
    taken.add(iso(next));
    out.push({ date: iso(next), name: { ru: `Выходной (перенос: ${h.ru})`, kk: `Демалыс (ауыстыру: ${h.kk})` } });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
