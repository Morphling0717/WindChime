import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

/** 软删除单条 */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!id || id.length > 128) {
      return NextResponse.json({ error: '无效 id' }, { status: 400 });
    }
    const db = getDb();
    const r = db
      .prepare(
        `UPDATE windchime_messages SET deleted_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(new Date().toISOString(), id);
    if (r.changes === 0) {
      return NextResponse.json({ error: '未找到' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 更新状态：isRead / isFavorited */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!id || id.length > 128) {
      return NextResponse.json({ error: '无效 id' }, { status: 400 });
    }
    const body = (await req.json()) as {
      isRead?: boolean;
      isFavorited?: boolean;
    };

    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof body.isRead === 'boolean') {
      sets.push('is_read = ?');
      vals.push(body.isRead ? 1 : 0);
    }
    if (typeof body.isFavorited === 'boolean') {
      sets.push('is_favorited = ?');
      vals.push(body.isFavorited ? 1 : 0);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: '无可更新字段' }, { status: 400 });
    }

    const db = getDb();
    const r = db
      .prepare(
        `UPDATE windchime_messages SET ${sets.join(', ')}
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(...vals, id);
    if (r.changes === 0) {
      return NextResponse.json({ error: '未找到' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '更新失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
