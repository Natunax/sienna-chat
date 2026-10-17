// All icons of the app, drawn on a 20px grid with a 1.5px stroke.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ComposeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 3.5H5.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V11" />
    <path d="M14.6 2.9a1.4 1.4 0 0 1 2 2L10 11.5l-2.6.6.6-2.6z" />
  </Icon>
);

export const SidebarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5" />
    <path d="M7.75 3.75v12.5" />
  </Icon>
);

export const GlobeIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M3 10h14M10 3c2 2.2 2.9 4.6 2.9 7s-.9 4.8-2.9 7c-2-2.2-2.9-4.6-2.9-7S8 5.2 10 3z" />
  </Icon>
);

export const PaperclipIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m15.5 9.5-5.6 5.6a3.5 3.5 0 0 1-5-5L10.8 4a2.3 2.3 0 0 1 3.3 3.3L8.3 13.1a1.2 1.2 0 0 1-1.7-1.7l5.3-5.3" />
  </Icon>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.8}>
    <path d="M10 15v-10M6 9l4-4 4 4" />
  </Icon>
);

/** Stop, as in Claude Code: a ring with a small filled square. */
export const StopIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.25" />
    <rect x="7.6" y="7.6" width="4.8" height="4.8" rx="1" fill="currentColor" stroke="none" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 8 4 4 4-4" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 6 4 4-4 4" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h12M8 6V4.5h4V6M5.5 6l.7 9.2a1.5 1.5 0 0 0 1.5 1.3h4.6a1.5 1.5 0 0 0 1.5-1.3L14.5 6" />
  </Icon>
);

export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.69 8.43 L17.61 8.85 L17.61 11.15 L15.69 11.57 L15.13 12.91 L16.2 14.57 L14.57 16.2 L12.91 15.13 L11.57 15.69 L11.15 17.61 L8.85 17.61 L8.43 15.69 L7.09 15.13 L5.43 16.2 L3.8 14.57 L4.87 12.91 L4.31 11.57 L2.39 11.15 L2.39 8.85 L4.31 8.43 L4.87 7.09 L3.8 5.43 L5.43 3.8 L7.09 4.87 L8.43 4.31 L8.85 2.39 L11.15 2.39 L11.57 4.31 L12.91 4.87 L14.57 3.8 L16.2 5.43 L15.13 7.09Z" />
    <circle cx="10" cy="10" r="2.4" />
  </Icon>
);

export const RetryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 10a6 6 0 1 1-1.8-4.3" />
    <path d="M16.2 3.2v3.5h-3.5" />
  </Icon>
);

export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.3 3.7a1.8 1.8 0 0 1 2.6 2.6l-9 9-3.4.8.8-3.4z" />
    <path d="m11.8 5.2 2.6 2.6" />
  </Icon>
);

export const TerminalIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.25" />
    <path d="m6 8 2.25 2L6 12M10.5 12.5H14" />
  </Icon>
);

export const BranchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="4.75" r="1.75" />
    <circle cx="6" cy="15.25" r="1.75" />
    <circle cx="14" cy="7.25" r="1.75" />
    <path d="M6 6.5v7M14 9c0 3-3.5 3.25-7.4 4.9" />
  </Icon>
);

export const UndoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 5.25 4.25 8.5l3.25 3.25" />
    <path d="M4.5 8.5h7a4.25 4.25 0 0 1 0 8.5H9.5" />
  </Icon>
);

export const CompareIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.75" y="3.75" width="6" height="12.5" rx="1.75" />
    <rect x="11.25" y="3.75" width="6" height="12.5" rx="1.75" />
  </Icon>
);

export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 5.5h8.5M8 10h8.5M8 14.5h8.5" />
    <circle cx="4.5" cy="5.5" r="0.6" fill="currentColor" />
    <circle cx="4.5" cy="10" r="0.6" fill="currentColor" />
    <circle cx="4.5" cy="14.5" r="0.6" fill="currentColor" />
  </Icon>
);

export const ShieldCheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.75 4 5v4.5c0 3.6 2.5 6.5 6 7.75 3.5-1.25 6-4.15 6-7.75V5z" />
    <path d="m7.5 10 1.75 1.75L12.75 8" />
  </Icon>
);

export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 3.5h5M8.5 3.5v4.2L5.8 11h8.4l-2.7-3.3V3.5M10 11v5.5" />
  </Icon>
);

export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.75 6.25a2 2 0 0 1 2-2h3.1l1.8 1.9h5.6a2 2 0 0 1 2 2v6.6a2 2 0 0 1-2 2H4.75a2 2 0 0 1-2-2z" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7" y="7" width="9.5" height="9.5" rx="2" />
    <path d="M13 7V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V11a2 2 0 0 0 2 2H7" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13 13 4 4" />
  </Icon>
);

export const SparkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.5c.5 3.8 3.7 7 7.5 7.5-3.8.5-7 3.7-7.5 7.5-.5-3.8-3.7-7-7.5-7.5 3.8-.5 7-3.7 7.5-7.5z" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6.5v4M10 13.5v.01" />
  </Icon>
);

export const DocumentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11.5 2.75H6a2 2 0 0 0-2 2v10.5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.25z" />
    <path d="M11.5 2.75v4.5H16" />
  </Icon>
);

export const KeyIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="13" r="3.5" />
    <path d="m9.5 10.5 7-7M14 6l2 2M12 8l1.5 1.5" />
  </Icon>
);

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7.5" y="2.5" width="5" height="9.5" rx="2.5" />
    <path d="M4.75 9.5a5.25 5.25 0 0 0 10.5 0" />
    <path d="M10 14.75v2.75" />
  </Icon>
);

export const KeyboardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="5" width="15" height="10" rx="2" />
    <path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M5.5 11h.01M14.5 11h.01M8 11.5h4" />
  </Icon>
);

export const CoinsIcon = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="8" cy="6" rx="4.5" ry="2" />
    <path d="M3.5 6v3c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V6" />
    <path d="M7.5 12.4v1.6c0 1.1 2 2 4.5 2s4.5-.9 4.5-2v-3c0-1-1.6-1.8-3.8-2" />
  </Icon>
);

export const ImageIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="14" height="13" rx="2" />
    <circle cx="7.5" cy="8" r="1.25" />
    <path d="m3.5 14.5 4-4 3 3 2-2 4 4" />
  </Icon>
);

export const ArtifactIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="14" height="13" rx="2" />
    <path d="M3 7.5h14" />
    <path d="m8.25 10.25-1.75 1.75 1.75 1.75M11.75 10.25l1.75 1.75-1.75 1.75" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.5v9M6.5 9 10 12.5 13.5 9" />
    <path d="M4 15.5h12" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 5-5 5 5 5" />
  </Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 10h11" />
  </Icon>
);
