# DocViewer Markdown 示例

这是一个**零依赖**渲染的 Markdown 文件，用于验证 DocViewer 的解析能力。

## 支持的语法

- [x] 任务列表
- [ ] 未完成任务
- 行内 `code`、**粗体**、*斜体*、~~删除线~~、==高亮==

### 表格

| 功能 | 快捷键 | 状态 |
|:-----|:------:|-----:|
| 调试面板 | F3 | 完成 |
| 源码切换 | Ctrl+E | 完成 |
| 文档搜索 | Ctrl+F | 完成 |

### 代码块

```python
def parse_rtf(path: str) -> str:
    # 读取并解析 RTF
    with open(path, "rb") as f:
        raw = f.read()
    return decode(raw)  # 编码自动检测
```

### 引用与列表

> 引用块：RTF 是微软 1987 年提出的富文本交换格式。
> 第二行同样属于引用。

1. 有序列表第一项
2. 第二项
   - 嵌套无序项
   - 另一个嵌套项
3. 第三项

### 链接与图片

[访问 Markdown 规范](https://spec.commonmark.org/) 或写邮箱 <mailto:test@example.com>。

---

结束：水平分割线以上是全部示例内容。
