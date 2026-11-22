# P1 挂回消除路线图(globalThis 挂回 → 显式依赖)

> 背景:P0 拆层为保行为不变,把 25 个跨模块晚绑定符号挂在
> `main.js` 的 `Object.assign(globalThis,{…})`(+ `Store`/`db` 活 getter)。
> 这是**过渡缝**(DEVIATIONS #3),不是终点。
> 本路线图按"解开依赖环的难易"分三批消除,每批独立提交、独立全绿。
>
> 验收工具(每批必跑):
> - 静态扫描(查自由引用残留,脚本见本文附录)
> - `npm test`(136 项)+ `npm run test:smoke` + `npm run build:app`
>
> 进度:T0 ✅(7 个)| T1 ✅(renderAll/showTab/buildSqliteBytes 注入化,3 个;
>   buildSqliteBytes 因冒烟直接求值归入 T2-D 调试面)| T2 待做
> 当前挂回:生产 10(accMatch/isOver/snoozed/overdueDays/ui/closeSheets/showSheet/
>   toast/download/mark)+ 调试 5(renderTrip/statsFor/backupDocument/previewImport/
>   buildSqliteBytes)+ Store/db

## 剩余挂回清单(18 + Store/db)

```
accMatch isOver snoozed overdueDays ui
buildSqliteBytes closeSheets showSheet toast download
renderAll showTab mark
renderTrip statsFor backupDocument previewImport   ← 仅冒烟/调试用
Store db(活 getter)                              ← 仅冒烟/调试用
```

## T1 —— 注入/挂钩可解(不搬模块)✅ 已完成(renderAll/showTab/buildSqliteBytes)

> 备注:mark 的 detail↔order-actions 解环未做,并入 T2 统一处理;
> toast/closeSheets/showSheet/download 按原计划随 T2-A 自然消除。

| 符号 | 自由引用方 | 环 | 解法 |
|---|---|---|---|
| `renderAll` `showTab` | storage.js(loadState/switchMode 后刷 UI) | ui→storage | storage 暴露 `registerAfterLoad(hook)`;组合根注入 `()=>{renderAll();showTab('home')}`。storage 两个调用点改 hook |
| `buildSqliteBytes` | storage.js(persistSnapshot) | sqlite-bytes→storage | `registerBytesBuilder(fn)`,组合根注入;persistSnapshot 调 builder |
| `toast` `closeSheets` `showSheet` `download` | storage.js(导入/备份 UX) | sheets→storage、export→storage | **不注入,随 T2-A 搬家自然消除**(见下) |
| `mark` | detail.js | order-actions→detail | order-actions 改用 ui.js 已有的 `registerDetailRerender` 注入(不再 import detail),detail 即可直引 mark |

## T2 —— 需要模块级调整

### T2-A 导入导出 UX 搬家(一次解 4 个)

`previewImport` `confirmImport` `restoreCheckpoint` `exportCheckpoint` 本质是
导入导出 UX,不是存储原语。从 storage.js 搬到 export.js
(export.js 已 import storage/sheets 的全部所需)→ storage 对
`toast/closeSheets/showSheet/download` 的自由引用**整组消失**。
storage.js 预计再瘦 ~80 行,向"纯持久化"收敛。

### T2-B accMatch 归位 + 角标注入(解 3 个)

`accMatch` 只依赖 `ui.accFilter`,应住 ui.js:
1. accMatch 从 accounts.js 移到 ui.js;
2. derived.js 改为 `import {accMatch} from './ui.js'`(derived→ui 无环,
   前提是 ui 保持不 import derived —— 见 3);
3. ui.js 的 renderAll 逾期角标(当前自由引用 accMatch/isOver/snoozed)改为
   `registerBadgeCounter(fn)` 注入,组合根从能同时 import 三者的层注入。
   → ui 保持无 derived 依赖,`isOver/snoozed` 在 ui 的自由引用消除。

### T2-C Notify 独立成模块(解 2 个)

storage.js 里 ~130 行的 `Notify`(本地通知排程)是业务逻辑不是存储原语,
且是它拽着 `isOver/snoozed` 不放。拆为 `src/app/notify.js`
(import derived + storage),storage 从此不碰业务规则。
附带收益:storage.js 向"纯持久化适配"再进一步,这也是 P2 内核化的前提。

### T2-D 调试面收口(解 6 个,终态)

`renderTrip statsFor backupDocument previewImport Store db ui`
只剩冒烟/调试消费。全部收进单一命名空间:

```js
window.__TANJI__ = { Store, ui, get db(){…}, renderTrip, statsFor, backupDocument, previewImport };
```

冒烟测试同步改走 `__TANJI__`。**终态:生产模块零自由引用,
globalThis 上只有这一个有名字的调试面**,DEVIATIONS #3 正式关闭。

## 依赖顺序与风险

```
T0 ✅ → T1(renderAll/showTab、buildSqliteBytes、mark) → T2-A → T2-B → T2-C → T2-D
```

- T1 每项独立,可单独提交;T2-A 先行(它不依赖其它项,且消掉 T1 的 4 个);
- T2-B 与 T2-C 都碰 isOver/snoozed,B 先 C 后(先解 ui 侧,再拆 Notify);
- 每批做完跑附录扫描:目标是挂回表只减不增,任何"加回去"都是警报。

## 附录:自由引用静态扫描

```bash
python3 - <<'EOF'
import re,glob
exports={}
for f in glob.glob('src/app/**/*.js',recursive=True):
    src=open(f).read()
    exports[f]=set(re.findall(r'export (?:async )?function (\w+)',src))|set(re.findall(r'export (?:const|let) (\w+)',src))
allExp={n for s in exports.values() for n in s}
for f in sorted(glob.glob('src/app/**/*.js',recursive=True)):
    src=open(f).read()
    imported=set()
    for m in re.finditer(r"import \{([^}]+)\} from",src):
        imported|={p.strip().split(' as ')[-1] for p in m.group(1).split(',') if p.strip()}
    declared={a or b for a,b in re.findall(r'^(?:export )?(?:async )?function (\w+)|^(?:export )?(?:const|let) (\w+)',src,re.M)}
    miss={n for n in allExp-exports[f]-imported-declared if re.search(r'(?<![\w$.])'+re.escape(n)+r'\s*\(',src)}
    if miss: print(f, sorted(miss))
EOF
```
