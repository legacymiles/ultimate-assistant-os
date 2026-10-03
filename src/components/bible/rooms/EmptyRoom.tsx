import type { RoomDef } from "@/lib/bible/rooms";

/**
 * A room that is specified but not built. It says what it will hold and that it
 * does not hold it yet, which is the honest version of a rail with four entries
 * — and lets the owner see the shape of what he is filling.
 */
export function EmptyRoom({ room }: { room: RoomDef }) {
  return (
    <section className="bible-empty">
      <h2>{room.label}</h2>
      <p className="bible-empty-hint">{room.hint}</p>
      <p>{room.blurb}</p>
      <p className="bible-empty-status">Not built yet</p>
    </section>
  );
}
