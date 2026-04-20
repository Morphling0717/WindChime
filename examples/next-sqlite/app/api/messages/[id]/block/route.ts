import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

/** 将该留言对应的发送者加入黑名单，并顺手软删该发送者所有未删留言 */
export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!id || id.length > 128) {
      return NextResponse.json({ error: '无效 id' }, { status: 400 });
    }
    const db = getDb();
    const row = db
      .prepare(
        `SELECT sender_hash AS hash, sender_label AS label, text
         FROM windchime_messages WHERE id = ?`,
      )
      .get(id) as { hash: string | null; label: string | null; text: string } | undefined;
    if (!row) {
      return NextResponse.json({ error: '未找到' }, { status: 404 });
    }
    if (!row.hash) {
      return NextResponse.json({ error: '该留言无发送者指纹，无法拉黑' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const sample = row.text.length > 160 ? `${row.text.slice(0, 160)}…` : row.text;

    db.prepare(
      `INSERT INTO windchime_blocklist (hash, label, blocked_at, sample_text)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET
         label = excluded.label,
         blocked_at = excluded.blocked_at,
         sample_text = excluded.sample_text`,
    ).run(row.hash, row.label, now, sample);

    // 顺手把该发送者之前的未删留言一并软删（可按产品需要改为保留）
    db.prepare(
      `UPDATE windchime_messages SET deleted_at = ?
       WHERE sender_hash = ? AND deleted_at IS NULL`,
    ).run(now, row.hash);

    return NextResponse.json({ ok: true, hash: row.hash, label: row.label });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '拉黑失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
