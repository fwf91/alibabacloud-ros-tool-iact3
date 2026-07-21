# Page Agent 技术分享：Web 前端 AI Agent 集成方案

> 基于 alibaba/page-agent 的 iact3 Web 服务智能化升级技术分析

---

## 目录

1. [项目背景与动机](#1-项目背景与动机)
2. [Page Agent 核心架构解析](#2-page-agent-核心架构解析)
3. [DOM Dehydration 技术深度剖析](#3-dom-dehydration-技术深度剖析)
4. [Agent Loop 执行机制](#4-agent-loop-执行机制)
5. [iact3 集成方案设计](#5-iact3-集成方案设计)
6. [典型应用场景](#6-典型应用场景)
7. [技术挑战与解决方案](#7-技术挑战与解决方案)
8. [性能与安全考量](#8-性能与安全考量)
9. [与业界方案对比](#9-与业界方案对比)
10. [实施路线图](#10-实施路线图)
11. [总结与展望](#11-总结与展望)

---

## 1. 项目背景与动机

### 1.1 iact3 现状

iact3 是阿里云 ROS (Resource Orchestration Service) 的 IaC 模板测试工具，其 Web 前端服务具备：

| 模块 | 功能 | 技术栈 |
|------|------|--------|
| Playground | 模板编辑、参数配置、测试运行 | Vanilla JS + textarea |
| Projects | 项目 CRUD、版本管理 | SPA + REST API |
| Tasks | 任务监控、日志查看、报告生成 | 轮询 + WebSocket |

**当前痛点：**
- 用户需要手动填写大量表单字段（Region、参数、选项）
- 模板编辑缺乏智能辅助
- 多步骤操作流程繁琐（创建项目 → 配置参数 → 选择地域 → 运行测试）
- 新手上手成本高，需要理解 ROS/Terraform 概念

### 1.2 为什么选择 Page Agent

| 特性 | Page Agent | 传统 RPA | 截图式 Agent |
|------|-----------|----------|-------------|
| 部署方式 | 纯前端 JS | 需要 Python/Node 后端 | 需要 Headless Browser |
| 感知方式 | DOM 文本解析 | 选择器硬编码 | 视觉识别 |
| LLM 要求 | 文本模型即可 | 无需 LLM | 需要多模态模型 |
| 集成成本 | 一行 script 标签 | 中等 | 高 |
| 隐私安全 | 数据不出浏览器 | 服务端处理 | 截图上传 |

**核心优势：**
- 🎯 **零基础设施**：无需额外后端服务，纯客户端运行
- 📖 **文本驱动**：DOM 脱水技术，无需多模态模型
- 🧠 **模型无关**：支持 OpenAI、通义千问、本地 Ollama 等
- 🔒 **隐私友好**：所有操作在浏览器内完成

---

## 2. Page Agent 核心架构解析

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Page Agent Architecture                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   User UI    │    │  PageAgent   │    │   LLM API    │       │
│  │  (Chat/CLI)  │◄──►│    Core      │◄──►│  (OpenAI等)  │       │
│  └──────────────┘    └──────┬───────┘    └──────────────┘       │
│                             │                                    │
│                             ▼                                    │
│                    ┌────────────────┐                            │
│                    │  Agent Loop    │                            │
│                    │  (执行循环)     │                            │
│                    └────────┬───────┘                            │
│                             │                                    │
│              ┌──────────────┼──────────────┐                     │
│              ▼              ▼              ▼                     │
│     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│     │    DOM       │ │   Action     │ │   History    │         │
│     │  Dehydration │ │  Executor    │ │   Manager    │         │
│     │  (DOM脱水)    │ │  (动作执行)   │ │  (历史管理)   │         │
│     └──────────────┘ └──────────────┘ └──────────────┘         │
│                             │                                    │
│                             ▼                                    │
│                    ┌────────────────┐                            │
│                    │   Web Page     │                            │
│                    │   (目标页面)    │                            │
│                    └────────────────┘                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块职责

#### PageAgent Core
```typescript
import { PageAgent } from 'page-agent'

const agent = new PageAgent({
  // LLM 配置（必需）
  model: 'qwen3.5-plus',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'YOUR_API_KEY',
  
  // 可选配置
  language: 'zh-CN',           // 交互语言
  systemPrompt: '...',         // 自定义系统提示词
  maxSteps: 20,                // 最大执行步数
  enableHistory: true,         // 启用历史记录
})

// 执行自然语言指令
await agent.execute('点击运行测试按钮')
```

#### PageAgentCore（嵌入式集成）
```typescript
import { PageAgentCore } from '@page-agent/core'
import { PageController } from '@page-agent/page'

// 适用于将 PageAgent 嵌入到其他 Agent 系统中
const core = new PageAgentCore({
  controller: new PageController(),
  // ... 配置
})
```

### 2.3 数据流

```
用户指令 → 意图解析 → DOM 快照 → 上下文构建 → LLM 推理 → 动作生成 → 执行 → 结果反馈
    │                                                                            │
    └────────────────────────────── 循环直到任务完成 ◄─────────────────────────────┘
```

---

## 3. DOM Dehydration 技术深度剖析

### 3.1 什么是 DOM Dehydration

DOM Dehydration（DOM 脱水）是 Page Agent 的核心创新，它将复杂的 DOM 树压缩为紧凑的文本表示，使 LLM 能够"理解"页面结构。

**传统方式 vs DOM Dehydration：**

| 方式 | 输入 | Token 消耗 | 准确性 |
|------|------|-----------|--------|
| 截图 + 视觉模型 | 图片 | 高（图像编码） | 依赖分辨率 |
| 原始 HTML | 完整 DOM | 极高（冗余多） | 高但成本大 |
| **DOM Dehydration** | 压缩文本 | **低** | **高** |

### 3.2 脱水过程

```
原始 DOM                          脱水后文本
─────────────────────────────────────────────────────────────
<div class="playground">         [1] <div.playground>
  <div class="pg-toolbar">       [2]   <div.pg-toolbar>
    <button id="btn-run">        [3]     <button#btn-run> "Run Test"
      Run Test                   [4]     <select#region> options: [...]
    </button>                    [5]   </div>
    <select id="region">         [6]   <textarea#template-editor>
      <option>cn-hangzhou</opt>  [7] </div>
    </select>
  </div>
  <textarea id="template">
  </textarea>
</div>
```

### 3.3 脱水策略

#### 3.3.1 交互元素识别
```javascript
// 识别可交互元素
const interactiveSelectors = [
  'button', 'a[href]', 'input', 'select', 'textarea',
  '[role="button"]', '[onclick]', '[tabindex]',
  '.btn', '.clickable'  // 自定义选择器
]
```

#### 3.3.2 信息保留策略
- **保留**：元素类型、ID、关键 class、文本内容、placeholder、选项列表
- **丢弃**：样式属性、事件处理器、非关键 class、注释节点
- **压缩**：嵌套层级用缩进表示，重复结构用模式标记

#### 3.3.3 索引映射
每个可交互元素分配唯一索引，LLM 通过索引引用元素：
```
[3] <button#btn-run> "Run Test"  →  LLM 输出: click [3]
```

### 3.4 与 browser-use 的关系

Page Agent 的 DOM 处理组件和提示词源自 [browser-use](https://github.com/browser-use/browser-use) 项目：

```
browser-use (Python, 服务端)
    │
    │  DOM 处理逻辑移植
    ▼
Page Agent (JavaScript, 客户端)
    │
    │  创新点
    ▼
- 纯客户端执行
- 无需截图/视觉模型
- 浏览器内完成所有操作
```

---

## 4. Agent Loop 执行机制

### 4.1 执行循环流程

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Loop                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────┐                                               │
│   │  START  │                                               │
│   └────┬────┘                                               │
│        │                                                     │
│        ▼                                                     │
│   ┌─────────────────┐                                       │
│   │ 1. 获取 DOM 快照 │◄─────────────────────────────────┐   │
│   └────────┬────────┘                                   │   │
│            │                                             │   │
│            ▼                                             │   │
│   ┌─────────────────┐                                   │   │
│   │ 2. DOM 脱水压缩  │                                   │   │
│   └────────┬────────┘                                   │   │
│            │                                             │   │
│            ▼                                             │   │
│   ┌─────────────────┐                                   │   │
│   │ 3. 构建 Prompt   │                                   │   │
│   │   - 系统提示     │                                   │   │
│   │   - 页面状态     │                                   │   │
│   │   - 历史记录     │                                   │   │
│   │   - 用户指令     │                                   │   │
│   └────────┬────────┘                                   │   │
│            │                                             │   │
│            ▼                                             │   │
│   ┌─────────────────┐                                   │   │
│   │ 4. LLM 推理     │                                   │   │
│   └────────┬────────┘                                   │   │
│            │                                             │   │
│            ▼                                             │   │
│   ┌─────────────────┐      ┌─────────┐                  │   │
│   │ 5. 解析动作      │─────►│ 完成？  │──Yes──► END      │   │
│   └────────┬────────┘      └─────────┘                  │   │
│            │                    │ No                      │   │
│            ▼                    │                         │   │
│   ┌─────────────────┐          │                         │   │
│   │ 6. 执行动作      │          │                         │   │
│   │   - click       │          │                         │   │
│   │   - type        │          │                         │   │
│   │   - select      │          │                         │   │
│   │   - scroll      │          │                         │   │
│   └────────┬────────┘          │                         │   │
│            │                    │                         │   │
│            ▼                    │                         │   │
│   ┌─────────────────┐          │                         │   │
│   │ 7. 等待稳定      │          │                         │   │
│   └────────┬────────┘          │                         │   │
│            │                    │                         │   │
│            └────────────────────┴─────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 支持的动作类型

| 动作 | 描述 | 示例 |
|------|------|------|
| `click` | 点击元素 | `click [3]` |
| `type` | 输入文本 | `type [5] "cn-hangzhou"` |
| `select` | 选择下拉选项 | `select [4] "cn-beijing"` |
| `scroll` | 滚动页面 | `scroll down` |
| `extract` | 提取文本 | `extract [7]` |
| `wait` | 等待 | `wait 1000` |
| `done` | 任务完成 | `done "测试已启动"` |

### 4.3 错误处理与重试

```javascript
// 动作执行失败时的处理
{
  maxRetries: 3,           // 最大重试次数
  retryDelay: 500,         // 重试间隔
  fallbackStrategy: 'ask', // 失败后策略: ask | skip | abort
  onStepError: (error, step) => {
    console.log(`Step ${step} failed: ${error}`)
  }
}
```

---

## 5. iact3 集成方案设计

### 5.1 集成架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    iact3 Web + Page Agent                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Frontend (Browser)                     │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │   │
│  │  │  iact3 UI  │  │ Page Agent │  │   AI Chat Panel    │  │   │
│  │  │ (现有功能)  │◄─┤   Core     │◄─┤   (新增交互入口)   │  │   │
│  │  └────────────┘  └─────┬──────┘  └────────────────────┘  │   │
│  │                        │                                  │   │
│  │                        ▼                                  │   │
│  │              ┌──────────────────┐                         │   │
│  │              │  DOM Dehydration │                         │   │
│  │              │  + Action Exec   │                         │   │
│  │              └──────────────────┘                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              │ LLM API Call                      │
│                              ▼                                   │
│                    ┌──────────────────┐                          │
│                    │   LLM Service    │                          │
│                    │ (通义千问/GPT等)  │                          │
│                    └──────────────────┘                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Backend (aiohttp)                      │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │   │
│  │  │ REST API   │  │ TestRunner │  │   ROS/Terraform    │  │   │
│  │  │ (routes.py)│  │ (runner.py)│  │      Plugin        │  │   │
│  │  └────────────┘  └────────────┘  └────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 集成方式选择

#### 方案 A：CDN 引入（快速验证）
```html
<!-- index.html -->
<script 
  src="https://cdn.jsdelivr.net/npm/page-agent@1.12.2/dist/iife/page-agent.js"
  crossorigin="anonymous">
</script>
<script>
  const agent = new window.PageAgent({
    model: 'qwen3.5-plus',
    baseURL: '/api/llm/proxy',  // 通过后端代理
    apiKey: 'managed-by-backend',
    language: 'zh-CN',
  })
</script>
```

#### 方案 B：NPM 模块化（生产推荐）
```bash
npm install page-agent
```

```javascript
// static/agent.js
import { PageAgent } from 'page-agent'

export function initAgent(config) {
  return new PageAgent({
    model: config.model || 'qwen3.5-plus',
    baseURL: config.baseURL || '/api/llm/proxy',
    apiKey: config.apiKey,
    language: config.language || 'zh-CN',
    systemPrompt: buildSystemPrompt(),
  })
}

function buildSystemPrompt() {
  return `你是 iact3 IaC 测试工具的 AI 助手。
你可以帮用户：
- 编辑 ROS/Terraform 模板
- 配置测试参数
- 选择运行地域
- 执行测试任务
- 查看测试报告和日志

当前页面结构会在每次操作时提供给你。`
}
```

### 5.3 后端代理设计

为避免在前端暴露 API Key，设计后端代理：

```python
# routes.py 新增
@routes.post('/api/llm/proxy')
async def llm_proxy(request):
    """代理 LLM API 请求，隐藏 API Key"""
    body = await request.json()
    
    # 从环境变量或配置文件读取真实 API Key
    api_key = os.environ.get('DASHSCOPE_API_KEY')
    
    async with aiohttp.ClientSession() as session:
        async with session.post(
            'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
            json=body,
            headers={'Authorization': f'Bearer {api_key}'}
        ) as resp:
            return web.json_response(await resp.json())
```

### 5.4 UI 集成点

```html
<!-- 在 index.html 中添加 AI 助手入口 -->
<div id="ai-assistant-panel" class="ai-panel hidden">
  <div class="ai-panel-header">
    <span>AI 助手</span>
    <button id="ai-panel-close">×</button>
  </div>
  <div class="ai-panel-messages" id="ai-messages"></div>
  <div class="ai-panel-input">
    <input type="text" id="ai-input" placeholder="输入指令，如：帮我创建一个 VPC 模板测试">
    <button id="ai-send">发送</button>
  </div>
</div>

<!-- 悬浮按钮 -->
<button id="ai-assistant-btn" class="ai-float-btn">🤖</button>
```

---

## 6. 典型应用场景

### 6.1 智能表单填充

**场景**：用户说"帮我配置一个杭州地域的 ECS 实例测试"

```
用户指令: "帮我配置一个杭州地域的 ECS 实例测试"

Agent 执行步骤:
1. 识别当前在 Playground 页面
2. 点击 "ROS Example" 加载示例模板
3. 在 Region 下拉框选择 "cn-hangzhou"
4. 点击 "Auto Generate" 生成参数
5. 在参数编辑器中填入合适的 ZoneId
6. 回复用户: "已配置完成，点击 Run Test 即可开始测试"
```

### 6.2 模板智能编辑

**场景**：用户说"在模板中添加一个安全组资源"

```
Agent 执行:
1. 定位到模板编辑器
2. 分析当前模板结构
3. 在 Resources 部分插入:
   SecurityGroup:
     Type: ALIYUN::ECS::SecurityGroup
     Properties:
       SecurityGroupName: my-sg
       VpcId:
         Ref: Vpc
4. 更新编辑器内容
```

### 6.3 任务诊断助手

**场景**：测试失败后，用户问"为什么测试失败了？"

```
Agent 执行:
1. 导航到 Tasks 页面
2. 找到最近失败的任务
3. 点击进入详情页
4. 切换到 Logs 标签
5. 提取错误日志
6. 分析失败原因并回复:
   "测试失败原因：VSwitch 创建时指定的可用区 cn-hangzhou-a 
    不支持所选实例类型。建议更换可用区或实例类型。"
```

### 6.4 自然语言导航

| 用户指令 | Agent 动作 |
|---------|-----------|
| "查看我的项目" | 导航到 Projects 页面 |
| "打开最近的任务" | 导航到 Tasks 并点击第一条 |
| "显示测试报告" | 点击 Report 按钮打开报告弹窗 |
| "切换到中文" | 点击语言切换按钮 |

### 6.5 批量操作

**场景**：用户说"删除所有失败的任务"

```
Agent 执行:
1. 导航到 Tasks 页面
2. 在状态筛选器中选择 "Failed"
3. 点击全选复选框
4. 点击 "Batch Delete" 按钮
5. 在确认弹窗中点击 "Confirm"
6. 回复: "已删除 3 个失败任务"
```

---

## 7. 技术挑战与解决方案

### 7.1 挑战一：动态内容识别

**问题**：iact3 使用 Vanilla JS 动态渲染 DOM，元素 ID 可能变化

**解决方案**：
```javascript
// 自定义 DOM 脱水配置
const agent = new PageAgent({
  // ...
  domOptions: {
    // 优先使用 data-* 属性作为稳定标识
    priorityAttributes: ['data-i18n', 'data-page', 'id'],
    // 忽略动态生成的 ID
    ignoreIdPattern: /^tmp-\d+$/,
    // 自定义元素描述
    customDescriptors: {
      '#template-editor': 'ROS/Terraform 模板代码编辑器',
      '#config-editor': 'YAML 参数配置编辑器',
      '.task-table': '测试任务列表表格',
    }
  }
})
```

### 7.2 挑战二：代码编辑器交互

**问题**：模板编辑器是 textarea + highlight 层叠结构，普通输入方式可能失效

**解决方案**：
```javascript
// 扩展动作执行器
class Iact3ActionExecutor extends ActionExecutor {
  async type(selector, text) {
    const el = document.querySelector(selector)
    if (el.id === 'template-editor' || el.id === 'config-editor') {
      // 使用原生输入事件触发高亮同步
      el.focus()
      el.value = text
      el.dispatchEvent(new Event('input', { bubbles: true }))
      // 触发 iact3 的高亮更新函数
      if (window.updateHighlight) {
        window.updateHighlight(el.id)
      }
    } else {
      await super.type(selector, text)
    }
  }
}
```

### 7.3 挑战三：异步操作等待

**问题**：测试运行是异步的，需要等待后端响应

**解决方案**：
```javascript
// 使用 waitFor 机制
await agent.execute('点击 Run Test 按钮')

// 等待任务创建完成
await agent.waitFor({
  condition: () => {
    const toast = document.querySelector('#toast')
    return toast && toast.textContent.includes('started')
  },
  timeout: 10000
})

// 继续后续操作
await agent.execute('导航到 Tasks 页面查看进度')
```

### 7.4 挑战四：多语言支持

**问题**：iact3 支持中英文切换，DOM 文本会变化

**解决方案**：
```javascript
// 系统提示词中说明多语言情况
const systemPrompt = `
你是 iact3 的 AI 助手。注意：
- 页面支持中英文切换
- 按钮文本可能是 "Run Test" 或 "运行测试"
- 使用 data-i18n 属性识别元素功能，而非文本内容
- 例如: [data-i18n="runBtn"] 总是运行测试按钮
`
```

### 7.5 挑战五：LLM 响应延迟

**问题**：每次操作都需要 LLM 推理，用户体验可能受影响

**解决方案**：
```javascript
// 1. 流式响应显示
const agent = new PageAgent({
  stream: true,
  onToken: (token) => {
    appendToChat(token)  // 实时显示思考过程
  }
})

// 2. 常用指令缓存
const commandCache = new Map()
async function executeWithCache(command) {
  const cached = commandCache.get(command)
  if (cached && Date.now() - cached.time < 60000) {
    return replayActions(cached.actions)
  }
  const result = await agent.execute(command)
  commandCache.set(command, { actions: result.steps, time: Date.now() })
  return result
}

// 3. 乐观 UI 更新
function showThinking() {
  // 显示 "AI 正在思考..." 动画
}
```

---

## 8. 性能与安全考量

### 8.1 性能优化

#### DOM 脱水优化
```javascript
// 限制脱水范围，只处理可见区域
const agent = new PageAgent({
  domOptions: {
    viewportOnly: true,        // 只处理视口内元素
    maxDepth: 10,              // 最大遍历深度
    maxElements: 200,          // 最大元素数量
    debounceMs: 300,           // 防抖延迟
  }
})
```

#### Token 消耗估算
| 页面复杂度 | 脱水后 Token | 每次操作成本 (qwen) |
|-----------|-------------|-------------------|
| 简单 (Playground) | ~800 | ¥0.002 |
| 中等 (Projects) | ~1500 | ¥0.004 |
| 复杂 (Task Detail) | ~2500 | ¥0.006 |

### 8.2 安全设计

#### API Key 保护
```
❌ 错误：前端直接存储 API Key
✅ 正确：后端代理模式

Browser → /api/llm/proxy → Backend → LLM API
              (无 Key)      (有 Key)
```

#### 权限控制
```javascript
// 限制 Agent 可执行的操作
const agent = new PageAgent({
  allowedActions: ['click', 'type', 'select', 'extract'],
  blockedSelectors: [
    '#btn-batch-delete-task',  // 禁止批量删除
    '.btn-danger',              // 禁止危险操作
  ],
  requireConfirmation: [
    'delete', 'remove', 'clear'
  ]
})
```

#### 输入验证
```javascript
// 过滤恶意指令
function sanitizeCommand(cmd) {
  const blocked = ['删除所有', '清空', 'rm -rf', 'drop table']
  if (blocked.some(b => cmd.includes(b))) {
    throw new Error('检测到危险操作，已拦截')
  }
  return cmd
}
```

### 8.3 隐私保护

- 所有 DOM 解析在浏览器本地完成
- 只将脱水后的文本发送给 LLM
- 敏感输入（密码、密钥）自动脱敏
```javascript
domOptions: {
  maskSelectors: ['input[type="password"]', '#api-key-input'],
  maskReplacement: '***'
}
```

---

## 9. 与业界方案对比

### 9.1 技术路线对比

| 方案 | 代表项目 | 感知方式 | 执行环境 | 适用场景 |
|------|---------|---------|---------|---------|
| **DOM 文本派** | Page Agent | DOM 脱水 | 浏览器内 | SaaS Copilot |
| **视觉截图派** | WebVoyager | 页面截图 | 服务端 | 复杂视觉任务 |
| **混合派** | browser-use | DOM + 截图 | Python | 通用自动化 |
| **选择器派** | Selenium | CSS/XPath | 多环境 | 测试自动化 |
| **录制回放派** | Playwright | 操作录制 | Node.js | RPA |

### 9.2 Page Agent 优势分析

```
                    易用性
                      ▲
                      │
         Page Agent ● │
                      │        ● browser-use
                      │
    Selenium ●        │
                      │
                      └────────────────────► 功能完整性
                      │
                      │     ● WebVoyager
                      │
                      │
                    集成成本
```

### 9.3 选型建议

| 场景 | 推荐方案 |
|------|---------|
| 为现有 SaaS 添加 AI 助手 | ✅ Page Agent |
| 跨网站复杂自动化 | browser-use / Playwright |
| 需要视觉理解的任务 | WebVoyager / GPT-4V |
| 端到端测试 | Selenium / Playwright |
| 内部工具 RPA | Page Agent + 自定义扩展 |

---

## 10. 实施路线图

### Phase 1：POC 验证（1-2 周）

```
目标：验证技术可行性

□ 创建 feature/page-agent-integration 分支
□ CDN 方式引入 Page Agent
□ 实现基础对话面板 UI
□ 完成 3 个核心场景验证：
  - 自然语言导航
  - 表单自动填充
  - 模板内容编辑
□ 输出：POC 演示 + 技术评估报告
```

### Phase 2：MVP 开发（2-3 周）

```
目标：可用的最小产品

□ NPM 模块化集成
□ 后端 LLM 代理接口
□ 自定义 DOM 脱水配置
□ 代码编辑器交互适配
□ 常用指令快捷面板
□ 基础错误处理
□ 输出：内部测试版本
```

### Phase 3：功能完善（3-4 周）

```
目标：生产可用

□ 流式响应优化
□ 操作历史与撤销
□ 多轮对话上下文
□ 权限与安全控制
□ 性能监控埋点
□ 用户引导教程
□ 输出：Beta 版本
```

### Phase 4：持续迭代

```
□ 基于用户反馈优化
□ 扩展更多场景
□ 探索 MCP Server 集成
□ 考虑 Chrome 扩展支持
□ 本地模型支持 (Ollama)
```

---

## 11. 总结与展望

### 11.1 核心价值

| 维度 | 价值 |
|------|------|
| **用户体验** | 自然语言交互，降低学习成本 |
| **开发效率** | 纯前端集成，无需重构后端 |
| **技术前瞻** | 拥抱 AI Agent 趋势 |
| **成本可控** | 文本模型即可，无需多模态 |
| **隐私安全** | 数据不出浏览器 |

### 11.2 关键成功因素

1. **DOM 结构稳定性**：为关键元素添加 `data-agent-*` 属性
2. **LLM 选择**：推荐通义千问 qwen3.5-plus（中文优化、成本低）
3. **渐进式增强**：AI 助手是增强而非替代，保留所有手动操作
4. **用户信任**：操作前确认、可撤销、透明化执行过程

### 11.3 未来展望

```
┌─────────────────────────────────────────────────────────────┐
│                    AI-Native IaC Testing                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   当前: 用户手动操作 → 工具执行 → 查看结果                    │
│                                                              │
│   未来: 用户描述意图 → AI 规划 → 自动执行 → 智能分析          │
│                                                              │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐ │
│   │  Intent │───►│  Plan   │───►│ Execute │───►│ Analyze │ │
│   │  理解    │    │  规划    │    │  执行    │    │  分析    │ │
│   └─────────┘    └─────────┘    └─────────┘    └─────────┘ │
│                                                              │
│   "测试这个模板在华北2和华东1的兼容性"                        │
│        │                                                     │
│        ▼                                                     │
│   AI 自动: 创建2个项目 → 配置不同Region → 并行测试 → 对比报告 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 附录

### A. 参考资源

- [Page Agent GitHub](https://github.com/alibaba/page-agent)
- [Page Agent 文档](https://alibaba.github.io/page-agent/)
- [browser-use 项目](https://github.com/browser-use/browser-use)
- [通义千问 API](https://dashscope.aliyuncs.com/)

### B. 快速开始代码

```html
<!-- 最简集成示例 -->
<!DOCTYPE html>
<html>
<head>
  <title>iact3 + Page Agent</title>
</head>
<body>
  <!-- 现有 iact3 UI -->
  <div id="app">...</div>
  
  <!-- Page Agent -->
  <script src="https://cdn.jsdelivr.net/npm/page-agent@1.12.2/dist/iife/page-agent.js"></script>
  <script>
    const agent = new window.PageAgent({
      model: 'qwen3.5-plus',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'YOUR_API_KEY',
      language: 'zh-CN',
    })
    
    // 示例：执行指令
    document.getElementById('ai-btn').onclick = async () => {
      const cmd = document.getElementById('ai-input').value
      await agent.execute(cmd)
    }
  </script>
</body>
</html>
```

### C. 术语表

| 术语 | 解释 |
|------|------|
| DOM Dehydration | DOM 脱水，将 DOM 树压缩为紧凑文本表示 |
| Agent Loop | 智能体执行循环，感知-决策-执行的迭代过程 |
| Action | 智能体可执行的动作，如 click、type |
| Step | 一次完整的感知-决策-执行周期 |
| System Prompt | 系统提示词，定义智能体的角色和能力 |

---

*文档版本: v1.0*  
*创建时间: 2026-07-21*  
*分支: feature/page-agent-integration*
