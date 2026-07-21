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
    const SYSTEM_PROMPT = `你是 iact3 的 AI 助手。iact3 是阿里云 ROS/Terraform 模板测试工具。

## 高效执行原则
- 每步只做一件事，不要犹豫
- 如果任务已完成或无法继续，立即调用 done
- 优先使用页面上可见的按钮和控件

## 常见工作流

### 配置并运行测试
1. 如在 Playground 页面，点击 "ROS Example" 或 "Terraform Example" 加载模板
2. 点击地域选择器（Region 下拉框），选择目标地域
3. 点击 "Auto Generate" 按钮自动生成参数
4. 点击 "Run Test" 按钮运行测试
5. 调用 done 告知用户测试已启动

### 查看任务结果
1. 点击侧边栏 "Tasks" 导航到任务列表
2. 点击目标任务行查看详情
3. 调用 done 汇报结果

### 删除任务
1. 勾选目标任务复选框
2. 点击 "Batch Delete" 按钮
3. 在确认弹窗中点击 "确认" 按钮
4. 调用 done

## 页面元素说明
- 侧边栏导航: [data-page="playground"], [data-page="tasks"], [data-page="projects"]
- 地域选择器: 点击 #pg-region-trigger 打开下拉，然后点击选项
- 运行按钮: #btn-run
- 自动生成参数: #btn-generate-params
- 确认弹窗按钮: #confirm-modal-ok (确认), #confirm-modal-cancel (取消)

Be concise. Act fast. Call done when finished.`;

    // ========== Initialize Page Agent ==========
    async function initPageAgent() {
        if (typeof window.PageAgent === 'undefined') {
            console.warn('[AI Assistant] Page Agent not loaded');
            return null;
        }

        try {
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
                    // Exclude large/complex areas from DOM dehydration
                    document.getElementById('template-editor'),
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
            // Even on error, try to extract useful results from new history entries
            const partialResult = extractAgentResult(historyStartIndex);
            if (partialResult) {
                addMessage(partialResult);
                return;
            }
            // Try fallback for simple commands
            if (executeFallbackCommand(command)) return;
            const errMsg = err.message || '';
            if (errMsg.includes('413') || errMsg.includes('Payload Too Large')) {
                addErrorMessage(t('aiPayloadTooLarge'));
            } else {
                addErrorMessage(`Error: ${errMsg || t('aiExecFailed')}`);
            }
        } finally {
            pageAgent.removeEventListener('activity', onActivity);
            pageAgent.removeEventListener('statuschange', onStatusChange);
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
                console.log('%c✅ LLM configured! Using qwen3.7-max via proxy. Next command will use it.', 'color: green; font-weight: bold');
                addMessage('LLM 已配置，下次对话将使用 qwen3.7-max。');
            } else {
                console.error('Failed to configure:', result);
            }
        } catch (e) {
            console.error('Failed to set LLM key:', e);
        }
    };

    // ========== Init ==========
    console.log('[AI Assistant] iact3 AI Assistant loaded');
    console.log('[AI Assistant] Tip: Run setLLMKey("sk-xxx") in console to configure LLM without restarting server.');
})();
