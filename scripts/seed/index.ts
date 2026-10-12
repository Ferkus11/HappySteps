import { service } from "./lib";
import { seedE2E } from "./e2e";

async function main() {
  const db = service();
  const args = process.argv.slice(2);
  if (args.includes("--e2e")) {
    await seedE2E(db);
    console.log("✓ e2e fixtures seeded");
    return;
  }
  const { seedDemo } = await import("./demo");
  await seedDemo(db);
  console.log("✓ demo data seeded");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
