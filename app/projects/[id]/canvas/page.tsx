import { ReviewWorkflow } from "@/app/review-workflow";

export default async function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewWorkflow view="canvas" projectId={id} />;
}
