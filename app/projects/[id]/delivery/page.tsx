import { Studio } from "@/app/studio";

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Studio view="result" projectId={id} />;
}
