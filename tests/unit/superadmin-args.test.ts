import { describe, expect, it } from "vitest";
import { ArgsError, parseSuperadminArgs } from "../../scripts/superadmin/args";

describe("create-superadmin arguments", () => {
  it("normalizes the phone and reads name and password", () => {
    expect(parseSuperadminArgs(["--phone", "8 (701) 555-00-99", "--name", "  Айгерим  "], { SUPERADMIN_PASSWORD: "Secret123!" })).toEqual({
      phone: "+77015550099",
      name: "Айгерим",
      password: "Secret123!",
      resetPassword: false,
    });
  });

  it("accepts --key=value and --reset-password; password is optional", () => {
    expect(parseSuperadminArgs(["--phone=+77015550099", "--reset-password"])).toEqual({
      phone: "+77015550099",
      name: null,
      password: null,
      resetPassword: true,
    });
  });

  it("rejects bad input", () => {
    expect(() => parseSuperadminArgs([])).toThrow(ArgsError);
    expect(() => parseSuperadminArgs(["--phone", "123"])).toThrow(/Неверный телефон/);
    expect(() => parseSuperadminArgs(["--phone"])).toThrow(/значение/);
    expect(() => parseSuperadminArgs(["--phone", "--name", "X"])).toThrow(/значение/);
    expect(() => parseSuperadminArgs(["--phone", "+77015550099", "--name", "A"])).toThrow(/Имя/);
    expect(() => parseSuperadminArgs(["--phone", "+77015550099", "--password", "x"])).toThrow(/SUPERADMIN_PASSWORD/);
    expect(() => parseSuperadminArgs(["--phone", "+77015550099", "--what"])).toThrow(/Неизвестный аргумент/);
    expect(() => parseSuperadminArgs(["--phone", "+77015550099"], { SUPERADMIN_PASSWORD: "short" })).toThrow(/минимум 8/);
  });
});
