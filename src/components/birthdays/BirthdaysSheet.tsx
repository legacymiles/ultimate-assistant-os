"use client";

import { WidgetSheet } from "../new-jarvis/Widgets";
import { BirthdaysEditor } from "./BirthdaysEditor";

/** Family & friends' birthdays, over Jarvis — opened from the Calendar tab, the Calendar widget or #birthdays. */
export function BirthdaysSheet({ onClose }: { onClose: () => void }) {
  return (
    <WidgetSheet title="Birthdays" kicker="Family & friends" onClose={onClose}>
      <div className="mx-auto max-w-2xl p-4">
        <BirthdaysEditor />
      </div>
    </WidgetSheet>
  );
}
