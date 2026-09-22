import VideoView from "@/components/VideoView";

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VideoView id={id} />;
}
