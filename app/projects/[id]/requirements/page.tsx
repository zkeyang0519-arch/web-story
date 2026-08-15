import { Studio } from "@/app/studio";

export default async function RequirementsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Studio view="brief" projectId={id} />;
}
