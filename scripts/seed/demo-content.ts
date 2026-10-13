/** Texts of the demo: groups, clubs, menus, announcements, events, chat conversations. User content is Russian (SPEC §8). */

export interface GroupDef {
  key: string;
  name: string;
  age: string;
  capacity: number;
  color: string;
  /** birth dates of the children: [from, to] */
  born: [string, string];
  /** active children now */
  size: number;
  fee: number;
}

export const GROUPS: GroupDef[] = [
  { key: "balapan", name: "Балапан", age: "Ясельная (1,5–2 года)", capacity: 14, color: "#F2A65A", born: ["2024-03-01", "2024-12-20"], size: 13, fee: 95000 },
  { key: "botakan", name: "Ботақан", age: "Первая младшая (2–3 года)", capacity: 18, color: "#E5739A", born: ["2023-04-01", "2024-02-28"], size: 18, fee: 90000 },
  { key: "kunshuak", name: "Күншуақ", age: "Вторая младшая (3–4 года)", capacity: 20, color: "#4FA3E0", born: ["2022-04-01", "2023-03-31"], size: 20, fee: 85000 },
  { key: "zhuldyz", name: "Жұлдыз", age: "Средняя (4–5 лет)", capacity: 22, color: "#7C6CD6", born: ["2021-04-01", "2022-03-31"], size: 21, fee: 85000 },
  { key: "raduga", name: "Радуга", age: "Старшая (5–6 лет)", capacity: 24, color: "#2E9E7A", born: ["2020-09-15", "2021-03-31"], size: 22, fee: 80000 },
  { key: "zerde", name: "Зерде", age: "Предшкольная (6 лет)", capacity: 25, color: "#E8A33D", born: ["2019-10-01", "2020-09-14"], size: 24, fee: 80000 },
];

export const ALLERGIES = [
  "орехи", "мёд", "цитрусовые", "молоко (лактоза)", "яйца", "клубника", "рыба", "глютен", "шоколад", "арахис", "киви",
];
export const MEDICAL_NOTES = [
  "Аллергический ринит весной, ингалятор у мамы",
  "Носит очки, садить ближе к доске",
  "После ветрянки — справка от педиатра в папке",
  "Не есть сырые овощи до 1 ноября (рекомендация врача)",
];

export interface ClubDef {
  key: string;
  name: string;
  description: string;
  ageFrom: number;
  ageTo: number;
  capacity: number;
  place: string;
  schedule: { day: number; start: string; end: string }[];
  colors: [[number, number, number], [number, number, number]];
}

export const CLUBS: ClubDef[] = [
  {
    key: "chess",
    name: "Шахматы",
    description: "Знакомимся с фигурами, учимся думать на несколько ходов вперёд. Раз в месяц — турнир в группе с медалями.",
    ageFrom: 4, ageTo: 7, capacity: 8, place: "Кабинет 2",
    schedule: [{ day: 2, start: "15:30", end: "16:15" }, { day: 4, start: "15:30", end: "16:15" }],
    colors: [[238, 242, 248], [92, 107, 140]],
  },
  {
    key: "art",
    name: "Рисование",
    description: "Гуашь, акварель, пластилин и аппликация. Работы детей — на выставке в холле каждую пятницу.",
    ageFrom: 3, ageTo: 6, capacity: 12, place: "Изостудия",
    schedule: [{ day: 1, start: "15:30", end: "16:10" }, { day: 3, start: "15:30", end: "16:10" }],
    colors: [[255, 243, 230], [214, 51, 108]],
  },
  {
    key: "english",
    name: "Английский язык",
    description: "Песни, игры и первые слова на английском. Маленькие группы, занятия в игровой форме.",
    ageFrom: 4, ageTo: 7, capacity: 10, place: "Музыкальный зал",
    schedule: [{ day: 2, start: "10:30", end: "11:00" }, { day: 5, start: "10:30", end: "11:00" }],
    colors: [[234, 245, 253], [79, 163, 224]],
  },
  {
    key: "dance",
    name: "Ритмика и танцы",
    description: "Музыкальные игры, ритмика и казахские народные танцы. Готовим номера к утренникам.",
    ageFrom: 2, ageTo: 5, capacity: 15, place: "Музыкальный зал",
    schedule: [{ day: 1, start: "10:00", end: "10:30" }, { day: 4, start: "10:00", end: "10:30" }],
    colors: [[248, 240, 252], [124, 108, 214]],
  },
  {
    key: "football",
    name: "Футбол",
    description: "Мяч, координация и командная игра. В тёплую погоду — на площадке, в холод — в спортзале.",
    ageFrom: 5, ageTo: 7, capacity: 12, place: "Спортзал",
    schedule: [{ day: 3, start: "16:30", end: "17:15" }, { day: 5, start: "16:30", end: "17:15" }],
    colors: [[236, 248, 241], [46, 158, 122]],
  },
];

type Dish = [string, string];
export interface DayMenu {
  breakfast: Dish[];
  second_breakfast: Dish[];
  lunch: Dish[];
  snack: Dish[];
}
export const MENUS: DayMenu[] = [
  {
    breakfast: [["Каша овсяная молочная", "овсяные хлопья, молоко, сливочное масло, сахар"], ["Чай с молоком", "чай, молоко"]],
    second_breakfast: [["Яблоко", "яблоко свежее"]],
    lunch: [["Суп куриный с вермишелью", "курица, вермишель, морковь, лук"], ["Плов с говядиной", "рис, говядина, морковь, лук"], ["Компот из сухофруктов", "курага, изюм, яблоки"]],
    snack: [["Сырники со сметаной", "творог, яйцо, мука, сметана"], ["Кефир", "кефир 2,5%"]],
  },
  {
    breakfast: [["Каша рисовая молочная", "рис, молоко, сахар, сливочное масло"], ["Бутерброд с сыром", "хлеб, сливочное масло, сыр"]],
    second_breakfast: [["Банан", "банан"]],
    lunch: [["Борщ со сметаной", "свёкла, капуста, картофель, говядина, сметана"], ["Котлета с картофельным пюре", "говядина, картофель, молоко"], ["Кисель ягодный", "смородина, крахмал, сахар"]],
    snack: [["Булочка с изюмом", "мука, изюм, молоко"], ["Молоко", "молоко 3,2%"]],
  },
  {
    breakfast: [["Омлет паровой", "яйцо, молоко"], ["Какао", "какао, молоко, сахар"]],
    second_breakfast: [["Груша", "груша"]],
    lunch: [["Суп гороховый", "горох, картофель, морковь, лук"], ["Тефтели с гречкой", "говядина, рис, гречка"], ["Сок яблочный", "сок 100%"]],
    snack: [["Запеканка творожная", "творог, манка, яйцо, сметана"], ["Чай", "чай, сахар"]],
  },
  {
    breakfast: [["Каша пшённая с тыквой", "пшено, тыква, молоко, сливочное масло"], ["Чай с лимоном", "чай, лимон, сахар"]],
    second_breakfast: [["Апельсин", "апельсин"]],
    lunch: [["Сорпа с лапшой", "говядина, домашняя лапша, лук"], ["Бешбармак детский", "говядина, тесто, лук, бульон"], ["Компот из яблок", "яблоки, сахар"]],
    snack: [["Баурсаки с молоком", "мука, молоко, дрожжи"], ["Айран", "айран"]],
  },
  {
    breakfast: [["Каша манная", "манная крупа, молоко, сахар"], ["Хлеб с маслом", "хлеб, сливочное масло"]],
    second_breakfast: [["Мандарин", "мандарин"]],
    lunch: [["Рассольник", "перловка, огурцы, картофель, говядина"], ["Рыбные котлеты с рисом", "минтай, рис, лук"], ["Компот из кураги", "курага, сахар"]],
    snack: [["Оладьи с яблочным пюре", "мука, кефир, яйцо, яблоко"], ["Ряженка", "ряженка"]],
  },
  {
    breakfast: [["Каша гречневая молочная", "гречка, молоко, сливочное масло"], ["Сыр", "сыр твёрдый"]],
    second_breakfast: [["Йогурт", "йогурт питьевой"]],
    lunch: [["Суп с фрикадельками", "говядина, картофель, морковь"], ["Макароны с курицей в соусе", "макароны, курица, сливки"], ["Морс клюквенный", "клюква, сахар"]],
    snack: [["Блинчики с творогом", "мука, молоко, яйцо, творог"], ["Чай", "чай, сахар"]],
  },
  {
    breakfast: [["Каша кукурузная", "кукурузная крупа, молоко, сахар"], ["Какао", "какао, молоко"]],
    second_breakfast: [["Яблоко запечённое", "яблоко, корица"]],
    lunch: [["Щи из свежей капусты", "капуста, картофель, говядина"], ["Лагман домашний", "лапша, говядина, перец, морковь"], ["Компот", "сухофрукты"]],
    snack: [["Печенье овсяное и молоко", "овсяное печенье, молоко"]],
  },
  {
    breakfast: [["Сырники с джемом", "творог, яйцо, мука, джем"], ["Чай с молоком", "чай, молоко"]],
    second_breakfast: [["Киви", "киви"]],
    lunch: [["Суп-лапша домашняя", "курица, лапша, морковь"], ["Голубцы ленивые", "капуста, рис, говядина, томат"], ["Сок томатный", "сок"]],
    snack: [["Шарлотка", "яблоки, мука, яйцо"], ["Кефир", "кефир"]],
  },
];

export interface AnnouncementDef {
  key: string;
  title: string;
  body: string;
  author: "owner" | "head" | "teacher";
  audience: "all" | "groups" | "staff";
  groups?: string[];
  important?: boolean;
  daysAgo: number;
  time: string;
  /** share of the audience that has read it */
  readShare: number;
  photo?: boolean;
  pdf?: string;
}

export const ANNOUNCEMENTS: AnnouncementDef[] = [
  {
    key: "matinee", title: "Осенний праздник «Алтын күз»", author: "head", audience: "all", important: true, daysAgo: 1, time: "17:40", readShare: 0.58, photo: true,
    body: "Дорогие родители!\n\nВ пятницу через неделю в 10:00 в музыкальном зале пройдёт осенний праздник «Алтын күз». Дети покажут песни и танцы, которые разучили с музыкальным руководителем.\n\nДевочкам — платья осенних цветов, мальчикам — белые рубашки. Родители могут прийти к 09:50, вход — через центральный холл.",
  },
  {
    key: "flu", title: "Вакцинация против гриппа", author: "head", audience: "all", important: true, daysAgo: 6, time: "12:10", readShare: 0.86,
    body: "С 20 октября в саду работает медсестра городской поликлиники №5. Прививка — только с письменного согласия родителей. Бланк согласия выдаёт воспитатель, вернуть его нужно до пятницы.",
  },
  {
    key: "payment", title: "Оплата за октябрь — до 10 числа", author: "owner", audience: "all", daysAgo: 12, time: "09:00", readShare: 0.93,
    body: "Напоминаем: оплата за месяц — до 10 числа. Реквизиты и Kaspi-номер — в разделе «Оплата». После перевода загрузите, пожалуйста, чек — бухгалтер подтвердит его в течение дня.",
  },
  {
    key: "change", title: "Принесите сменную одежду", author: "teacher", audience: "groups", groups: ["zhuldyz"], daysAgo: 2, time: "18:20", readShare: 0.72,
    body: "На этой неделе много гуляем и рисуем красками. Положите, пожалуйста, в шкафчик сменные штаны, футболку и носки.",
  },
  {
    key: "photo", title: "Фотосессия в группе", author: "teacher", audience: "groups", groups: ["zhuldyz", "raduga"], daysAgo: 8, time: "16:00", readShare: 0.8,
    body: "В среду в группах «Жұлдыз» и «Радуга» — осенняя фотосессия. Образцы фото и цены — в приложенном файле. Участие по желанию.",
    pdf: "Фотосессия — цены.pdf",
  },
  {
    key: "meeting", title: "Планёрка в пятницу", author: "head", audience: "staff", daysAgo: 3, time: "15:00", readShare: 0.75,
    body: "Коллеги, планёрка в пятницу в 13:30 в методическом кабинете. Обсуждаем подготовку к «Алтын күз» и график медосмотра.",
  },
  {
    key: "medcheck", title: "Медосмотр сотрудников до 30 октября", author: "owner", audience: "staff", important: true, daysAgo: 9, time: "10:30", readShare: 0.9,
    body: "У нескольких сотрудников заканчивается срок медкнижки. Пройдите медосмотр до 30 октября и загрузите новую медкнижку в раздел «Документы».",
  },
  {
    key: "newyear", title: "С 1 сентября — новый учебный год", author: "owner", audience: "all", daysAgo: 43, time: "10:00", readShare: 0.97,
    body: "Дорогие семьи! Поздравляем с началом нового учебного года. Расписание кружков и режим дня — в разделах «Кружки» и «События». Добро пожаловать новым малышам в группах «Балапан» и «Ботақан»!",
  },
  {
    key: "sanitary", title: "14 августа — санитарный день", author: "head", audience: "all", daysAgo: 62, time: "11:00", readShare: 0.95,
    body: "В пятницу, 14 августа, сад не работает — проводим генеральную уборку и обработку помещений. Спасибо за понимание!",
  },
  {
    key: "summer", title: "Летний режим", author: "head", audience: "all", daysAgo: 88, time: "09:30", readShare: 0.96,
    body: "Летом больше гуляем: панамки и бутылочка воды обязательны. Дневной сон — с 13:00 до 15:00.",
  },
];

export interface EventDef {
  title: string;
  kind: "matinee" | "parent_meeting" | "holiday" | "day_off" | "excursion" | "other";
  audience: "all" | "groups" | "staff";
  groups?: string[];
  /** days from today */
  offset: number;
  /** exact date instead of offset */
  date?: string;
  start?: string;
  end?: string;
  place?: string;
  description?: string;
  author: "owner" | "head" | "teacher";
}

export const EVENTS: EventDef[] = [
  { title: "Осенний праздник «Алтын күз»", kind: "matinee", audience: "all", offset: 10, start: "10:00", end: "11:00", place: "Музыкальный зал", author: "head",
    description: "Песни, танцы и стихи об осени. Родители — к 09:50." },
  { title: "Родительское собрание", kind: "parent_meeting", audience: "groups", groups: ["zhuldyz"], offset: 2, start: "18:30", end: "19:30", place: "Группа «Жұлдыз»", author: "teacher",
    description: "Итоги адаптации, план на осень, вопросы по кружкам." },
  { title: "Родительское собрание", kind: "parent_meeting", audience: "groups", groups: ["zerde"], offset: 4, start: "18:30", end: "19:30", place: "Группа «Зерде»", author: "head",
    description: "Подготовка к школе: что нужно уметь к весне." },
  { title: "Экскурсия в Центральный парк", kind: "excursion", audience: "groups", groups: ["raduga", "zerde"], offset: 7, start: "10:00", end: "12:00", place: "Центральный парк культуры и отдыха", author: "head",
    description: "Едем на автобусе сада. Тёплая одежда и удобная обувь." },
  { title: "Педсовет", kind: "other", audience: "staff", offset: 3, start: "13:30", end: "15:00", place: "Методический кабинет", author: "owner" },
  { title: "День Республики — сад не работает", kind: "holiday", audience: "all", offset: 0, date: "", author: "head" },
  { title: "Театр кукол «Қуыршақ»", kind: "other", audience: "all", offset: 17, start: "11:00", end: "11:40", place: "Музыкальный зал", author: "head" },
  { title: "Осенняя ярмарка", kind: "other", audience: "all", offset: -11, start: "16:00", end: "18:00", place: "Двор сада", author: "head",
    description: "Поделки детей и выпечка родителей. Вырученные деньги — на новые книги для групп." },
  { title: "День знаний", kind: "matinee", audience: "all", offset: 0, date: "09-01", start: "09:30", end: "10:30", place: "Музыкальный зал", author: "head" },
  { title: "Проводы в школу", kind: "matinee", audience: "groups", groups: ["zerde"], offset: 0, date: "08-27", start: "10:00", end: "11:30", place: "Музыкальный зал", author: "head" },
  { title: "Санитарный день", kind: "day_off", audience: "all", offset: 0, date: "08-14", author: "head",
    description: "Сад не работает: генеральная уборка." },
  { title: "Медосмотр сотрудников", kind: "other", audience: "staff", offset: 9, start: "09:00", end: "12:00", place: "Поликлиника №5", author: "owner" },
];

/** Group chat lines: [who, text, minutes ago]. who: teacher / parentN / head. */
export const GROUP_CHAT: [string, string, number][] = [
  ["teacher", "Доброе утро! Сегодня идём на прогулку в парк — оденьте, пожалуйста, детей потеплее 🍂", 60 * 24 * 6 + 120],
  ["parent1", "Спасибо, поняли! Шапку положим в шкафчик.", 60 * 24 * 6 + 95],
  ["parent2", "А до скольки сегодня прогулка?", 60 * 24 * 6 + 80],
  ["teacher", "До 11:30, потом обед.", 60 * 24 * 6 + 75],
  ["head", "Напоминаю: в пятницу родительское собрание в 18:30.", 60 * 24 * 4 + 300],
  ["parent3", "Подскажите, нужна ли сменка на праздник?", 60 * 24 * 2 + 200],
  ["teacher", "Да, чешки обязательно. Костюмы — к четвергу.", 60 * 24 * 2 + 170],
  ["parent1", "Спасибо большое за сегодняшнее занятие, дома только о нём и рассказывает 😊", 60 * 24 + 260],
  ["teacher", "Все на месте, завтракаем! Фото с прогулки — ниже 👇", 180],
  ["parent4", "Какие молодцы!", 150],
  ["parent2", "Завтра ребёнка заберёт бабушка, предупреждаю заранее.", 40],
];

export const STAFF_CHAT: [string, string, number][] = [
  ["head", "Коллеги, доброе утро! Напоминаю про планёрку в пятницу в 13:30.", 60 * 24 * 3 + 120],
  ["cook", "Завтра на обед бешбармак, на полдник — баурсаки с айраном.", 60 * 24 * 2 + 60],
  ["teacher", "Спасибо! У Тимура из «Жұлдыз» аллергия на мёд — помним 🙏", 60 * 24 * 2 + 40],
  ["accountant", "Чеки за октябрь почти все проверены, должникам напомню лично.", 60 * 24 + 300],
  ["owner", "Отличная работа на ярмарке, спасибо всем!", 60 * 24 + 120],
  ["club", "Шахматы во вторник переносим на 16:00 — турнир в группе «Радуга».", 300],
  ["head", "Медосмотр — до 30 октября, не забудьте загрузить медкнижки.", 90],
];
