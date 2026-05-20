# Wan 2.7 视频编辑

> 来源：[万相 2.7 视频编辑 API 参考](https://help.aliyun.com/zh/model-studio/wan-video-editing-api-reference)（阿里云百炼）

## 端点

| 模式 | 端点 |
| --- | --- |
| 创建任务 (POST) | `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis` |
| 查询任务 (GET) | `https://dashscope-intl.aliyuncs.com/api/v1/tasks/{task_id}` |

**纯异步**。

## Headers

```
Content-Type: application/json
Authorization: Bearer ${DASHSCOPE_API_KEY}
X-DashScope-Async: enable
```

## 模型

`model` = `wan2.7-videoedit`（唯一）

## 请求体

```json
{
  "model": "wan2.7-videoedit",
  "input": {
    "prompt": "编辑指令，≤5000 字符",
    "negative_prompt": "反向提示词，≤500 字符（可选）",
    "media": [
      { "type": "video", "url": "源视频 URL/Base64" },
      { "type": "reference_image", "url": "参考图 URL（可选 0-4 张）" }
    ]
  },
  "parameters": { "...": "..." }
}
```

### 媒体约束

| 类型 | 数量 | 格式 | 时长/大小限制 |
| --- | --- | --- | --- |
| video（必传） | 1 | mp4 / mov | 2-10 秒；240-4096 px；宽高比 1:8 ~ 8:1；≤100MB |
| reference_image（可选） | 0-4 | JPEG/PNG/BMP/WEBP | 240-8000 px；宽高比 1:8 ~ 8:1；≤20MB |

URL 支持 http(s) / OSS 临时 URL / Base64。

## parameters 字段

| 字段 | 默认 | 取值 | 备注 |
| --- | --- | --- | --- |
| `resolution` | `1080P` | `720P` / `1080P` | 输出清晰度，影响计费 |
| `ratio` | 跟随输入 | `16:9` / `9:16` / `1:1` / `4:3` / `3:4` | 宽高比 |
| `duration` | 0 | [2, 10] | 输出时长（秒）；0 = 跟随输入视频 |
| `audio_setting` | `auto` | `auto` / `origin` | `auto` 智能判断；`origin` 保留原声 |
| `prompt_extend` | true | bool | 智能改写 |
| `watermark` | false | bool | "AI 生成" 标识 |
| `seed` | 随机 | [0, 2147483647] | 可复现性 |

## 编辑模式

无独立参数切换，通过 **prompt + media 组合** 实现：

1. **整体风格变换**：仅传 1 个 video，prompt 描述目标风格，如「转换为黏土风格」
2. **局部替换 / 融合**：传 video + 1-N 张 reference_image，prompt 描述替换/融合任务

## 响应

**创建任务**：
```json
{ "output": { "task_id": "...", "task_status": "PENDING" }, "request_id": "..." }
```

**查询成功**：
```json
{
  "output": {
    "task_status": "SUCCEEDED",
    "video_url": "https://...mp4 (24h 有效)",
    "submit_time": "...",
    "end_time": "..."
  },
  "usage": {
    "duration": 12,
    "input_video_duration": 8,
    "output_video_duration": 4
  }
}
```

## 状态机

`PENDING` → `RUNNING` → `SUCCEEDED` / `FAILED` / `CANCELED` / `UNKNOWN`

- task_id 有效期 24h（之后 `UNKNOWN`）
- 视频 URL 有效期 24h（需及时下载或转存）
- 推荐轮询间隔 15 秒
- 通常 1-5 分钟出片

## 计费

按 `usage.duration = input_video_duration + output_video_duration`（秒）+ 分辨率档位。

## 错误格式

```json
{ "code": "InvalidApiKey", "message": "...", "request_id": "..." }
```
