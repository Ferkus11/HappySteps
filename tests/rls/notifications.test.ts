import { beforeAll, describe, expect, it } from "vitest";
import { asUser, inTx, rejects } from "./db";
import { fx } from "./fixtures";

let F: Awaited<ReturnType<typeof fx>>;
beforeAll(async () => {
  F = await fx();
});

const ENDPOINT = (s: string) => `https://fcm.googleapis.com/fcm/send/rls-${s}`;
const KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

describe("notifications (bell)", () => {
  it("users see only own rows, mark only own rows read and change nothing but read_at", async () => {
    await inTx(async (c, become) => {
      const ids = (
        await c.query(
          "insert into notifications (kindergarten_id, user_id, type, params, url) values ($1, $2, 'receipt.accepted', '{}', '/payments'), ($1, $3, 'receipt.new', '{}', '/payments') returning id, user_id",
          [F.A, F.users.parent, F.users.accountant],
        )
      ).rows as { id: string; user_id: string }[];
      const own = ids.find((r) => r.user_id === F.users.parent)!.id;
      const other = ids.find((r) => r.user_id === F.users.accountant)!.id;

      await become(F.users.parent);
      expect((await c.query("select 1 from notifications where id = $1", [other])).rowCount).toBe(0);
      expect((await c.query("select distinct user_id from notifications")).rows.map((r) => r.user_id)).toEqual([F.users.parent]);
      expect((await c.query("update notifications set read_at = now() where id = $1", [other])).rowCount).toBe(0);
      expect((await c.query("update notifications set read_at = now() where id = $1", [own])).rowCount).toBe(1);
      for (const col of ["type = 'x'", "user_id = $2", "url = '//evil'", "params = '{}'", "kindergarten_id = null", "deliver_after = now()", "pushed_at = now()"]) {
        expect(await rejects(c, `update notifications set ${col} where id = $1`, col.includes("$2") ? [own, F.users.teacher] : [own]), col).toBe(true);
      }
      expect(await rejects(c, "insert into notifications (user_id, type) values ($1, 'message.new')", [F.users.parent])).toBe(true);
      // No delete policy: nothing is deleted (rows are only marked read).
      await rejects(c, "delete from notifications where id = $1", [own]);
      await become(null);
      await c.query("reset role");
      expect((await c.query("select 1 from notifications where id in ($1, $2)", [own, other])).rowCount).toBe(2);
      expect((await c.query("select read_at from notifications where id = $1", [other])).rows[0].read_at).toBeNull();
    });
  });

  it("another garden's owner sees nothing of garden A's notifications", async () => {
    await inTx(async (c, become) => {
      await c.query("insert into notifications (kindergarten_id, user_id, type) values ($1, $2, 'waitlist.new')", [F.A, F.users.owner]);
      await become(F.users.ownerB);
      expect((await c.query("select 1 from notifications where kindergarten_id = $1", [F.A])).rowCount).toBe(0);
    });
  });

  it("deferred pushes can only be claimed by the server", async () => {
    await inTx(async (c, become) => {
      await become(F.users.owner);
      expect(await rejects(c, "select * from claim_deferred_pushes(10)")).toBe(true);
    });
    await asUser(null, async (c) => {
      expect(await rejects(c, "select * from claim_deferred_pushes(10)")).toBe(true);
    });
  });

  it("notifications are published to Realtime (the bell updates live)", async () => {
    await inTx(async (c) => {
      const r = await c.query("select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'");
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("notification preferences", () => {
  it("own rows only; only `enabled` can be changed", async () => {
    await inTx(async (c, become) => {
      await c.query("insert into notification_preferences (user_id, type, enabled) values ($1, 'message.new', false)", [F.users.teacher]);
      await become(F.users.parent);
      await c.query("insert into notification_preferences (user_id, type, enabled) values ($1, 'receipt.accepted', false)", [F.users.parent]);
      // default user_id = auth.uid()
      await c.query("insert into notification_preferences (type, enabled) values ('club.decision', false)");
      expect((await c.query("select type from notification_preferences order by type")).rows.map((r) => r.type)).toEqual(["club.decision", "receipt.accepted"]);
      expect(await rejects(c, "insert into notification_preferences (user_id, type, enabled) values ($1, 'announcement.new', false)", [F.users.teacher])).toBe(true);
      expect(await rejects(c, "insert into notification_preferences (type, enabled) values ('no.such.type', false)")).toBe(true);
      expect((await c.query("update notification_preferences set enabled = true where user_id = $1", [F.users.teacher])).rowCount).toBe(0);
      expect((await c.query("delete from notification_preferences where user_id = $1", [F.users.teacher])).rowCount).toBe(0);
      expect((await c.query("update notification_preferences set enabled = true where type = 'receipt.accepted'")).rowCount).toBe(1);
      expect(await rejects(c, "update notification_preferences set user_id = $1 where type = 'receipt.accepted'", [F.users.teacher])).toBe(true);
      expect(await rejects(c, "update notification_preferences set type = 'message.new' where type = 'receipt.accepted'")).toBe(true);
      expect((await c.query("delete from notification_preferences where type = 'club.decision'")).rowCount).toBe(1);
      await become(F.users.ownerB);
      expect((await c.query("select 1 from notification_preferences")).rowCount).toBe(0);
    });
  });
});

describe("push subscriptions", () => {
  it("users read and remove only own devices and cannot write subscriptions directly", async () => {
    await inTx(async (c, become) => {
      await c.query("insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $3, $5, 'authsecret123'), ($2, $4, $5, 'authsecret123')", [
        F.users.parent,
        F.users.teacher,
        ENDPOINT("parent"),
        ENDPOINT("teacher"),
        KEY,
      ]);
      await become(F.users.parent);
      expect((await c.query("select endpoint from push_subscriptions")).rows.map((r) => r.endpoint)).toEqual([ENDPOINT("parent")]);
      expect(await rejects(c, "insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, 'authsecret123')", [F.users.parent, ENDPOINT("x"), KEY])).toBe(true);
      expect(await rejects(c, "update push_subscriptions set endpoint = $1", [ENDPOINT("y")])).toBe(true);
      expect((await c.query("delete from push_subscriptions where endpoint = $1", [ENDPOINT("teacher")])).rowCount).toBe(0);
      expect((await c.query("delete from push_subscriptions where endpoint = $1", [ENDPOINT("parent")])).rowCount).toBe(1);
      await become(F.users.teacher);
      expect((await c.query("select 1 from push_subscriptions")).rowCount).toBe(1);
    });
    await asUser(null, async (c) => {
      expect(await rejects(c, "select 1 from push_subscriptions")).toBe(true);
    });
  });
});
