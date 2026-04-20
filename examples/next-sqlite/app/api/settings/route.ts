import { NextResponse } from 'next/server';
import {
  WINDCHIME_ENABLED_KEY,
  getBoolSetting,
  setBoolSetting,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * 示例用：风铃开关读取 / 设置。
 * 生产请对 PUT 加管理员鉴权（见 README）。
 */
export async function GET() {
  try {
    const enabled = getBoolSetting(WINDCHIME_ENABLED_KEY, true);
    return NextResponse.json({ enabled });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '读取失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled 字段必须是布尔值' },
        { status: 400 },
      );
    }
    setBoolSetting(WINDCHIME_ENABLED_KEY, body.enabled);
    return NextResponse.json({ enabled: body.enabled });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '保存失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
