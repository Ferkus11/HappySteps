"use client";

import * as React from "react";
import { maskPhone } from "@/lib/phone";
import { Input } from "./input";

export function PhoneInput({
  defaultValue,
  onChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "defaultValue" | "value"> & {
  defaultValue?: string;
  onChange?: (masked: string) => void;
}) {
  const [value, setValue] = React.useState(defaultValue ? maskPhone(defaultValue) : "");
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="+7 (___) ___-__-__"
      value={value}
      onFocus={() => {
        if (!value) setValue("+7");
      }}
      onChange={(e) => {
        const raw = e.target.value;
        const next = raw.replace(/\D/g, "").length <= 1 ? "+7" : maskPhone(raw);
        setValue(next);
        onChange?.(next);
      }}
      {...props}
    />
  );
}
