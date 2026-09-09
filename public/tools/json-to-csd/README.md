# Cocos Studio JSON 转 CSD 工具

## 功能说明

这是一个纯前端网页工具，用于将 Cocos Studio 导出的 JSON 文件反编译为 CSD 文件，并自动配置到项目的 `mjclient.ccs` 文件中。

## 使用方法

### 1. 打开工具

双击 `index.html` 文件，在浏览器中打开工具。

### 2. 上传 JSON 文件

- 点击上传区域选择 JSON 文件，最多 5 个
- 或直接拖拽 JSON 文件到上传区域
- 也可以点击 **导入 JSON 目录**，自动读取目录第一层最多 5 个 `.json`

### 3. 选择选项

- 建议先点击 **选择工程根目录**，选择包含 `ui` 目录的工程根目录
- 工具会自动识别 `ui/cocosstudio` 和 `ui/mjclient.ccs`
- **写入到 ui/cocosstudio/ 目录**：将生成的 CSD 文件写入到指定目录
- **修改 mjclient.ccs 文件**：自动在 CCS 文件中添加 CSD 文件引用

### 4. 开始转换

点击"批量生成 CSD"按钮。此步骤只转换内容，不会写入项目文件。

### 5. 确认写入

- 已选择工程根目录时，工具会自动定位 `ui/cocosstudio`
- 未选择工程根目录时，需要手动选择项目的 `ui/cocosstudio` 目录
- 工具会批量检查同名 `.csd` 是否存在，存在时需要确认替换后才写入
- 如果勾选了修改 `mjclient.ccs`，写入前请先关闭 Cocos Studio/UI 编辑器
- 已选择工程根目录时，工具会自动读取 `ui/mjclient.ccs`
- 工具会批量检查是否已有对应 `<Project />` 引用，已有则不重复写入

## 系统要求

- **浏览器**：Chrome 86+ 或 Edge 86+
- **操作系统**：Windows、macOS、Linux

## 注意事项

1. 建议在修改前备份 `mjclient.ccs` 文件
2. 生成的 CSD 文件版本为 3.10.0.0
3. 需要授予浏览器文件读写权限
4. 如果浏览器不支持 File System Access API，将自动使用下载方式

## 技术栈

- HTML5
- 原生 JavaScript (ES6+)
- File System Access API
- 原生 XML 字符串序列化

## 版本信息

- Cocos Studio 版本：3.10.0.0
- 项目名称：mjclient

## 常见问题

### Q: 为什么我的浏览器不支持？

A: 请使用 Chrome 86+ 或 Edge 86+ 浏览器，这些浏览器支持 File System Access API。

### Q: 转换后的 CSD 文件无法打开？

A: 请确保 JSON 文件格式正确，并且是 Cocos Studio 导出的 JSON 格式。

### Q: 如何手动添加 CSD 文件到 CCS 文件？

A: 在 `mjclient.ccs` 文件的 CSD 项目列表中添加：

```xml
<Project Name="xxx.csd" Type="Layer" />
```

## 许可证

MIT License
