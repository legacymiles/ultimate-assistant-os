import type { CSSProperties } from "react";
import type { CatalogProject, IconStyle } from "@/lib/catalog";

interface Props {
  project: CatalogProject;
  size?: number;
  className?: string;
}

// Animated square icon, deterministically themed by the project's hues.
// All animation is CSS — no JS, no libraries — so cards stay light on mobile.
export function AnimatedIcon({ project, size = 96, className }: Props) {
  const [h1, h2] = project.hue;
  const style: CSSProperties & Record<`--${string}`, string | number> = {
    width: size,
    height: size,
    ["--h1"]: h1,
    ["--h2"]: h2,
    ["--c1"]: `hsl(${h1} 85% 60%)`,
    ["--c2"]: `hsl(${h2} 85% 55%)`,
    ["--c-deep"]: `hsl(${h1} 60% 16%)`,
  };

  return (
    <div
      className={`hub-icon hub-icon--${project.iconStyle} ${className ?? ""}`}
      style={style}
      aria-hidden
    >
      <Inner style={project.iconStyle} />
    </div>
  );
}

function Inner({ style }: { style: IconStyle }) {
  switch (style) {
    case "aurora":
      return (
        <>
          <span className="hub-icon__layer hub-icon__aurora-a" />
          <span className="hub-icon__layer hub-icon__aurora-b" />
          <span className="hub-icon__shine" />
        </>
      );
    case "orbit":
      return (
        <>
          <span className="hub-icon__layer hub-icon__orbit-bg" />
          <span className="hub-icon__orbit-ring" />
          <span className="hub-icon__orbit-dot" />
          <span className="hub-icon__orbit-core" />
        </>
      );
    case "rings":
      return (
        <>
          <span className="hub-icon__layer hub-icon__rings-bg" />
          <span className="hub-icon__ring hub-icon__ring--1" />
          <span className="hub-icon__ring hub-icon__ring--2" />
          <span className="hub-icon__ring hub-icon__ring--3" />
        </>
      );
    case "mesh":
      return (
        <>
          <span className="hub-icon__layer hub-icon__mesh-a" />
          <span className="hub-icon__layer hub-icon__mesh-b" />
          <span className="hub-icon__layer hub-icon__mesh-c" />
        </>
      );
    case "pulse":
      return (
        <>
          <span className="hub-icon__layer hub-icon__pulse-bg" />
          <span className="hub-icon__pulse-dot" />
          <span className="hub-icon__pulse-dot hub-icon__pulse-dot--2" />
        </>
      );
    case "waves":
      return (
        <>
          <span className="hub-icon__layer hub-icon__waves-bg" />
          <span className="hub-icon__wave hub-icon__wave--1" />
          <span className="hub-icon__wave hub-icon__wave--2" />
        </>
      );
  }
}
