import Link from "next/link";
import EventForm from "../../event-form";
import { createEventAction } from "../../actions";
import { toBangkokInputValue } from "@/lib/format";
import { getSettingsSection } from "@/lib/settings";
import { pageUser } from "../../guard";

/** Default start: one week from now, on the hour. */
function defaultStart(): Date {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export default async function NewEventPage() {
  await pageUser("events", "/admin/events/new");
  const { defaultReplayDays } = await getSettingsSection("protection");
  const start = defaultStart();

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Link href="/admin" className="link self-start text-[13px] font-normal">
          ← Events
        </Link>
        <h1 className="text-[28px] leading-[38px] font-bold">สร้าง event</h1>
      </div>
      <EventForm
        action={createEventAction}
        submitLabel="บันทึก"
        cancelHref="/admin"
        initial={{
          title: "",
          slug: "",
          description: "",
          coverUrl: "",
          priceThb: "199",
          startsAt: toBangkokInputValue(start),
          replayDays: String(defaultReplayDays),
          inputType: "SRT",
          inputUrl: "",
          status: "DRAFT",
        }}
      />
    </>
  );
}
