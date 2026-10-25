# 10 代理运行时（本设计主视角）（索引）

本章按单次写入 12,000 字符上限拆成多个分片，按顺序阅读：

1. 10-agent-runtime-part1.md：运行时不变量 R1–R10、编排选型、run / turn / attempt、完整生命周期时序
2. 10-agent-runtime-part2.md：失败模式总表 F01–F28
3. 10-agent-runtime-part3.md：scheduleAttempt / claimAttempt / executeAttempt / record / apply / watchdog 规格与守卫
4. 10-agent-runtime-part4.md：重试预算、超时与延迟预算、调用预算、总开关与熔断、并发控制、部署与版本
5. 10-agent-runtime-part5.md：模型调用规范（调用点、SDK、请求形状、JSON Schema、上下文与缓存、响应分类、错误映射）
6. 10-agent-runtime-part6.md：用量与成本、缓存验证、stub 与故障注入、简报抽取、可观测性、待验证
