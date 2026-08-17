import { ReviewWorkflow } from "@/app/review-workflow";

export default async function CreativeReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewWorkflow view="creative" projectId={id} />;
}
