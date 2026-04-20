import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

type Ctx = { params: Promise<{ hash: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { hash } = await ctx.params;
    if (!hash || hash.length > 128) {
      return NextResponse.json({ error: '无效 hash' }, { status: 400 });
    }
    const db = getDb();
    const r = db.prepare('DELETE FROM windchime_blocklist WHERE hash = ?').run(hash);
    if (r.changes === 0) {
      return NextResponse.json({ error: '未找到' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
