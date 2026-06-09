# 恢复 Apex Dashboard 源码完整编译

## Summary

目标是让项目从 `src/main.ts` 完整打包出可用的 `main.js`，并确保 `npm run build` 成功。当前失败原因不是构建工具本身，而是源码目录缺少多个被 `view.ts` / `renderer.ts` 引用的模块，同时新增的 `pomodoro-service` 与现有渲染代码字段不完全匹配。

默认策略：补齐缺失源码模块，保持现有 `main.js` 的功能行为，不再使用“最小入口”覆盖完整插件。

## Key Changes

- 保持完整入口：
  - `src/main.ts` 注册 `DashboardView` / `DASHBOARD_VIEW_TYPE`。
  - `open-dashboard` 命令和 ribbon 图标都打开真实工作台视图。
  - `cycle-theme`、`add-section`、`refreshAllDashboards()` 保持与旧 `main.js` 行为一致。

- 补齐缺失模块：
  - `banner`: 提供 `renderBanner`、`BannerEditModal`、`resolveVaultImage`。
  - `recent`: 提供 `getRecentDocs`、`renderRecentDocs`。
  - `card-edit-modal`: 提供 `CardEditModal`，支持编辑标题、正文、链接、封面、颜色等基础字段。
  - `widget-type-modal`: 提供 `WidgetTypeModal` 和 `WidgetType = 'weather' | 'tracker'`。
  - `weather-config-modal`: 提供 `WeatherConfigModal`，返回标题和 `WeatherConfig`。
  - `library-config-modal`: 提供 `LibraryConfigModal`，返回完整 `LibraryConfig`。
  - `countdown-modal`: 提供 `CountdownSettingsModal`，编辑倒计时启用状态、目标时间、显示模式、提醒天数、标签。
  - `reminder-notice`: 提供 `ReminderNoticeModal`，支持 dismiss 和 snooze。
  - `reading-service`: 提供 renderer 所需的阅读计时、书籍列表、统计、记录删除/更新 API。
  - `fortune-stick` 和 `lunar-almanac`: 补齐农历小组件依赖。
  - 扩展 `holiday-service`: 导出 `fetchHolidayData`、`getHolidayForDate`，并让 `HolidayInfo` 包含 `holiday`、`type`、`name` 等现有调用字段。

- 修正接口不匹配：
  - `PomodoroState` 增加 `totalSeconds`、`completedWorkSessions`。
  - `PomodoroRecord` 增加 `duration` 字段，保留 `minutes` 兼容内部统计。
  - `attachFileSuggest` 返回 `{ close, isActive }`，匹配 renderer 使用。
  - `sync.ts` 的 rename 事件参数改为 `TAbstractFile`，内部用 `instanceof TFile` 收窄。
  - 为当前隐式 `any` 回调补显式类型。

## Test Plan

- 运行 `npm run build`，要求：
  - `tsc -noEmit -skipLibCheck` 通过。
  - `node esbuild.config.mjs production` 成功生成完整 `main.js`。
  - 构建后的 `main.js` 中仍可搜索到 `registerView`、`openDashboard`、`apex-dashboard-view`。

- 文案回归检查：
  - 搜索确认不存在 `default.todo2`、`Drag cards between sections`、`在不同分区之间拖拽卡片`。
  - 首次创建 dashboard 的默认 Todo 不再包含跨分区拖拽卡片项。

- 功能冒烟：
  - 在 Obsidian 重新加载插件后，ribbon 图标能打开 Dashboard 视图。
  - 设置页可打开并保存语言/主题等设置。
  - 默认 dashboard 文件可创建并渲染 Memo、Todo、Projects、Library。
  - 侧边栏小组件不因缺失服务报错，番茄钟和阅读计时至少能启动、暂停、记录基础数据。

## Assumptions

- 目标是“可完整编译并恢复插件可用”，不是逐字还原原作者所有丢失源码实现。
- 缺失模块会实现与现有 UI 调用兼容的最小完整功能；复杂外部能力采用安全降级，例如图书搜索先返回手动条目，节假日接口失败时返回空数据。
- 构建成功后允许 `main.js` 被重新生成，并以新源码为准。

## Completion Log

- 已完成完整入口恢复：`src/main.ts` 注册真实 Dashboard 视图，并保留打开工作台、切换主题、添加分区、刷新视图等行为。
- 已补齐构建缺失模块：`banner`、`recent`、`card-edit-modal`、`widget-type-modal`、`weather-config-modal`、`library-config-modal`、`countdown-modal`、`reminder-notice`、`reading-service`、`fortune-stick`、`lunar-almanac`，并扩展了 `holiday-service`。
- 已修正接口不匹配：Pomodoro 状态/记录字段、文件建议器 `isActive()`、Obsidian rename 事件类型、部分隐式 `any`。
- 已执行并通过验证命令：`npm run build`。
- 已验证构建后的 `main.js` 仍包含完整入口关键字：`registerView`、`openDashboard`、`apex-dashboard-view`。
- 已验证被删除文案未回归：`default.todo2`、`Drag cards between sections`、`在不同分区之间拖拽卡片`。
- 注意事项：部分补齐模块采用最小可用实现，外部搜索/节假日等复杂能力采用安全降级；后续可在此基础上继续增强体验。
