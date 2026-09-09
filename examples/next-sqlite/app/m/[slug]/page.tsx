import { notFound } from "next/navigation";
import { getService } from "../../../lib/windchime";
import { Sender } from "../../Sender";
export const dynamic = "force-dynamic";
export default async function TopicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const topic = await getService().getPublicTopic(slug);
  if (!topic) notFound();
  return (
    <>
      <h1>{topic.title}</h1>
      <p>{topic.description}</p>
      <p>
        状态：{topic.state}，
        {topic.isEnabledNow ? "开放" : "暂停或不在投稿时间内"}
      </p>
      <Sender slug={slug} enabled={topic.isEnabledNow} />
    </>
  );
}
