'use client';
import { useMemo } from 'react';
import { WindChimeSender } from '@windchime/embed/ui';
import { createWindChimeClient } from '@windchime/embed/client';
export default function OptionalUi() {
  const client = useMemo(() => createWindChimeClient(), []);
  return <><h1>可选默认组件</h1><p>默认组件与自定义界面调用相同 API。完整默认皮肤可按文档另外配置 Tailwind。</p><WindChimeSender onSubmit={async payload => { await client.messages.submit(payload); }} collectNickname collectLinkUrl /></>;
}
