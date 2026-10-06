import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import EventForm from "../../../event-form";
import { updateEventAction } from "../../../actions";
import { toBangkokInputValue } from "@/lib/format";
import { pageUser } from "../../../guard";

export default async function EditEventPage({ params }: PageProps<"/admin/events/[id]/edit">) {
  const { id } = await params;
  await pageUser("events", `/admin/events/${id}/edit`);
  const event = await db.event.findUnique({ where: { id } });
  if (!event) notFound();

  const statusEditable = event.status === "DRAFT" || event.status === "SCHEDULED";

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Link href={`/admin/events/${id}`} className="link self-start text-[13px] font-normal">
          ← {event.title}
        </Link>
        <h1 className="text-[28px] leading-[38px] font-bold">แก้ไข event</h1>
      </div>
      <EventForm
        action={updateEventAction.bind(null, id)}
        submitLabel="บันทึก"
        cancelHref={`/admin/events/${id}`}
        statusEditable={statusEditable}
        mediaEditable={event.status !== "LIVE"}
        initial={{
          title: event.title,
          slug: event.slug,
          description: event.description ?? "",
          coverUrl: event.coverUrl ?? "",
          priceThb: (event.priceSatang / 100).toString(),
          startsAt: toBangkokInputValue(event.startsAt),
          replayDays: String(event.replayDays),
          inputType: event.inputType,
          inputUrl: event.inputUrl ?? "",
          status: event.status,
        }}
      />
    </>
  );
}
