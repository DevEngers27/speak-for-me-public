# 09 约束变更（索引）

本章按单次写入 12,000 字符上限拆成多个分片，按顺序阅读：

1. 09-constraint-changes-part1.md：版本规则、快照、递增点清单、bumpConstraints、预算变更流程
2. 09-constraint-changes-part2.md：瞬间阻断、重谈触发规则、历史保留、边界情形
