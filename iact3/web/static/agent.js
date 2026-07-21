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
    const SYSTEM_PROMPT = `You are the AI assistant for iact3, an IaC (Infrastructure as Code) template testing tool for Alibaba Cloud ROS and Terraform.

Your capabilities:
1. Navigate between pages: Playground, Projects, Tasks
2. Load example templates (ROS or Terraform)
3. Edit template content in the code editor
4. Configure test parameters (region, parameters)
5. Run tests and view results
6. View task details, logs, and reports

Current page structure will be provided. Use element indices to interact.

Important notes:
- The template editor is a textarea with id "template-editor"
- The config editor is a textarea with id "config-editor"
- Region selector is a custom dropdown, click to open then select
- Use data-i18n attributes to identify buttons by function
- After running a test, navigate to Tasks page to see progress

Be helpful and concise. If a task requires multiple steps, execute them in sequence.`;

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

            if (llmConfig.configured) {
                // Use backend proxy with real LLM
                agentOptions = {
                    model: 'qwen3.5-plus',
                    baseURL: window.location.origin + '/api/llm/proxy',
                    apiKey: 'proxy-managed',
                    language: 'en-US',
                };
                console.log('[AI Assistant] Using backend LLM proxy');
            } else {
                // Use Page Agent's free demo LLM endpoint
                agentOptions = {
                    model: 'qwen3.5-plus',
                    baseURL: 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run',
                    apiKey: 'NA',
                    language: 'en-US',
                };
                console.log('[AI Assistant] Using demo LLM endpoint');
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

        try {
            await pageAgent.execute(command);

            // Get result from agent
            const lastResult = pageAgent.lastResult;
            if (lastResult && lastResult.success === false) {
                addErrorMessage(lastResult.message || t('aiTaskFailed'));
            } else {
                // Extract the last 'done' message from history
                const history = pageAgent.history || [];
                const lastDone = [...history].reverse().find(h =>
                    h.type === 'step' && h.action && h.action.name === 'done'
                );
                if (lastDone && lastDone.action.input && lastDone.action.input.text) {
                    addMessage(lastDone.action.input.text);
                } else {
                    addMessage(t('aiTaskCompleted'));
                }
            }
        } catch (err) {
            console.error('[AI Assistant] Execution error:', err);
            // Try fallback for simple commands
            if (executeFallbackCommand(command)) return;
            addErrorMessage(`Error: ${err.message || t('aiExecFailed')}`);
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

    // ========== Init ==========
    console.log('[AI Assistant] iact3 AI Assistant loaded');
})();
