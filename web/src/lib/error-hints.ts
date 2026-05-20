interface ErrorHint {
  title: string;
  hints: string[];
}

/**
 * Map DashScope error codes to friendlier Chinese messages + actionable hints.
 * Falls back to the raw message if the code isn't recognised.
 */
export function explainProviderError(code: string | undefined, message: string | undefined): ErrorHint {
  const c = (code ?? '').trim();
  const m = (message ?? '').trim();

  const map: Record<string, ErrorHint> = {
    InvalidApiKey: {
      title: 'API Key 无效',
      hints: [
        '常见原因：账户里填的 Key 与所选地域不匹配（北京 Key 不能用于新加坡站，反之亦然）',
        '或者：Key 被吊销 / 写错 / 没在该地域开通',
        '到「设置 → DashScope 账户」检查地域与 Key',
      ],
    },
    InvalidParameter: {
      title: '请求参数不合法',
      hints: [
        '检查参数是否在模型支持的范围内（如分辨率组合、时长上限）',
        '部分参数与所选模型有关，切模型后请重新核对',
      ],
    },
    DataInspectionFailed: {
      title: '内容审核未通过',
      hints: [
        'Prompt 或参考图被识别为敏感内容',
        '如确认是误判，可在账户设置中开启「关闭数据检查」（可能违反 DashScope 使用条款，自行评估）',
      ],
    },
    IPInfringementSuspect: {
      title: '疑似侵权内容',
      hints: ['Prompt 或参考素材涉嫌侵犯第三方知识产权', '调整描述或更换素材后重试'],
    },
    Throttling: {
      title: '请求过于频繁',
      hints: ['DashScope 端限流，请稍后再试', '或调小账户的「并发上限」与「速率」'],
    },
    InsufficientQuota: {
      title: '配额或余额不足',
      hints: ['DashScope 账户余额不足或已超出当月配额', '前往阿里云控制台充值'],
    },
    ModelNotExisted: {
      title: '模型不存在或未开通',
      hints: ['当前 Key 没有调用该模型的权限', '前往阿里云控制台为该模型开通权限'],
    },
    AccountUnavailable: {
      title: '账户不可用',
      hints: ['阿里云账户状态异常（欠费/冻结）', '前往阿里云控制台处理'],
    },
    AccountNotFound: {
      title: '内部错误',
      hints: ['账户记录已被删除，请重新添加'],
    },
    NoApiKey: {
      title: '内部错误',
      hints: ['账户未配置 API Key'],
    },
  };

  if (map[c]) return map[c];

  // Partial-match by message content for unmapped codes
  if (/api[-_ ]?key/i.test(m)) return map.InvalidApiKey;
  if (/quota|balance|insufficient/i.test(m)) return map.InsufficientQuota;
  if (/throttl|rate limit|too many/i.test(m)) return map.Throttling;

  return {
    title: c || '错误',
    hints: m ? [m] : ['未知错误'],
  };
}
