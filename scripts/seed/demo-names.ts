/**
 * Kazakh and Russian names for the demo: families (surname, parents, patronymic style) and children.
 * Kazakh families use either the Russian-style patronymic (-ович / -овна) or the Kazakh one (-ұлы / -қызы),
 * as both are common in Kazakhstan.
 */
import type { Rng } from "./demo-lib";

export type Ethnicity = "kz" | "ru";
export type Gender = "m" | "f";

const KZ_SURNAMES = [
  "Ахметов", "Жумабаев", "Нурланов", "Касымов", "Абдрахманов", "Есенов", "Жаксылыков", "Мухамедиев", "Оспанов", "Сарсенбаев",
  "Тулегенов", "Утепов", "Искаков", "Кенжебаев", "Байжанов", "Алимжанов", "Темирбеков", "Ибраев", "Садыков", "Даулетов",
  "Ержанов", "Мусин", "Калиев", "Габдуллин", "Омаров", "Рахимов", "Нуртаев", "Жунусов", "Смагулов", "Бекетов",
  "Шайхин", "Қалиев", "Әбенов", "Серікбаев", "Мамыров", "Каримов", "Абилов", "Тажибаев", "Кайыргельдин", "Дюсенов",
  "Сейткали", "Ермекбай", "Жақсыбай", "Толеген",
];
const RU_SURNAMES = [
  "Иванов", "Смирнов", "Кузнецов", "Попов", "Васильев", "Петров", "Соколов", "Михайлов", "Новиков", "Фёдоров",
  "Морозов", "Волков", "Алексеев", "Лебедев", "Семёнов", "Егоров", "Козлов", "Степанов", "Николаев", "Орлов",
  "Андреев", "Макаров", "Никитин", "Захаров", "Зайцев", "Борисов", "Яковлев", "Григорьев", "Романов", "Сергеев",
  "Ким", "Пак", "Цой", "Шевченко", "Бондаренко", "Мельник", "Гончаренко", "Литвиненко",
];
/** Surnames that do not change with gender. */
const INDECLINABLE = /(ко|ук|юк|ник|ли|бай|ген|^Ким|^Пак|^Цой)$/;

const KZ_MEN = [
  "Ерлан", "Марат", "Нурлан", "Серик", "Асхат", "Бауыржан", "Данияр", "Ержан", "Талгат", "Канат", "Арман", "Руслан",
  "Айдар", "Бекзат", "Жандос", "Ринат", "Азамат", "Мурат", "Дастан", "Ербол", "Нуржан", "Тимур", "Аскар", "Санжар",
  "Кайрат", "Болат", "Ерик", "Алмас", "Самат", "Даурен",
];
const RU_MEN = ["Сергей", "Андрей", "Алексей", "Дмитрий", "Олег", "Игорь", "Владимир", "Максим", "Денис", "Роман", "Виктор", "Антон", "Константин", "Николай", "Артур", "Вадим"];
const KZ_WOMEN = [
  "Айгерим", "Жанар", "Асель", "Динара", "Гульнара", "Мадина", "Айнур", "Сауле", "Алия", "Гульмира", "Жанна", "Камила",
  "Анар", "Ботагоз", "Айжан", "Назерке", "Акмарал", "Салтанат", "Индира", "Арайлым", "Мөлдір", "Жансая", "Әсем", "Гаухар",
];
const RU_WOMEN = ["Елена", "Ольга", "Анна", "Наталья", "Татьяна", "Ирина", "Екатерина", "Юлия", "Светлана", "Мария", "Анастасия", "Ксения", "Дарья", "Виктория", "Оксана", "Людмила"];

const KZ_BOYS = [
  "Алихан", "Арман", "Нурислам", "Айсултан", "Ерасыл", "Темирлан", "Алдияр", "Ансар", "Санжар", "Әлинұр", "Мирас", "Ернур",
  "Бексултан", "Аян", "Даниял", "Рамазан", "Ислам", "Абылай", "Әмір", "Тамерлан", "Дамир", "Арсен", "Нұрали", "Батыр",
];
const KZ_GIRLS = [
  "Айлин", "Аружан", "Айым", "Томирис", "Амина", "Медина", "Айша", "Дана", "Камила", "Асылым", "Жансая", "Аяла",
  "Інжу", "Сафия", "Мадина", "Айзере", "Нұрай", "Алуа", "Дильназ", "Ясмина", "Зере", "Айару", "Әйгерім", "Мерей",
];
const RU_BOYS = ["Михаил", "Артём", "Максим", "Иван", "Александр", "Дмитрий", "Матвей", "Тимофей", "Лев", "Марк", "Егор", "Даниил", "Кирилл", "Фёдор", "Роман", "Савелий"];
const RU_GIRLS = ["Анна", "Мария", "София", "Алиса", "Варвара", "Ева", "Полина", "Виктория", "Василиса", "Вероника", "Арина", "Ульяна", "Милана", "Ксения"];

export function genderSurname(male: string, g: Gender): string {
  if (g === "m" || INDECLINABLE.test(male)) return male;
  if (male.endsWith("ий")) return `${male.slice(0, -2)}ая`;
  return `${male}а`; // -ов/-ев/-ин/-ын → -ова/-ева/-ина/-ына
}

/** Russian-style patronymic from a father's first name. */
export function patronymicRu(father: string, g: Gender): string {
  let stem: string;
  if (father.endsWith("ий")) stem = `${father.slice(0, -2)}иев`; // Дмитрий → Дмитриев-
  else if (father.endsWith("ей")) stem = `${father.slice(0, -2)}еев`; // Сергей → Сергеев-
  else if (father.endsWith("ай")) stem = `${father.slice(0, -2)}аев`; // Николай → Николаев-
  else stem = `${father}ов`;
  return g === "m" ? `${stem}ич` : `${stem}на`;
}
/** Kazakh patronymic: Ерлан → Ерланұлы / Ерланқызы. */
export function patronymicKz(father: string, g: Gender): string {
  return g === "m" ? `${father}ұлы` : `${father}қызы`;
}

export interface Family {
  ethnicity: Ethnicity;
  /** male form */
  surname: string;
  father: { first: string; patronymic: string };
  mother: { first: string; patronymic: string; surname: string };
  kzPatronymic: boolean;
}

export function makeFamily(rng: Rng, used: Set<string>): Family {
  const ethnicity: Ethnicity = rng.chance(0.62) ? "kz" : "ru";
  let surname = "";
  for (let i = 0; i < 50; i++) {
    surname = rng.pick(ethnicity === "kz" ? KZ_SURNAMES : RU_SURNAMES);
    if (!used.has(surname) || i > 40) break;
  }
  used.add(surname);
  const kzPatronymic = ethnicity === "kz" && rng.chance(0.4);
  const fatherFirst = rng.pick(ethnicity === "kz" ? KZ_MEN : RU_MEN);
  const grandFather = rng.pick(ethnicity === "kz" ? KZ_MEN : RU_MEN);
  const motherFather = rng.pick(ethnicity === "kz" ? KZ_MEN : RU_MEN);
  const pat = (f: string, g: Gender) => (kzPatronymic ? patronymicKz(f, g) : patronymicRu(f, g));
  // Some mothers keep their maiden name.
  const motherSurname = rng.chance(0.15) ? genderSurname(rng.pick(ethnicity === "kz" ? KZ_SURNAMES : RU_SURNAMES), "f") : genderSurname(surname, "f");
  return {
    ethnicity,
    surname,
    kzPatronymic,
    father: { first: fatherFirst, patronymic: pat(grandFather, "m") },
    mother: { first: rng.pick(ethnicity === "kz" ? KZ_WOMEN : RU_WOMEN), patronymic: pat(motherFather, "f"), surname: motherSurname },
  };
}

export function fatherName(f: Family) {
  return `${f.surname} ${f.father.first} ${f.father.patronymic}`;
}
export function motherName(f: Family) {
  return `${f.mother.surname} ${f.mother.first} ${f.mother.patronymic}`;
}

export function childName(rng: Rng, f: Family, g: Gender, taken: Set<string>): string {
  const pool = f.ethnicity === "kz" ? (g === "m" ? KZ_BOYS : KZ_GIRLS) : g === "m" ? RU_BOYS : RU_GIRLS;
  const pat = f.kzPatronymic ? patronymicKz(f.father.first, g) : patronymicRu(f.father.first, g);
  for (let i = 0; i < 30; i++) {
    const name = `${genderSurname(f.surname, g)} ${rng.pick(pool)} ${pat}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const name = `${genderSurname(f.surname, g)} ${rng.pick(pool)} ${pat}`;
  taken.add(name);
  return name;
}

/** A staff member's full name. */
export function personName(rng: Rng, g: Gender, ethnicity: Ethnicity = rng.chance(0.65) ? "kz" : "ru"): string {
  const surname = genderSurname(rng.pick(ethnicity === "kz" ? KZ_SURNAMES : RU_SURNAMES), g);
  const first = rng.pick(ethnicity === "kz" ? (g === "m" ? KZ_MEN : KZ_WOMEN) : g === "m" ? RU_MEN : RU_WOMEN);
  const father = rng.pick(ethnicity === "kz" ? KZ_MEN : RU_MEN);
  const pat = ethnicity === "kz" && rng.chance(0.3) ? patronymicKz(father, g) : patronymicRu(father, g);
  return `${surname} ${first} ${pat}`;
}
