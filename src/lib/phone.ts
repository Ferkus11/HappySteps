/** Kazakhstan phone numbers: +7 XXX XXX XX XX. Stored as E.164 "+7XXXXXXXXXX". */

export function phoneDigits(input: string): string {
  let d = input.replace(/\D/g, "");
  if (d.length === 11 && (d.startsWith("8") || d.startsWith("7"))) d = d.slice(1);
  if (d.length > 10) d = d.slice(-10);
  return d;
}

export function normalizePhone(input: string): string | null {
  const d = phoneDigits(input);
  return d.length === 10 ? `+7${d}` : null;
}

/** Progressive mask: +7 (___) ___-__-__ */
export function maskPhone(input: string): string {
  let d: string;
  if (input.trim().startsWith("+7")) d = input.trim().slice(2).replace(/\D/g, "");
  else {
    d = input.replace(/\D/g, "");
    if (d === "7" || d === "8" || (d.length === 11 && /^[78]/.test(d))) d = d.slice(1);
  }
  d = d.slice(0, 10);
  let out = "+7";
  if (d.length > 0) out += ` (${d.slice(0, 3)}`;
  if (d.length >= 3) out += ")";
  if (d.length > 3) out += ` ${d.slice(3, 6)}`;
  if (d.length > 6) out += `-${d.slice(6, 8)}`;
  if (d.length > 8) out += `-${d.slice(8, 10)}`;
  return out;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  return maskPhone(e164);
}

/** Technical e-mail used as the Supabase Auth login (DECISIONS.md D-004). */
export function phoneToAuthEmail(e164: string, domain: string): string {
  return `${e164.replace(/\D/g, "")}@${domain}`;
}

export function whatsappLink(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
