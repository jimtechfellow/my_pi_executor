# my_pi_executor

`my_pi_executor` 是一个面向已授权工程与运维任务的、按任务独立运行的 Pi Executor Skill。

每次调用都会创建一个独立的 Pi parent runtime。Mission/session 状态、HITL 续接、保留的子任务以及恢复能力都由 Pi 和 `pi-subagents` 负责；本仓库不会再维护第二套持久化、调度或生命周期层。

## 仓库结构

```text
.gitignore
README.md
README.chs.md
SKILL.md
package.json
scripts/entrypoint.mjs
tests/entrypoint.test.mjs
tests/real-pi.e2e.mjs
```

- `SKILL.md`：定义 Skill 契约和 parent 编排规则。
- `scripts/entrypoint.mjs`：Node 入口。通过 Pi 的公开 Node SDK 启动或恢复一个 Pi parent。
- `tests/entrypoint.test.mjs`：验证公开调用边界以及被禁止的架构模式。
- `tests/real-pi.e2e.mjs`：显式运行的真实 Pi/provider 链路检查。
- `package.json`：提供仓库测试命令。

## 运行要求

- Node.js
- 已使用 `@earendil-works/pi-coding-agent` 0.85.1 验证
- 已使用 `pi-subagents` 0.66.0 验证
- 模型供应商凭据

默认直接使用 Pi 已有的 provider 配置或环境凭据。BWS/systemd 凭据代理仅是可选的本机宿主集成，只有设置 `MY_PI_EXECUTOR_USE_BWS=1` 才会启用。

## 使用方法

启动任务时，通过 stdin 传入 JSON：

```json
{"title":"...","goal":"...","acceptance":["..."],"workspace":"/absolute/path"}
```

```text
scripts/entrypoint.mjs run --workspace /absolute/path
```

返回结果中会包含 `sessionFile`。需要继续任务时，将它与返回的 Mission id 一起保留：

```text
scripts/entrypoint.mjs answer --workspace /absolute/path --session <session-file> --mission <mission-id>
scripts/entrypoint.mjs recover --workspace /absolute/path --session <session-file> --mission <mission-id>
```

`answer` 通过 stdin 接收 `{"answer":"..."}`。

JSON 结果的 `status` 只会是 `PASS`、`FAILED`、`NEEDS_DECISION` 或 `EXTERNAL_DEPENDENCY`，并包含 `missionId` 和 `rounds`。最终输出无法解析或续接时 Mission id 改变，入口会 fail closed。若报告了第 4 个 fresh-review 轮次，入口会把结果转为 `FAILED`；pi-subagents 0.66.0 的 3 轮默认值只是编排提示，并没有提供 review 轮次的运行时硬上限。

## 验证

```text
npm run check
```

真实 provider E2E 需要单独显式运行；它只执行一次真实 Worker → fresh Reviewer → 修复或结束链路：

```text
npm run check:e2e
```

缺少 Pi、pi-subagents 或 provider 凭据时会明确报告 `EXTERNAL_DEPENDENCY`，不会把 skip 当作 `PASS`。
