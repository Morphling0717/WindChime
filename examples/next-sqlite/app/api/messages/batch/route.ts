import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/** 批量操作：{ action: 'delete' | 'markRead', ids: string[] } */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: 'delete' | 'markRead';
      ids?: unknown;
    };
    if (body.action !== 'delete' && body.action !== 'markRead') {
      return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids 不能为空' }, { status: 400 });
    }
    if (ids.length > 500) {
      return NextResponse.json({ error: '单次批量至多 500 条' }, { status: 400 });
    }

    const db = getDb();
    const ph = ids.map(() => '?').join(',');
    const now = new Date().toISOString();
    let changes = 0;

    if (body.action === 'delete') {
      const r = db
        .prepare(
          `UPDATE windchime_messages SET deleted_at = ?
           WHERE deleted_at IS NULL AND id IN (${ph})`,
        )
        .run(now, ...ids);
      changes = r.changes;
    } else {
      const r = db
        .prepare(
          `UPDATE windchime_messages SET is_read = 1
           WHERE deleted_at IS NULL AND id IN (${ph})`,
        )
        .run(...ids);
      changes = r.changes;
    }

    return NextResponse.json({ changes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '批量操作失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
