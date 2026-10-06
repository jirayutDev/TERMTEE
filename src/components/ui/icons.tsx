import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: P) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

/** TERMTEE mark: ticket with a play button. `hole` = background colour of the punch-outs. */
export function LogoMark({ size = 26, hole = "var(--bg)" }: { size?: number; hole?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="1" y="5" width="26" height="18" rx="5" fill="#2B5CFF" />
      <circle cx="1" cy="14" r="3" fill={hole} />
      <circle cx="27" cy="14" r="3" fill={hole} />
      <path d="M11.5 10v8l7-4z" fill="#FFFFFF" />
    </svg>
  );
}

export function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export const PlayIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);
export const PauseIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);
export const VolumeIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M16 9a4.5 4.5 0 0 1 0 6" />
  </svg>
);
export const MuteIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </svg>
);
export const FullscreenIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);
export const ExitFullscreenIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </svg>
);
export const ChevronLeftIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const CalendarIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);
export const ReplayIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7.5V12l3 2" />
  </svg>
);
export const PhoneIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="6.5" y="3" width="11" height="18" rx="2.5" />
    <path d="M10.5 18h3" />
  </svg>
);
export const LaptopIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="5" width="16" height="11" rx="1.5" />
    <path d="M2 19h20" />
  </svg>
);
export const MonitorIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);
export const RotateIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="6.5" width="18" height="11" rx="2.5" />
    <path d="M7 3.5l-2 2M17 20.5l2-2" />
  </svg>
);
export const TicketIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4z" />
    <path d="M14.5 6v12" strokeDasharray="2 2.2" />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.6}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const BanIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.4}>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M6.8 17.2L17.2 6.8" />
  </svg>
);
export const XMarkIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.6}>
    <path d="M7 7l10 10M17 7L7 17" />
  </svg>
);
export const ShareIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M12 15V3M7.5 7.5L12 3l4.5 4.5" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);
export const CopyIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
  </svg>
);
export const EyeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const BankIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 9.5L12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" />
  </svg>
);
export const UploadIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={1.6}>
    <rect x="4" y="3" width="16" height="18" rx="2.5" />
    <path d="M12 15V8M9 10.5L12 7.5l3 3M8.5 17.5h7" />
  </svg>
);
export const ShieldPlayIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={1.6}>
    <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" />
    <path d="M10 9.5v5l4-2.5z" fill="currentColor" />
  </svg>
);
export const ShieldAlertIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" />
    <path d="M12 8.5v4M12 15.5v.5" />
  </svg>
);
export const DevicesIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="5" width="12" height="9" rx="1.5" />
    <path d="M6 17h5" />
    <rect x="16" y="8" width="5.5" height="11" rx="1.5" />
  </svg>
);
export const ClockIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const WarningIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17.5v.5" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const CardIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
    <path d="M2.5 10h19M6.5 15h4" />
  </svg>
);
export const UsersIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5a3.5 3.5 0 0 1 0 7M18.5 14.5A6.5 6.5 0 0 1 21.5 20" />
  </svg>
);
export const ReceiptIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="3" width="14" height="18" rx="2.5" />
    <path d="M8.5 8h7M8.5 11.5h4" />
  </svg>
);
