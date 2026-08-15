import { Studio } from "@/app/studio";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Studio view="spec" projectId={id} />;
}
