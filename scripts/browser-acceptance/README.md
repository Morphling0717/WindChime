# 两站真实浏览器验收

这些程序在 Tabbit 浏览器拥有的 Playwright 运行时执行；不是普通 Node 脚本。已实际执行的业务阶段为 `open`、`basic`、`network`。桌面配对由同一真实浏览器逐一批准，证据见桌面报告。

只针对临时 SQLite 的回环测试站。先启动 3011、3012 及独立展示服务 3390；两站构建时配置 `NEXT_PUBLIC_WINDCHIME_DISPLAY_URL=http://localhost:3390/display`，允许对应展示来源。

```powershell
$env:WINDCHIME_SMOKE_ALLOW_WRITES='1'
$env:WINDCHIME_SMOKE_PASSWORD='<隔离站点管理员口令>'
node scripts/prepare-browser-fixtures.mjs fixtures.json
```

按 Tabbit 技能先清点标签页；存在相关保留分组时先 resume，再执行程序，避免先创建空任务占用另一个分组。同一轮所有阶段共用一个任务。

```powershell
& scripts/browser-acceptance/run.ps1 -Phase open -Fixtures fixtures.json -Report browser-open.json
& scripts/browser-acceptance/run.ps1 -Phase basic -Fixtures fixtures.json -Report browser-basic.json
& scripts/browser-acceptance/run.ps1 -Phase network -Fixtures fixtures.json -Report browser-network.json
```

每阶段立即保存脱敏报告；不记录授权链接。`basic` 检查原文隔离、批准不播、审核图片、手动切换、末尾空白、刷新、撤销与结束。`network` 检查按钮隐藏、每站8次响应至DOM清屏时延、明确失败、静默断线、重连及页面freeze/resume事件；页面事件不等于实际电脑休眠。

连接恢复必须等待新的 `/display/open` 成功。旧接收器的租期尚未结束时，私人界面显示的就绪数量不能用来判断新连接已完成。未获得新连接就发送的命令不会在稍后补播。

任务运行时若因空闲重置而丢失 `wcPages`，后续阶段会明确失败，不能计为零项通过。先检查原阶段回执与当前可见状态，再恢复相关页面；不得盲目重复有副作用的阶段。测试完成后结束本次话题展示、撤销本次授权，再按技能 finish 任务。脚本创建的合成信件保留供核查。
