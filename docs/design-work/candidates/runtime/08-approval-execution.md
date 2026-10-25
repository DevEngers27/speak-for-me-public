# 08 审批与执行（索引）

本章按单次写入 12,000 字符上限拆成多个分片，按顺序阅读：

1. 08-approval-execution-part1.md：审批绑定、必需审批人、decide 与 executeIfReady 的事务时序
2. 08-approval-execution-part2.md：撤回与过期、并发与重复、执行派生与预览、执行边界、拒绝之后
