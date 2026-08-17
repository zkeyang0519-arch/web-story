import { ReviewWorkflow } from "@/app/review-workflow";

export default async function ImagePlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewWorkflow view="images" projectId={id} />;
}
