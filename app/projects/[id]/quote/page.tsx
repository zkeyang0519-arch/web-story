import { Studio } from "@/app/studio";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Studio view="quote" projectId={id} />;
}
