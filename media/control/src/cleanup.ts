/** CLI: `npm run cleanup -- <eventId> [<eventId>...]` deletes the events' output folders. */
import { isSafeId } from "./config.js";
import { deleteEventOutput } from "./storage.js";

const ids = process.argv.slice(2);
if (ids.length === 0 || !ids.every(isSafeId)) {
  console.error("usage: npm run cleanup -- <eventId> [<eventId>...]");
  process.exit(1);
}
for (const id of ids) {
  await deleteEventOutput(id);
  console.log(`deleted ${id}`);
}
