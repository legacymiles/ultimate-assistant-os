"use client";

import { Icon } from "../icons";
import { relativeTime } from "@/lib/utils";
import type { Item } from "@/lib/recall/types";

function KindIcon({ kind }: { kind: Item["kind"] }) {
  const p = { width: 14, height: 14 };
  switch (kind) {
    case "link":
      return <Icon.Link {...p} />;
    case "image":
      return <Icon.Image {...p} />;
    case "drive":
      return <Icon.Database {...p} />;
    default:
      return <Icon.File {...p} />;
  }
}

interface Props {
  item: Item;
  folderPath: string;
  onOpen: (item: Item) => void;
  onTagClick?: (tag: string) => void;
}

export function ItemCard({ item, folderPath, onOpen, onTagClick }: Props) {
  const thumb = item.kind === "image" ? item.attachment?.url : undefined;

  return (
    <button
      onClick={() => onOpen(item)}
      className="group flex w-full flex-col gap-2 rounded-2xl border border-line bg-panel p-3.5 text-left transition hover:border-brand/50 hover:bg-panel-2"
    >
      <div className="flex items-start gap-3">
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-ink-faint">
            <KindIcon kind={item.kind} />
            <span className="truncate text-[11px]">{folderPath}</span>
          </div>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-ink">{item.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">
            {item.summary || item.body}
          </p>
        </div>
      </div>
      {item.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {item.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              onClick={
                onTagClick
                  ? (e) => {
                      e.stopPropagation();
                      onTagClick(t);
                    }
                  : undefined
              }
              className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition group-hover:bg-elevated hover:text-brand"
            >
              {t}
            </span>
          ))}
          <span className="ml-auto text-[10px] text-ink-faint">{relativeTime(item.createdAt)}</span>
        </div>
      )}
    </button>
  );
}
