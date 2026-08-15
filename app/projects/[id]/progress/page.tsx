import { Studio } from "@/app/studio";

export default async function ProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Studio view="progress" projectId={id} />;
}
