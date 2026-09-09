import Link from "next/link";
import { getService } from "../lib/windchime";
import { Sender } from "./Sender";
export const dynamic = "force-dynamic";
export default async function Page() {
  const [topic, topics] = await Promise.all([
    getService().getPublicTopic("default"),
    getService().listPublicTopics(),
  ]);
  return (
    <>
      <h1>给我写一封信</h1>
      <p>这套 HTML 和样式由网站自己编写，业务来自风铃。</p>
      <Sender enabled={topic?.isEnabledNow ?? false} />
      <h2>进行中的话题</h2>
      <ul>
        {topics.map((t) => (
          <li key={t.id}>
            <Link href={`/m/${t.slug}`}>{t.title}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
