/**
 * Clubs fixtures (stage 4A). Re-runnable: the four clubs are found by name and refreshed; their enrollments are
 * rebuilt from scratch on every run.
 * - «Шахматы» 4–7 лет, педагог кружка +77010000005, 1 место — занято Мишей (полный кружок, сценарий 6);
 * - «Рисование» 3–6 лет, тот же педагог, 8 мест: Сабина и Миша (родитель +77010000008) записаны, Айлин — заявка на
 *   рассмотрении; с фото;
 * - «Английский язык» 5–7 лет, без педагога, 10 мест, пусто;
 * - «Танцы» 2–3 года — не подходит по возрасту ни одному ребёнку родителя.
 */
import { deflateSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./lib";

interface Ids {
  users: Record<string, string>;
  kindergartens: { A: string };
}

export const CLUB_NAMES = { chess: "Шахматы", art: "Рисование", english: "Английский язык", dance: "Танцы" } as const;

/** A small soft-gradient PNG (no binary assets in the repo for a placeholder photo). */
export function gradientPng(w = 480, h = 270, from: [number, number, number] = [234, 245, 253], to: [number, number, number] = [214, 51, 108]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = Math.min(1, (x / w) * 0.6 + (y / h) * 0.4) * 0.55;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(from[i] + (to[i] - from[i]) * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export async function seedClubs(db: SupabaseClient, ids: Ids) {
  const A = ids.kindergartens.A;
  const teacher = ids.users.clubTeacher;
  const { data: kids } = await db.from("children").select("id, full_name").eq("kindergarten_id", A);
  const child = (first: string) => (kids ?? []).find((k) => (k.full_name as string).split(" ")[1] === first)?.id as string;

  const photoPath = `${A}/clubs/seed-art.png`;
  must(await db.storage.from("club-photos").upload(photoPath, gradientPng(), { contentType: "image/png", upsert: true }), "club photo");

  const defs = [
    { name: CLUB_NAMES.chess, description: "Учимся думать на несколько ходов вперёд: фигуры, простые комбинации, турниры в группе.", teacher_id: teacher, age_from: 4, age_to: 7, capacity: 1, place: "Кабинет 2", photo_path: null,
      schedule: [{ day: 2, start: "16:00", end: "16:45" }, { day: 4, start: "16:00", end: "16:45" }] },
    { name: CLUB_NAMES.art, description: "Гуашь, акварель и пластилин. Работы детей — на выставке в холле.", teacher_id: teacher, age_from: 3, age_to: 6, capacity: 8, place: "Изостудия", photo_path: photoPath,
      schedule: [{ day: 1, start: "15:30", end: "16:15" }, { day: 3, start: "15:30", end: "16:15" }] },
    { name: CLUB_NAMES.english, description: "Песни, игры и первые слова на английском.", teacher_id: null, age_from: 5, age_to: 7, capacity: 10, place: "Музыкальный зал", photo_path: null,
      schedule: [{ day: 5, start: "10:00", end: "10:40" }] },
    { name: CLUB_NAMES.dance, description: "Ритмика и танцы для самых маленьких.", teacher_id: null, age_from: 2, age_to: 3, capacity: 12, place: "Спортзал", photo_path: null,
      schedule: [{ day: 2, start: "11:00", end: "11:30" }] },
  ];
  const clubIds: Record<string, string> = {};
  for (const d of defs) {
    const { data } = await db.from("clubs").select("id").eq("kindergarten_id", A).eq("name", d.name).maybeSingle();
    if (data) {
      must(await db.from("club_enrollments").delete().eq("club_id", data.id).select("id"), "clear enrollments");
      must(await db.from("clubs").update(d).eq("id", data.id).select("id"), "update club");
      clubIds[d.name] = data.id;
    } else {
      clubIds[d.name] = must(await db.from("clubs").insert({ ...d, kindergarten_id: A }).select("id").single(), "club").id as string;
    }
  }
  const row = (club: string, first: string, status: "active" | "requested") => ({
    kindergarten_id: A,
    club_id: clubIds[club],
    child_id: child(first),
    status,
    started_on: status === "active" ? new Date().toISOString() : null,
  });
  must(
    await db.from("club_enrollments").insert([
      row(CLUB_NAMES.chess, "Миша", "active"),
      row(CLUB_NAMES.art, "Сабина", "active"),
      row(CLUB_NAMES.art, "Миша", "active"),
      row(CLUB_NAMES.art, "Айлин", "requested"),
    ]).select("id"),
    "enrollments",
  );
  return clubIds;
}
