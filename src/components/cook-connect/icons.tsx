// One drawn icon set for the whole app: 24-grid, 1.6 stroke, round caps.
// Keeping them here rather than pulling a library in means every glyph in Cook
// Connect shares a weight, and nothing falls back to an emoji.

interface IconProps {
  className?: string;
  size?: number;
}

function Svg({ className, size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const FeedIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h10M4 12h16M4 18h12" />
    <circle cx="19" cy="6" r="1.6" />
  </Svg>
);

export const PeopleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.4 5.4 0 0 0-2-4.2" />
  </Svg>
);

export const BookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v13H6.5A1.5 1.5 0 0 0 5 18.5z" />
    <path d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19" />
    <path d="M9 8h6" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 15.4 8 20 9.2l-3.2 3.6.5 4.9-5.3-2-5.3 2 .5-4.9L4 9.2 8.6 8z" />
  </Svg>
);

export const TrophyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4h8v4a4 4 0 0 1-8 0z" />
    <path d="M8 5.5H5.5A2.5 2.5 0 0 0 8 10M16 5.5h2.5A2.5 2.5 0 0 1 16 10" />
    <path d="M12 12v3M9 20h6M10.5 15h3l.5 5h-4z" />
  </Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 4.5 4.5" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const BookmarkIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <svg
    width={p.size ?? 16}
    height={p.size ?? 16}
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={p.className}
    aria-hidden="true"
  >
    <path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4-6.5 4V5a1 1 0 0 1 1-1z" />
  </svg>
);

export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12.5a7 7 0 0 1-7 7H7l-3 2.5v-4.3A7 7 0 0 1 11 4h2a7 7 0 0 1 7 7z" />
  </Svg>
);

export const VideoIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="12" height="12" rx="2.5" />
    <path d="m15 11 5.2-3v8L15 13z" />
  </Svg>
);

export const VideoOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6.4A2.5 2.5 0 0 1 5.5 6H13a2 2 0 0 1 2 2v2.5M15 14v2a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 15.5V8" />
    <path d="m15 11 5.2-3v8l-2.6-1.5M4 4l16 16" />
  </Svg>
);

export const MicIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="10" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
);

export const MicOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5a3 3 0 0 1 6 0v5M9 9.5V13a3 3 0 0 0 4.7 2.5" />
    <path d="M5.5 11a6.5 6.5 0 0 0 10.2 5.3M12 17.5V21M4 4l16 16" />
  </Svg>
);

export const HangUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 13.5c5-4.5 13-4.5 18 0l-2.4 2.4a1.5 1.5 0 0 1-1.9.2l-1.9-1.3a1.5 1.5 0 0 1-.6-1.6l.3-1.2a10.6 10.6 0 0 0-5 0l.3 1.2a1.5 1.5 0 0 1-.6 1.6l-1.9 1.3a1.5 1.5 0 0 1-1.9-.2z" />
  </Svg>
);

export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12 20 4.5 15 20l-3.4-5.6z" />
    <path d="m11.6 14.4 8.4-9.9" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 5 8 12l6.5 7" />
  </Svg>
);

export const SoundOnIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9.5h3l4-3.5v12l-4-3.5H5z" />
    <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
  </Svg>
);

export const SoundOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9.5h3l4-3.5v12l-4-3.5H5z" />
    <path d="m16 9.5 4 5M20 9.5l-4 5" />
  </Svg>
);

export const SparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M4.9 7.5l2.8 2.8M16.3 13.7l2.8 2.8M3 12h4M17 12h4M4.9 16.5l2.8-2.8M16.3 10.3l2.8-2.8" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Svg>
);

export const FlagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 21V4M6 4.8h10.5l-1.8 3.6 1.8 3.6H6" />
  </Svg>
);

export const HandshakeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 11 3-3 4 1 2-1 2 1 4-1 3 3-3.5 4-2-2-3 2-3-2-2 2z" />
  </Svg>
);

export const BotIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4.5V8M8.5 13v1.5M15.5 13v1.5" />
    <circle cx="12" cy="3.5" r="1.2" />
  </Svg>
);
