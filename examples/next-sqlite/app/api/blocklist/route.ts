import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

type Row = {
  hash: string;
  label: string | null;
  blocked_at: string;
  sample_text: string | null;
};

export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT hash, label, blocked_at, sample_text
         FROM windchime_blocklist
         ORDER BY datetime(blocked_at) DESC`,
      )
      .all() as Row[];
    return NextResponse.json(
      rows.map((r) => ({
        hash: r.hash,
        label: r.label,
        blockedAt: r.blocked_at,
        sampleText: r.sample_text,
      })),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : '数据库错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
