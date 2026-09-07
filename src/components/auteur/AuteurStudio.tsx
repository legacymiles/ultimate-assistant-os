"use client";

import "./auteur.css";
import { Home } from "./Home";
import { Workspace } from "./Workspace";
import { StudioProvider, useStudio } from "./studio";

export function AuteurStudio() {
  return (
    <StudioProvider>
      <div className="auteur">
        <Screen />
      </div>
    </StudioProvider>
  );
}

function Screen() {
  const { view, project } = useStudio();
  return view === "project" && project ? <Workspace /> : <Home />;
}
