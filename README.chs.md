# my_pi_executor

`my_pi_executor` 是一个面向已授权工程与运维任务的、按任务独立运行的 Pi Executor Skill。

每次调用都会创建一个独立的 Pi parent runtime。Mission/session 状态、HITL 续接、保留的子任务以及恢复能力都由 Pi 和 `pi-subagents` 负责；本仓库不会再维护第二套持久化、调度或生命周期层。

## 仓库结构

```text
SKILL.md
scripts/entrypoint.mjs
tests/entrypoint.test.mjs
package.json
```

- `SKILL.md`：定义 Skill 契约和 parent 编排规则。
- `scripts/entrypoint.mjs`：Node 入口。通过 Pi 的公开 Node SDK 启动或恢复一个 Pi parent。
- `tests/entrypoint.test.mjs`：验证公开调用边界以及被禁止的架构模式。
- `package.json`：提供仓库测试命令。

## 运行要求

- Node.js
- 兼容版本的 Pi
- `pi-subagents`
- 模型供应商凭据

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

## 验证

```text
npm run check
```
