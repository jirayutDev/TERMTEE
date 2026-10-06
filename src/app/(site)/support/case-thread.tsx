import { formatDayTime } from "@/lib/format";
import { attachmentUrl, parseAttachments } from "@/lib/support";

export interface ThreadMessage {
  id: string;
  body: string;
  isStaff: boolean;
  internal: boolean;
  createdAt: Date;
  attachments: unknown;
  author: { name: string | null; email: string };
}

/**
 * Chat-style case thread. `viewer` decides which side is "mine" and how authors are named;
 * callers must already have filtered internal notes out for customers.
 */
export default function CaseThread({ messages, viewer }: { messages: ThreadMessage[]; viewer: "customer" | "staff" }) {
  return (
    <ol className="flex flex-col gap-4" aria-label="ข้อความในเคส">
      {messages.map((m) => {
        const mine = viewer === "customer" ? !m.isStaff : m.isStaff;
        const who =
          viewer === "customer"
            ? m.isStaff
              ? "ทีมงาน TERMTEE"
              : "คุณ"
            : m.isStaff
              ? (m.author.name ?? m.author.email)
              : "ลูกค้า";
        const files = parseAttachments(m.attachments);
        const bubble = m.internal
          ? "border border-dashed border-warning/55 bg-warning/10 text-fg rounded-bl-[4px]"
          : mine
            ? "bg-accent text-white rounded-br-[4px]"
            : "bg-surface-2 text-fg rounded-bl-[4px]";
        return (
          <li key={m.id} className={`flex flex-col gap-1 ${mine && !m.internal ? "items-end" : "items-start"}`}>
            <span className="text-xs text-muted">
              {m.internal && <span className="mr-1.5 font-semibold text-warning">โน้ตภายใน ·</span>}
              {who} · <span className="tabular">{formatDayTime(m.createdAt)}</span>
            </span>
            <div className={`flex max-w-[min(560px,88%)] flex-col gap-2 rounded-2xl px-3.5 py-3 text-[15px] leading-6 ${bubble}`}>
              {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {files.map((f) => (
                    <a
                      key={f.key}
                      href={attachmentUrl(m.id, f.key)}
                      target="_blank"
                      rel="noreferrer"
                      className="block size-24 overflow-hidden rounded-md border border-white/15 bg-bg/60"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={attachmentUrl(m.id, f.key)} alt={f.name} loading="lazy" className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
