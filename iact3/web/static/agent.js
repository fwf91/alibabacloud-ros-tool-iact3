/**
 * iact3 AI Assistant - Powered by Page Agent
 * https://github.com/alibaba/page-agent
 */
(function () {
    'use strict';

    // ========== State ==========
    let pageAgent = null;
    let isProcessing = false;
    let panelVisible = false;

    // ========== DOM Elements ==========
    const $ = (sel) => document.querySelector(sel);
    const panel = $('#ai-assistant-panel');
    const floatBtn = $('#ai-assistant-btn');
    const messagesEl = $('#ai-messages');
    const inputEl = $('#ai-input');
    const sendBtn = $('#ai-send');
    const statusEl = $('#ai-status');
    const statusText = $('#ai-status-text');
    const closeBtn = $('#ai-panel-close');
    const clearBtn = $('#ai-panel-clear');
    const quickBtns = document.querySelectorAll('.ai-quick-btn');

    // ========== System Prompt ==========
    // IaC 知识库来源于 aliyun/iac-code 项目
    const iacKnowledge = (typeof window.IAC_KNOWLEDGE !== 'undefined')
        ? window.IAC_KNOWLEDGE.getCompactKnowledge()
        : '';

    const SYSTEM_PROMPT = `你是 iact3 的 AI 助手。iact3 是阿里云 ROS/Terraform 模板测试工具。
你同时具备阿里云 IaC 专业知识，能帮助用户编写模板、选择规格、规划网络。

## 身份认知（最重要）
- 你就是 AI 助手本身，你通过直接操作页面元素来完成任务
- 严禁点击 AI 助手按钮（#ai-assistant-btn）、严禁操作 AI 助手面板（#ai-assistant-panel）
- 严禁点击“查看任务”快捷按钮、严禁操作 AI 输入框（#ai-input）
- 你要操作的是页面主内容区的元素：模板编辑器、参数生成按钮、运行按钮、费用估算按钮等
- 如果用户说“生成模板”，你要直接操作模板编辑器和按钮，不是“发送消息给AI助手”

## 调用 done 前的自检（每次调用 done 前必须执行）
在调用 done 之前，你必须问自己：
1. 用户要求的核心操作是否已经执行？（导航只是手段，不是目的）
2. 如果用户要求"删除"，是否已经点击了确认弹窗的确认按钮？
3. 如果用户要求"查看"，是否已经打开了详情页并读取了内容？
4. 如果只完成了导航，严禁调用 done——继续执行后续操作

## 核心规则
- 严禁在仅完成导航后就调用 done。导航是第一步，不是最后一步
- "删除" = 导航 + 勾选 + 点击批量删除 + 点击确认弹窗，4 步缺一不可
- "查看" = 导航 + 点击目标任务 + 读取详情内容，3 步缺一不可
- “前两个/前三个”指列表中最上面的 N 个项目
- 每步只做一件事，不要犹豫
- 如果确实无法继续（如元素不存在），才调用 done 并说明原因
- 当用户询问模板/规格/网络规划时，使用下方的 IaC 专业知识回答

## 常见工作流

### 生成模板并询价
1. 如果在 Playground 页面，确认当前是 ROS 模式（如果不是，点击 ROS 标签）
2. 点击模板编辑器文本框（#template-editor）使其聚焦，然后清空内容
3. 使用 type 工具将 ECS 模板内容输入到 #template-editor 中
   - 使用下方 IaC 专业知识中的“ECS ROS 模板示例”的完整内容
   - 模板内容从 ROSTemplateFormatVersion 开始到 Outputs 结束
   ⚠️ 严禁在此步 done
4. 点击 "Auto Generate" 按钮 (#btn-generate-params) 生成参数
   ⚠️ 严禁在此步 done
5. 等待参数生成完成（观察页面提示或按钮状态变化）
6. 点击 "Estimate Cost" 按钮 (#btn-cost) 进行询价
   ⚠️ 严禁在此步 done
7. 等待询价完成，点击 "Cost" 标签页查看结果
8. 调用 done 汇报询价结果（包含月费用、资源类型、规格等）

### 配置并运行测试
1. 如在 Playground 页面，点击 "ROS Example" 或 "Terraform Example" 加载模板
2. 点击地域选择器（Region 下拉框），选择目标地域
3. 点击 "Auto Generate" 按钮自动生成参数
4. 点击 "Run Test" 按钮运行测试
5. 调用 done 告知用户测试已启动

### 查看任务结果（不可在导航后 done）
1. 如果不在任务页面，先点击侧边栏 "Tasks" [data-page="tasks"] 导航
   ⚠️ 导航后严禁调用 done，必须继续下一步
2. 点击目标任务行（.task-name-link）查看详情
   ⚠️ 打开详情后严禁调用 done，必须继续下一步
3. 在详情页查看资源栈状态、错误信息
4. 调用 done 汇报详细结果（包含失败原因、错误信息等具体内容，不能只说"已导航"）

### 查看最近一次失败任务原因
1. 点击侧边栏 "Tasks" [data-page="tasks"] 导航到任务列表
   ⚠️ 严禁在此步 done
2. 找到状态为"失败"的任务（红色徽章），点击任务名称（.task-name-link）
   ⚠️ 严禁在此步 done
3. 在详情页查看"资源栈"标签页，找到失败状态 (CREATE_FAILED) 的资源栈
4. 点击失败资源栈展开详情，查看错误信息
5. 调用 done 汇报失败原因（包含区域、资源类型、错误消息）

### 删除任务（4 步缺一不可，严禁提前 done）
1. 如果不在任务页面，先点击侧边栏 "Tasks" [data-page="tasks"] 导航
   ⚠️ 严禁在此步 done，导航不是删除
2. 勾选要删除的任务行的复选框（.task-row-checkbox）。“前两个”=列表中最上面的两个复选框
   ⚠️ 严禁在此步 done，勾选不是删除
3. 点击 "Batch Delete" 按钮 (#btn-batch-delete-task)
   ⚠️ 严禁在此步 done，必须处理确认弹窗
4. 等待确认弹窗出现，点击弹窗中的 "确认"/"OK" 按钮 (#confirm-modal-ok)
5. 等待删除操作完成（观察 toast 提示或列表刷新）
6. 调用 done 告知用户删除了哪些任务

### 查看任务模板内容
1. 如果已在某个任务详情页，先点击 "Back" 按钮 (#btn-detail-back) 返回任务列表
   ⚠️ 严禁在此步 done
2. 点击侧边栏 "Tasks" [data-page="tasks"] 导航到任务列表
   ⚠️ 严禁在此步 done
3. 点击目标任务名称（.task-name-link）进入详情页
   ⚠️ 严禁在此步 done
4. 在详情页点击 "Template" 标签页 ([data-td-tab="template"]) 查看模板内容
   ⚠️ 严禁在此步 done
5. 读取模板内容并调用 done 汇报（包含模板的 ROSTemplateFormatVersion、Resources、Parameters 等关键信息）

## 页面元素说明
- 侧边栏导航: [data-page="playground"], [data-page="tasks"], [data-page="projects"]
- 返回按钮: #btn-detail-back (在任务详情页返回任务列表)
- 模板编辑器: #template-editor (Playground 页面的文本框，可直接输入模板内容)
- ROS/Terraform 模式切换: 点击 [data-template-tab="ros"] 或 [data-template-tab="terraform"]
- 任务行复选框: .task-row-checkbox (每行一个，按列表顺序)
- 任务名称链接: .task-name-link (点击进入详情)
- 全选复选框: #task-select-all-header
- 批量删除按钮: #btn-batch-delete-task
- 任务详情标签页: [data-td-tab="overview"](概览), [data-td-tab="stacks"](资源栈), [data-td-tab="template"](模板), [data-td-tab="params"](配置), [data-td-tab="logs"](日志)
- 地域选择器: 点击 #pg-region-trigger 打开下拉，然后点击选项
- 运行按钮: #btn-run
- 费用估算按钮: #btn-cost (生成模板后点击进行询价)
- 策略生成按钮: #btn-policy
- 自动生成参数: #btn-generate-params
- 费用结果区域: #result-cost
- 确认弹窗按钮: #confirm-modal-ok (确认), #confirm-modal-cancel (取消)

${iacKnowledge}

Be concise. Act fast. NEVER call done after just navigating to a page. Complete ALL steps before calling done.`;

    // ========== Initialize Page Agent ==========
    async function initPageAgent() {
        if (typeof window.PageAgent === 'undefined') {
            console.warn('[AI Assistant] Page Agent not loaded');
            return null;
        }

        try {
            // Dynamically add data-page-agent-ignore to AI panel elements
            // This ensures it works even if HTML is cached without the attribute
            const aiPanel = document.getElementById('ai-assistant-panel');
            const aiBtn = document.getElementById('ai-assistant-btn');
            if (aiPanel) aiPanel.setAttribute('data-page-agent-ignore', '');
            if (aiBtn) aiBtn.setAttribute('data-page-agent-ignore', '');

            // Check if backend LLM proxy is configured
            let llmConfig = { configured: false };
            try {
                const resp = await fetch('/api/llm/config');
                llmConfig = await resp.json();
            } catch (e) {
                console.log('[AI Assistant] LLM config check failed, using demo mode');
            }

            let agentOptions;

            // Common options to reduce DOM payload size (fixes HTTP 413)
            const commonOptions = {
                language: 'zh-CN',
                viewportExpansion: 0,  // Only process elements in viewport
                maxSteps: 20,          // Complex workflows need enough steps
                interactiveBlacklist: [
                    // Exclude AI assistant panel and button - Page Agent must NOT see itself
                    document.getElementById('ai-assistant-panel'),
                    document.getElementById('ai-assistant-btn'),
                    document.getElementById('ai-input'),
                    document.getElementById('ai-send'),
                    document.getElementById('ai-messages'),
                    document.getElementById('ai-quick-actions'),
                    document.getElementById('ai-status'),
                    // Exclude large/complex areas from DOM dehydration
                    document.getElementById('config-editor'),
                    document.getElementById('report-iframe'),
                    document.getElementById('template-highlight'),
                    document.getElementById('config-highlight'),
                    document.getElementById('template-line-numbers'),
                ].filter(Boolean),
            };

            if (llmConfig.configured) {
                // Use backend proxy with real LLM
                agentOptions = {
                    ...commonOptions,
                    model: 'qwen3.7-max',
                    baseURL: window.location.origin + '/api/llm/proxy',
                    apiKey: 'proxy-managed',
                };
                console.log('[AI Assistant] Using backend LLM proxy (qwen3.7-max)');
            } else {
                // Try to auto-configure from localStorage
                const savedKey = localStorage.getItem('iact3-llm-key');
                if (savedKey) {
                    try {
                        const setResp = await fetch('/api/llm/config', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({apiKey: savedKey}),
                        });
                        const setResult = await setResp.json();
                        if (setResult.configured) {
                            agentOptions = {
                                ...commonOptions,
                                model: 'qwen3.7-max',
                                baseURL: window.location.origin + '/api/llm/proxy',
                                apiKey: 'proxy-managed',
                            };
                            console.log('[AI Assistant] Auto-configured from localStorage, using proxy');
                        }
                    } catch (e) {
                        console.warn('[AI Assistant] Auto-config failed:', e);
                    }
                }
                // If still not configured, fallback to demo
                if (!agentOptions) {
                    agentOptions = {
                        ...commonOptions,
                        model: 'qwen3.5-plus',
                        baseURL: 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run',
                        apiKey: 'NA',
                    };
                    console.warn('[AI Assistant] No API key configured, using demo LLM (limited). Run setLLMKey("sk-xxx") in console to configure.');
                }
            }

            const agent = new window.PageAgent(agentOptions);

            // Hide the built-in panel (we use our own UI)
            if (agent.panel) {
                agent.panel.hide();
            }

            console.log('[AI Assistant] Page Agent initialized, execute method:', typeof agent.execute);
            return agent;
        } catch (err) {
            console.error('[AI Assistant] Failed to initialize Page Agent:', err);
            return null;
        }
    }

    // ========== UI Helpers ==========
    async function togglePanel(show) {
        panelVisible = show !== undefined ? show : !panelVisible;
        panel.classList.toggle('hidden', !panelVisible);
        if (panelVisible) {
            inputEl.focus();
            // Initialize agent on first open
            if (!pageAgent) {
                setStatus(true, t('aiInitializing'));
                pageAgent = await initPageAgent();
                setStatus(false);
            }
        }
    }

    function addMessage(content, type = 'assistant') {
        const msgEl = document.createElement('div');
        msgEl.className = `ai-message ai-message-${type}`;
        msgEl.innerHTML = `<div class="ai-message-content">${escapeHtml(content)}</div>`;
        messagesEl.appendChild(msgEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addErrorMessage(content) {
        const msgEl = document.createElement('div');
        msgEl.className = 'ai-message ai-message-error';
        msgEl.innerHTML = `<div class="ai-message-content">${escapeHtml(content)}</div>`;
        messagesEl.appendChild(msgEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function clearMessages() {
        const clearedMsg = typeof t === 'function' ? t('aiChatCleared') : 'Chat cleared. How can I help you?';
        messagesEl.innerHTML = `
            <div class="ai-message ai-message-assistant">
                <div class="ai-message-content">${escapeHtml(clearedMsg)}</div>
            </div>
        `;
        // Reset Page Agent so next command creates a fresh instance
        // (previous instance may have been disposed by Page Agent internally)
        pageAgent = null;
    }

    function setStatus(visible, text) {
        statusEl.classList.toggle('hidden', !visible);
        if (text) statusText.textContent = text;
    }

    function setInputEnabled(enabled) {
        inputEl.disabled = !enabled;
        sendBtn.disabled = !enabled;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== Extract Result from Agent History ==========
    // Only search entries added after startIndex to avoid stale results
    function extractAgentResult(startIndex = 0) {
        if (!pageAgent) return null;
        const fullHistory = pageAgent.history || [];
        // Only look at new entries from this execution
        const history = fullHistory.slice(startIndex);
        if (history.length === 0) return null;

        // Strategy 1: Find last 'done' action with text
        const lastDone = [...history].reverse().find(h =>
            h.type === 'step' && h.action && h.action.name === 'done'
        );
        if (lastDone && lastDone.action.input && lastDone.action.input.text) {
            return lastDone.action.input.text;
        }

        // Strategy 2: Find last observation with meaningful content
        const lastObs = [...history].reverse().find(h =>
            h.type === 'observation' && h.content && h.content.length > 20
        );
        if (lastObs) {
            return lastObs.content;
        }

        // Strategy 3: Find last step with reflection (contains analysis)
        const lastReflection = [...history].reverse().find(h =>
            h.type === 'step' && h.reflection && h.reflection.evaluation_previous_goal
        );
        if (lastReflection && lastReflection.reflection.evaluation_previous_goal) {
            return lastReflection.reflection.evaluation_previous_goal;
        }

        // Strategy 4: Find last action output
        const lastAction = [...history].reverse().find(h =>
            h.type === 'step' && h.action && h.action.output && h.action.output.length > 10
        );
        if (lastAction) {
            return lastAction.action.output;
        }

        return null;
    }

    // ========== Execute Command ==========
    async function executeCommand(command) {
        if (!command.trim() || isProcessing) return;

        // Add user message
        addMessage(command, 'user');
        inputEl.value = '';

        // Check if agent is available
        if (!pageAgent) {
            pageAgent = await initPageAgent();
        }

        if (!pageAgent) {
            // Fallback to simple command parser
            if (executeFallbackCommand(command)) return;
            addErrorMessage(t('aiNotAvailable'));
            return;
        }

        // Check if execute method exists
        if (typeof pageAgent.execute !== 'function') {
            console.error('[AI Assistant] execute method not found, trying fallback');
            if (executeFallbackCommand(command)) return;
            addErrorMessage(t('aiApiError'));
            return;
        }

        isProcessing = true;
        setInputEnabled(false);
        setStatus(true, t('aiThinking'));

        // Listen to agent events for status updates
        const onActivity = (e) => {
            if (e.detail?.type === 'thinking') {
                setStatus(true, t('aiThinking'));
            } else if (e.detail?.type === 'executing') {
                setStatus(true, t('aiExecuting') + ' ' + (e.detail.tool || 'action'));
            }
        };
        const onStatusChange = () => {
            const status = pageAgent.status;
            if (status === 'running') {
                setStatus(true, t('aiRunning'));
            }
        };
        pageAgent.addEventListener('activity', onActivity);
        pageAgent.addEventListener('statuschange', onStatusChange);

        // Record history length before execution to isolate results
        const historyStartIndex = (pageAgent.history || []).length;

        try {
            await pageAgent.execute(command);

            // Get result only from new history entries (this execution)
            const extractedResult = extractAgentResult(historyStartIndex);
            if (extractedResult) {
                addMessage(extractedResult);
            } else {
                addMessage(t('aiTaskCompleted'));
            }
        } catch (err) {
            console.error('[AI Assistant] Execution error:', err);
            // Detect disposed agent and retry with fresh instance
            const errMsg = err.message || '';
            if (errMsg.includes('disposed') || errMsg.includes('disposed')) {
                console.warn('[AI Assistant] PageAgent was disposed, recreating...');
                pageAgent = null;
                addMessage(t('aiInitializing') || '重新初始化 AI 助手...');
                pageAgent = await initPageAgent();
                if (pageAgent) {
                    // Retry the command once
                    try {
                        const retryStartIndex = (pageAgent.history || []).length;
                        await pageAgent.execute(command);
                        const retryResult = extractAgentResult(retryStartIndex);
                        if (retryResult) {
                            addMessage(retryResult);
                        } else {
                            addMessage(t('aiTaskCompleted'));
                        }
                        return;
                    } catch (retryErr) {
                        console.error('[AI Assistant] Retry also failed:', retryErr);
                    }
                }
            }
            // Even on error, try to extract useful results from new history entries
            const partialResult = extractAgentResult(historyStartIndex);
            if (partialResult) {
                addMessage(partialResult);
                return;
            }
            // Try fallback for simple commands
            if (executeFallbackCommand(command)) return;
            if (errMsg.includes('413') || errMsg.includes('Payload Too Large')) {
                addErrorMessage(t('aiPayloadTooLarge'));
            } else {
                addErrorMessage(`Error: ${errMsg || t('aiExecFailed')}`);
            }
        } finally {
            // Guard removeEventListener in case agent was disposed
            try {
                if (pageAgent) {
                    pageAgent.removeEventListener('activity', onActivity);
                    pageAgent.removeEventListener('statuschange', onStatusChange);
                }
            } catch (e) {
                // Agent may be disposed, ignore
            }
            isProcessing = false;
            setInputEnabled(true);
            setStatus(false);
        }
    }

    // ========== Quick Actions (bypass LLM, direct local execution) ==========
    function executeQuickAction(action) {
        if (isProcessing) return;
        switch (action) {
            case 'run-ros-example':
                document.getElementById('load-ros-example')?.click();
                addMessage(t('aiRosLoaded'));
                // Auto-run test after a short delay
                setTimeout(() => {
                    document.getElementById('btn-run')?.click();
                    addMessage(t('aiTestStarted'));
                }, 800);
                break;
            case 'nav-tasks':
                document.querySelector('[data-page="tasks"]')?.click();
                addMessage(t('aiNavTasks'));
                break;
            case 'nav-projects':
                document.querySelector('[data-page="projects"]')?.click();
                addMessage(t('aiNavProjects'));
                break;
            case 'nav-playground':
                document.querySelector('[data-page="playground"]')?.click();
                addMessage(t('aiNavPlayground'));
                break;
            default:
                // Unknown quick action, try as normal command
                executeCommand(action);
        }
    }

    // ========== Fallback: Simple Command Parser ==========
    // When Page Agent is not available, use simple command matching
    function executeFallbackCommand(command) {
        const cmd = command.toLowerCase();

        // Navigation commands
        if (cmd.includes('task') || cmd.includes('任务')) {
            document.querySelector('[data-page="tasks"]')?.click();
            addMessage(t('aiNavTasks'));
            return true;
        }
        if (cmd.includes('project') || cmd.includes('项目')) {
            document.querySelector('[data-page="projects"]')?.click();
            addMessage(t('aiNavProjects'));
            return true;
        }
        if (cmd.includes('playground') || cmd.includes('运行')) {
            document.querySelector('[data-page="playground"]')?.click();
            addMessage(t('aiNavPlayground'));
            return true;
        }

        // Load examples
        if (cmd.includes('ros') && (cmd.includes('example') || cmd.includes('示例'))) {
            document.getElementById('load-ros-example')?.click();
            addMessage(t('aiRosLoaded'));
            return true;
        }
        if (cmd.includes('terraform') && (cmd.includes('example') || cmd.includes('示例'))) {
            document.getElementById('load-tf-example')?.click();
            addMessage(t('aiTfLoaded'));
            return true;
        }

        // Run test
        if (cmd.includes('run') && cmd.includes('test')) {
            document.getElementById('btn-run')?.click();
            addMessage(t('aiTestStarted'));
            return true;
        }

        return false;
    }

    // ========== Event Listeners ==========
    floatBtn?.addEventListener('click', () => togglePanel());
    closeBtn?.addEventListener('click', () => togglePanel(false));
    clearBtn?.addEventListener('click', clearMessages);

    sendBtn?.addEventListener('click', () => {
        const cmd = inputEl.value.trim();
        if (cmd) executeCommand(cmd);
    });

    inputEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const cmd = inputEl.value.trim();
            if (cmd) executeCommand(cmd);
        }
    });

    quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const cmd = btn.dataset.cmd;
            if (cmd) executeQuickAction(cmd);
        });
    });

    // Close panel on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panelVisible) {
            togglePanel(false);
        }
    });

    // Listen for language changes to update dynamic messages
    window.addEventListener('iact3-lang-change', () => {
        // Update the welcome message if it's the initial state
        const firstMsg = messagesEl.querySelector('.ai-message-assistant .ai-message-content');
        if (firstMsg && !isProcessing && messagesEl.children.length === 1) {
            firstMsg.textContent = t('aiWelcome');
        }
    });

    // ========== Global API for runtime LLM configuration ==========
    // Usage in browser console: setLLMKey('sk-xxx')
    window.setLLMKey = async function(apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            console.error('Usage: setLLMKey("sk-your-api-key")');
            return;
        }
        try {
            const resp = await fetch('/api/llm/config', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({apiKey: apiKey.trim()}),
            });
            const result = await resp.json();
            if (result.configured) {
                localStorage.setItem('iact3-llm-key', apiKey.trim());
                // Reset agent so next command uses proxy
                pageAgent = null;
                console.log('%c\u2705 LLM configured! Using qwen3.7-max via proxy. Next command will use it.', 'color: green; font-weight: bold');
                addMessage('LLM 已配置，下次对话将使用 qwen3.7-max。');
            } else {
                console.error('Failed to configure:', result);
            }
        } catch (e) {
            console.error('Failed to set LLM key:', e);
        }
    };
    
    // ========== iac-code Integration ==========
    // Check iac-code availability and generate templates via iac-code
    window.generateTemplate = async function(prompt, format = 'ros') {
        addMessage(`\u6b63\u5728\u4f7f\u7528 iac-code \u751f\u6210\u6a21\u677f...`, 'user');
        setStatus(true, t('aiThinking'));
        setInputEnabled(false);
        try {
            const resp = await fetch('/api/ai/generate-template', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({prompt, format}),
            });
            const result = await resp.json();
            if (result.template) {
                // Try to fill template into editor
                const editor = document.getElementById('template-editor');
                if (editor && editor.value !== undefined) {
                    editor.value = result.template;
                    editor.dispatchEvent(new Event('input'));
                    addMessage(`\u6a21\u677f\u5df2\u751f\u6210\u5e76\u586b\u5165\u7f16\u8f91\u5668\u3002\u8bf7\u70b9\u51fb "Auto Generate" \u751f\u6210\u53c2\u6570\uff0c\u7136\u540e "Run Test"\u3002`);
                } else {
                    addMessage(result.template.substring(0, 500) + (result.template.length > 500 ? '...' : ''));
                }
            } else if (result.error) {
                addErrorMessage(`iac-code: ${result.error}`);
                if (result.hint) {
                    addMessage(`\u63d0\u793a: ${result.hint}`);
                }
            }
        } catch (e) {
            addErrorMessage(`\u8c03\u7528\u5931\u8d25: ${e.message}`);
        } finally {
            setStatus(false);
            setInputEnabled(true);
        }
    };
    
    // ========== Init ==========
    console.log('[AI Assistant] iact3 AI Assistant loaded');
    console.log('[AI Assistant] Tip: Run setLLMKey("sk-xxx") in console to configure LLM without restarting server.');
    console.log('[AI Assistant] Tip: Run generateTemplate("create a VPC with ECS") to generate templates via iac-code.');
})();
