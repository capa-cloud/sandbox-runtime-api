# Sandbox Runtime API

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

Sandbox Runtime API 是一个独立设计、Provider 中立的公共契约，用于创建、观察、控制和删除
面向 AI Agent 与开发工具的隔离执行环境。

项目只标准化可移植的生命周期和能力语义。它不是托管 Sandbox 平台，不是 Agent 框架，也不是
任何私有系统的开源发行版。

## 解决什么问题

Agent 应用通常需要相似的执行能力，但不同 Provider 对生命周期、就绪、命令、文件、终端、
网络、持久化和恢复提供了不同接口。本项目把这些问题拆分为：

- 带版本的 Sandbox 资源模型和生命周期；
- 具有显式能力协商的 Provider SPI；
- 可嵌入的内存参考 Runtime；
- 确定性的 Mock Provider；
- Provider 一致性测试；
- 后续的传输协议映射和客户端 SDK。

```text
应用或 Harness Runtime
          |
  Sandbox Runtime API
          |
  +-------+--------+----------+
  |                |          |
Local            Docker   Kubernetes / Cloud
Provider         Provider      Provider
          |
     sandbox agent
```

## 与 Harness Runtime API 的关系

[`harness-runtime-api`](https://github.com/capa-cloud/harness-runtime-api) 规范应用如何控制 Agent
Harness 执行；Sandbox Runtime API 规范 Harness 或工具运行所需的隔离计算环境。

二者没有强制依赖。需要同时获得 Harness 与 Sandbox 可移植性时，可以组合使用。

## 当前状态

`0.1.0-dev` 是 clean-room 的开发基线，目前包含：

- 与传输无关的 TypeScript 协议模型；
- capability preflight；
- generation fencing；
- 内存参考 Runtime；
- Mock Provider；
- Provider conformance runner；
- 公开来源与 clean-room 贡献规则。

协议在 `1.0.0` 前可能发生不兼容变化。

## 快速开始

需要 Node.js 22+ 和 pnpm 10。

```bash
pnpm install
pnpm check
```

## Clean-room 边界

本仓库只基于公开规范、公开仓库和通用分布式系统原则独立设计。禁止提交私有代码、私有 API、
内部标识、部署配置、生产数据或非公开测试用例。

贡献前请阅读 [来源与 provenance](ORIGIN_AND_PROVENANCE.md)、
[Clean-room policy](docs/clean-room-policy.md) 和 [非目标](NON_GOALS.md)。

## License

Apache License 2.0。
