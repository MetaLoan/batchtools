# Qwen Image Edit · 图片编辑

> 来源：[千问 Qwen-Image-Edit 图像编辑指令编辑 API 调用方法](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api)（阿里云百炼）

## 端点

| 模式 | 端点 |
| --- | --- |
| 同步 (POST) | `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` |

> 仅支持**同步**调用。北京站 URL 为 `https://dashscope.aliyuncs.com/...`；本平台默认走新加坡。

## Headers

```
Content-Type: application/json
Authorization: Bearer ${DASHSCOPE_API_KEY}
```

## 模型变体

| model | 输出张数 | size 可选 | 备注 |
| --- | --- | --- | --- |
| `qwen-image-2.0-pro` | 1-6 | ✓ (512-2048) | Pro，文字 / 质感 / 语义最强（默认推荐） |
| `qwen-image-2.0` | 1-6 | ✓ (512-2048) | 加速版，效果与速度平衡 |
| `qwen-image-edit-max` | 1-6 | ✓ (宽高独立 512-2048) | 工业设计 / 几何推理 |
| `qwen-image-edit-plus` | 1-6 | ✓ (宽高独立 512-2048) | 多图融合 |
| `qwen-image-edit` | 1（固定） | ✗ | 基础版，自动推导尺寸 |

## 请求体

```json
{
  "model": "qwen-image-2.0-pro",
  "input": {
    "messages": [
      {
        "role": "user",
        "content": [
          { "image": "<URL|Base64|OSS临时URL>" },
          { "image": "<可选第二张>" },
          { "image": "<可选第三张>" },
          { "text": "编辑指令" }
        ]
      }
    ]
  },
  "parameters": {
    "size": "2048*2048",
    "n": 1,
    "negative_prompt": "",
    "prompt_extend": true,
    "watermark": false,
    "seed": 42
  }
}
```

**输入图：1-3 张**；多图时输出宽高比以**最后一张**为准。
**指令文本：仅 1 个**（多个或缺失会报 `InvalidParameter`）。
qwen-image-2.0 系列 text 上限 1300 token；其他模型 800 token。

## parameters 字段

| 字段 | 默认 | 范围 | 适用模型 | 备注 |
| --- | --- | --- | --- | --- |
| `n` | 1 | 1-6 | 除 `qwen-image-edit` 外 | 输出张数 |
| `size` | 自动 | 512-2048 px | 见模型列表 | 格式 `"宽*高"`，自动取 16 倍数 |
| `negative_prompt` | "" | ≤500 字符 | 全部 | 反向词 |
| `prompt_extend` | true | bool | 除 `qwen-image-edit` | 智能改写 |
| `watermark` | false | bool | 全部 | 右下角 "Qwen-Image" |
| `seed` | 随机 | [0, 2147483647] | 全部 | 不保证完全可复现 |

## 同步响应

```json
{
  "output": {
    "choices": [
      {
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": [
            { "image": "https://dashscope-...oss-...aliyuncs.com/xxx.png?Expires=..." }
          ]
        }
      }
    ]
  },
  "usage": { "image_count": 1, "width": 2048, "height": 2048 },
  "request_id": "..."
}
```

**图片 URL 24h 有效，请及时下载。**

## 错误格式

```json
{
  "request_id": "...",
  "code": "InvalidApiKey",
  "message": "Invalid API-key provided."
}
```

常见错误码：`InvalidApiKey`、`InvalidParameter`、`DataInspectionFailed`、`Throttling`、`InsufficientQuota`。
