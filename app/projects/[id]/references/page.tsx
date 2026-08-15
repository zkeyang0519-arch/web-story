import { Studio } from "@/app/studio";

export default async function ReferencesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Studio view="references" projectId={id} />;
}
