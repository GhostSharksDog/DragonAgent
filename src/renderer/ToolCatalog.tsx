import React from 'react';
import type { Snapshot } from '../shared/contracts';
export function ToolCatalog({state}:{state:Snapshot}) {
  const deepseek=state.settings.profiles.some(p=>{try{return new URL(p.baseUrl).hostname==='api.deepseek.com'&&p.hasKey;}catch{return false;}});
  const vision=state.settings.profiles.some(p=>p.hasKey&&/^deepseek-flash$|^deepseek-v4-flash-vision-exp$/i.test(p.model));
  const tools=[['文件与产物','读取、搜索、版本核对后写入，以及文件预览','内置 · 遵循会话授权'],['浏览器','独立 Chrome 会话、页面读取与操作','内置 · 使用时检查本机 Chrome'],['网页读取','直接抓取公开网页，失败转 DeepSeek Fetch',deepseek?'DeepSeek 备用通道已配置':'直接抓取可用 · DeepSeek 备用未配置'],['Git','只读状态、提交、差异和分支','内置 · 使用时检查系统 Git'],['SQLite','表结构与只读查询，超时停止','内置 · 遵循目录授权'],['记忆','读取及用户确认后保存长期记忆','内置'],['时间','当前时间与 IANA 时区转换','内置'],['图像理解','使用用户配置的 DeepSeek Flash 分析图片',vision?'已配置兼容模型':'需配置 DeepSeek Flash'],['GitHub','仓库、代码搜索、Issue 和 PR','通过下方官方 MCP 连接']];
  return <section className="settings-card"><h2>常用工具</h2><div className="tool-catalog">{tools.map(([name,description,status])=><article key={name}><strong>{name}</strong><p>{description}</p><small>{status}</small></article>)}</div><p className="hint">连接或权限不足时会显示实际错误。网页搜索与识图不会替代文件修改或 GitHub 写操作。</p></section>;
}
