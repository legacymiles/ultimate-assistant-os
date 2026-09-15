import { ProjectPage } from "@/components/studio3d/ProjectPage";

export const metadata = {
  title: "Video · 3D Studio Video Creator · Ultimate Assistant OS",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectPage id={id} />;
}
