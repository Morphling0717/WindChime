import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  WINDCHIME_ENABLED_KEY,
  computeSenderIdentity,
  getBoolSetting,
  getDb,
} from '@/lib/db';

const MAX_TEXT = 1000;
const MAX_NICK = 32;
const MAX_LINK = 500;

type Row = {
  id: string;
  created_at: string;
  text: string;
  nickname: string | null;
  link_url: string | null;
  is_read: number;
  is_favorited: number;
  is_replied: number;
  reply_text: string | null;
  sender_hash: string | null;
  sender_label: string | null;
};

function rowToApi(r: Row) {
  return {
    id: r.id,
    createdAt: r.created_at,
    text: r.text,
    nickname: r.nickname,
    linkUrl: r.link_url,
    isRead: !!r.is_read,
    isFavorited: !!r.is_favorited,
    isReplied: !!r.is_replied,
    replyText: r.reply_text,
    senderLabel: r.sender_label,
    senderHash: r.sender_hash,
  };
}

/** 列出留言（新在前），支持 ?filter=all|unread|favorited|replied */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const filter = url.searchParams.get('filter') ?? 'all';

    const db = getDb();
    const where: string[] = ['deleted_at IS NULL'];
    if (filter === 'unread') where.push('is_read = 0');
    else if (filter === 'favorited') where.push('is_favorited = 1');
    else if (filter === 'replied') where.push('is_replied = 1');

    const rows = db
      .prepare(
        `SELECT id, created_at, text, nickname, link_url,
                is_read, is_favorited, is_replied, reply_text,
                sender_hash, sender_label
         FROM windchime_messages
         WHERE ${where.join(' AND ')}
         ORDER BY datetime(created_at) DESC`,
      )
      .all() as Row[];

    const counts = db
      .prepare(
        `SELECT
           COUNT(*) AS all_cnt,
           COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_cnt,
           COALESCE(SUM(is_favorited), 0) AS favorited_cnt,
           COALESCE(SUM(is_replied), 0) AS replied_cnt
         FROM windchime_messages
         WHERE deleted_at IS NULL`,
      )
      .get() as {
      all_cnt: number;
      unread_cnt: number;
      favorited_cnt: number;
      replied_cnt: number;
    };

    return NextResponse.json({
      items: rows.map(rowToApi),
      counts: {
        all: Number(counts.all_cnt),
        unread: Number(counts.unread_cnt),
        favorited: Number(counts.favorited_cnt),
        replied: Number(counts.replied_cnt),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '数据库错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 新增一条留言 */
export async function POST(req: Request) {
  try {
    if (!getBoolSetting(WINDCHIME_ENABLED_KEY, true)) {
      return NextResponse.json(
        { error: '风铃暂时关闭，主播稍后再见哦 ~' },
        { status: 423 },
      );
    }
    const body = (await req.json()) as {
      text?: string;
      nickname?: string | null;
      linkUrl?: string | null;
      senderFingerprint?: string | null;
    };

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
    }
    if (text.length > MAX_TEXT) {
      return NextResponse.json({ error: `正文过长（最多 ${MAX_TEXT} 字）` }, { status: 400 });
    }

    const nickname: string | null =
      typeof body.nickname === 'string' ? body.nickname.trim() || null : null;
    if (nickname && nickname.length > MAX_NICK) {
      return NextResponse.json({ error: '称呼过长' }, { status: 400 });
    }

    let linkUrl: string | null = null;
    if (body.linkUrl != null && body.linkUrl !== '') {
      if (typeof body.linkUrl !== 'string') {
        return NextResponse.json({ error: '链接格式无效' }, { status: 400 });
      }
      const s = body.linkUrl.trim();
      if (s.length > MAX_LINK) {
        return NextResponse.json({ error: '链接过长' }, { status: 400 });
      }
      try {
        const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return NextResponse.json({ error: '仅支持 http(s) 链接' }, { status: 400 });
        }
        linkUrl = u.toString();
      } catch {
        return NextResponse.json({ error: '链接格式无效' }, { status: 400 });
      }
    }

    const { hash, label } = computeSenderIdentity(req, body.senderFingerprint);
    const db = getDb();

    // 命中黑名单时：对外假装成功，实际丢弃
    const blocked = db
      .prepare('SELECT hash FROM windchime_blocklist WHERE hash = ?')
      .get(hash) as { hash: string } | undefined;
    if (blocked) {
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO windchime_messages
         (id, created_at, text, nickname, link_url, sender_hash, sender_label)
       VALUES (@id, @createdAt, @text, @nickname, @linkUrl, @senderHash, @senderLabel)`,
    ).run({
      id,
      createdAt,
      text,
      nickname,
      linkUrl,
      senderHash: hash,
      senderLabel: label,
    });

    return NextResponse.json(
      rowToApi({
        id,
        created_at: createdAt,
        text,
        nickname,
        link_url: linkUrl,
        is_read: 0,
        is_favorited: 0,
        is_replied: 0,
        reply_text: null,
        sender_hash: hash,
        sender_label: label,
      }),
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : '保存失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
