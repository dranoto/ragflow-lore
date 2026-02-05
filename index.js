// RAGFlow Lore Injector - Index.js
// Updated: Uses chat.splice for direct injection per Interceptor docs

console.log("[RAGFlow] 1. Module parsing started...");

import { 
    extension_settings, 
} from '/scripts/extensions.js';

import { 
    saveSettingsDebounced,
    eventSource,
    event_types,
    chat // Import chat for UI Test button access
} from '/script.js';

const extensionName = "ragflow-lore";

// 1. Default Settings
const defaultSettings = {
    enabled: true,
    baseUrl: 'https://rag.latour.live',
    apiKey: '',
    datasetId: '',
    similarityThreshold: 0.1,
    maxChunks: 3,
    useKg: false,
    keyword: false,
    rerankId: '',
    timeout: 15000,
    injectPrefix: '\n\n<ragflow_context>\n[Relevant excerpts from the original novel for this scene:\n',
    injectSuffix: '\n]\n</ragflow_context>\n',
    
    // NEW: Mode configuration
    mode: 'auto',  // 'auto', 'manual', or 'disabled'
    debugMode: false,
    showPreview: false,
    keepInHistory: false,
    
    // Per-chat settings
    perChatSettings: {}
};

// Global State
let lastProcessedQuery = null;
let cachedContext = null;
let currentChatMode = null;
let manualChunksPending = null;
let injectedMessageIds = new Set(); // Track injected messages for cleanup

// Helper: Timestamped Logger
function log(msg, ...args) {
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    console.log(`[RAGFlow ${time}] ${msg}`, ...args);
}

// Helper: Debug Logger
function debugLog(stage, data) {
    const settings = extension_settings[extensionName];
    if (settings && settings.debugMode) {
        log(`[DEBUG ${stage}]`, data);
    }
}

// Get current chat ID
function getCurrentChatId() {
    // Try multiple methods to get chat ID
    if (typeof this_chat_id !== 'undefined' && this_chat_id) {
        return this_chat_id;
    }
    if (typeof getChatId === 'function') {
        return getChatId();
    }
    if (chat && chat.length > 0) {
        // Try to get from metadata
        const lastMsg = chat[chat.length - 1];
        if (lastMsg && lastMsg.extra && lastMsg.extra.chat_id) {
            return lastMsg.extra.chat_id;
        }
    }
    return 'default';
}

// Get effective mode for current chat
function getEffectiveMode() {
    const settings = extension_settings[extensionName];
    if (!settings) return 'disabled';
    
    const chatId = getCurrentChatId();
    debugLog('GET_MODE', { chatId, perChatSettings: settings.perChatSettings });
    
    if (settings.perChatSettings && settings.perChatSettings[chatId]) {
        const mode = settings.perChatSettings[chatId];
        debugLog('MODE_RESULT', { source: 'per-chat', mode });
        return mode;
    }
    
    debugLog('MODE_RESULT', { source: 'global', mode: settings.mode || 'auto' });
    return settings.mode || 'auto';
}

// Set mode for current chat
function setChatMode(mode) {
    const settings = extension_settings[extensionName];
    const chatId = getCurrentChatId();
    
    if (!settings.perChatSettings) {
        settings.perChatSettings = {};
    }
    
    if (mode === 'global') {
        delete settings.perChatSettings[chatId];
        log(`🔄 Chat ${chatId}: Reset to global mode`);
    } else {
        settings.perChatSettings[chatId] = mode;
        log(`📝 Chat ${chatId}: Set to ${mode} mode`);
    }
    
    currentChatMode = getEffectiveMode();
    saveSettingsDebounced();
    updateModeIndicator();
    
    const modeText = mode === 'global' ? 'global setting' : mode;
    toastr.success(`RAGFlow mode: ${modeText}`, "Mode Updated");
}

// Update visual mode indicator
function updateModeIndicator() {
    const mode = getEffectiveMode();
    const indicator = $('#ragflow_mode_indicator');
    
    if (indicator.length === 0) return;
    
    indicator.removeClass('ragflow-mode-disabled ragflow-mode-auto ragflow-mode-manual');
    
    const modeConfig = {
        'disabled': { text: 'OFF', class: 'ragflow-mode-disabled', icon: '🔴' },
        'auto': { text: 'AUTO', class: 'ragflow-mode-auto', icon: '🟢' },
        'manual': { text: 'MANUAL', class: 'ragflow-mode-manual', icon: '🟡' }
    };
    
    const config = modeConfig[mode] || modeConfig['auto'];
    indicator.html(`${config.icon} ${config.text}`);
    indicator.addClass(config.class);
}

// 2. Core Logic (RAGFlow Interaction)
async function fetchRagflowContext(query, overrides = {}) {
    const settings = extension_settings[extensionName];
    
    // Validation
    if (!settings.apiKey || !settings.datasetId) {
        log("❌ Missing API Key or Dataset ID.");
        return null;
    }

    const cleanUrl = settings.baseUrl.replace(/\/$/, '');
    const url = `${cleanUrl}/api/v1/retrieval`;

    const threshold = overrides.similarity_threshold !== undefined 
        ? overrides.similarity_threshold 
        : parseFloat(settings.similarityThreshold);

    const payload = {
        question: query,
        dataset_ids: [settings.datasetId],
        similarity_threshold: threshold,
        page_size: parseInt(settings.maxChunks),
        top_k: 1024,
        use_kg: settings.useKg,
        keyword: settings.keyword
    };

    if (settings.rerankId && settings.rerankId.toString().trim() !== '') {
        const rid = parseInt(settings.rerankId, 10);
        if (!isNaN(rid)) payload.rerank_id = rid;
    }

    debugLog('FETCH_START', { url, payload });
    log(`🚀 Sending Fetch Request to ${url}`);
    
    const timeoutDuration = settings.timeout || 15000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

    try {
        const startTime = Date.now();
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;
        log(`📡 Response received in ${duration}ms. Status: ${response.status}`);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`${response.status} ${response.statusText} - ${errText}`);
        }
        
        const data = await response.json();
        debugLog('FETCH_RESPONSE', data);
        
        let chunks = [];
        let rawItems = [];

        // RAGFlow API structure compatibility check
        if (data.code === 0 && data.data && Array.isArray(data.data.chunks)) {
             rawItems = data.data.chunks;
        } else if (data.data && Array.isArray(data.data.rows)) {
             rawItems = data.data.rows;
        }

        if (rawItems.length > 0) {
            chunks = rawItems.map((item) => {
                return item.content_with_weight || item.content || item.text || "";
            });
            log(`✅ Processed ${chunks.length} valid chunks.`);
            debugLog('CHUNKS', chunks);
        } else {
            log(`⚠️ Query returned 0 chunks (Threshold: ${threshold}).`);
        }

        if (chunks.length === 0) return null;
        return chunks.join('\n...\n');

    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            log(`⛔ Fetch Timed Out after ${timeoutDuration}ms`);
            toastr.error(`RAGFlow Timeout (${timeoutDuration}ms). Server too slow?`, "Lore Injector");
        } else {
            log(`⛔ Fetch Error:`, error);
            toastr.error(`RAGFlow Error: ${error.message}`);
        }
        return null;
    }
}

/**
 * IMPROVED PROMPT INTERCEPTOR
 * Directly injects a system message into the chat array before generation.
 * Supports per-chat mode configuration (disabled/auto/manual).
 */
globalThis.ragflowLoreInterceptor = async function (chatHistory, contextSize, abort, type) {
    const settings = extension_settings[extensionName];
    
    debugLog('INTERCEPTOR_START', { chatHistoryLength: chatHistory.length, type });
    
    // 1. Safety Checks
    if (!settings || !settings.enabled) {
        debugLog('INTERCEPTOR_SKIP', 'Extension disabled');
        return;
    }
    
    // 2. Check effective mode for this chat
    const effectiveMode = getEffectiveMode();
    debugLog('INTERCEPTOR_MODE', effectiveMode);
    
    if (effectiveMode === 'disabled') {
        debugLog('INTERCEPTOR_SKIP', 'Mode is disabled for this chat');
        return;
    }
    
    if (effectiveMode === 'manual') {
        debugLog('INTERCEPTOR_SKIP', 'Mode is manual - waiting for manual trigger');
        // Check if there are pending manual chunks
        if (manualChunksPending) {
            log(`📥 Using manually triggered chunks`);
            injectContextIntoChat(chatHistory, manualChunksPending);
            manualChunksPending = null;
        }
        return;
    }

    // 3. Determine Query (Auto mode)
    let userQuery = "";
    let insertIndex = chatHistory.length;

    // Iterate backwards to find last user message
    for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (chatHistory[i].is_user) {
            userQuery = chatHistory[i].mes;
            insertIndex = i;
            break;
        }
    }

    if (!userQuery || userQuery.trim().length < 2) {
        log("No valid user query found in history. Skipping.");
        return;
    }

    // 4. Fetch or Cache
    let contextContent = null;
    
    if (userQuery === lastProcessedQuery && cachedContext !== null) {
        log(`♻️ Using cached context for query: "${userQuery.substring(0, 20)}..."`);
        contextContent = cachedContext;
    } else {
        log(`▶ Interceptor triggered. Fetching for: "${userQuery.substring(0, 30)}..."`);
        toastr.info("Fetching Lore...", "RAGFlow", { timeOut: 1000 });
        contextContent = await fetchRagflowContext(userQuery);
        
        // Update Cache
        lastProcessedQuery = userQuery;
        cachedContext = contextContent;
    }

    // 5. Inject into Chat Array
    if (contextContent) {
        injectContextIntoChat(chatHistory, contextContent, insertIndex);
    }
    
    debugLog('INTERCEPTOR_END', { injected: !!contextContent });
};

// Helper function to inject context
function injectContextIntoChat(chatHistory, contextContent, insertIndex = null) {
    const settings = extension_settings[extensionName];
    
    if (!insertIndex && insertIndex !== 0) {
        // Find insertion point
        insertIndex = chatHistory.length;
        for (let i = chatHistory.length - 1; i >= 0; i--) {
            if (chatHistory[i].is_user) {
                insertIndex = i;
                break;
            }
        }
    }
    
    const fullText = `${settings.injectPrefix}${contextContent}${settings.injectSuffix}`;
    
    // Generate unique ID for this injection
    const injectionId = Date.now() + Math.random().toString(36).substr(2, 9);
    
    const systemNote = {
        is_user: false,
        is_system: true,
        name: "RAGFlow",
        send_date: Date.now(),
        mes: fullText,
        force_avatar: '',
        extra: {
            type: 'ragflow_injection',
            created: Date.now(),
            can_edit: false,
            injection_id: injectionId
        }
    };

    // Splice into the chat array
    chatHistory.splice(insertIndex, 0, systemNote);
    injectedMessageIds.add(injectionId);
    
    log(`💉 Injected context at index ${insertIndex} (Length: ${fullText.length})`);
    debugLog('INJECT_COMPLETE', { insertIndex, textLength: fullText.length, injectionId });
    
    // Show success feedback
    if (settings.showPreview) {
        toastr.success(`Injected ${contextContent.length} chars of context`, "RAGFlow", { timeOut: 2000 });
    }
}

// Manual trigger function
async function manualRagTrigger() {
    const settings = extension_settings[extensionName];
    
    if (!settings || !settings.enabled) {
        toastr.error("RAGFlow extension is disabled", "Error");
        return;
    }
    
    if (!settings.apiKey || !settings.datasetId) {
        toastr.error("Please configure API Key and Dataset ID", "Error");
        return;
    }
    
    // Get query from last user message
    let query = "manual trigger";
    if (chat && chat.length > 0) {
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].is_user && !chat[i].is_system) {
                query = chat[i].mes;
                break;
            }
        }
    }
    
    log(`🎯 Manual trigger activated for: "${query.substring(0, 30)}..."`);
    toastr.info("Fetching RAG context...", "RAGFlow");
    
    const context = await fetchRagflowContext(query);
    
    if (context) {
        manualChunksPending = context;
        
        if (settings.showPreview) {
            // Show preview dialog
            showChunkPreview(context);
        } else {
            // Auto-inject
            manualChunksPending = null;
            // Inject directly into current chat
            if (chat && Array.isArray(chat)) {
                injectContextIntoChat(chat, context);
                toastr.success("Context injected! Send a message to use it.", "RAGFlow");
            }
        }
    } else {
        toastr.warning("No relevant context found", "RAGFlow");
    }
}

// Show chunk preview dialog
function showChunkPreview(context) {
    const settings = extension_settings[extensionName];
    
    // Create preview modal
    const modalHtml = `
        <div id="ragflow_preview_modal" class="ragflow-modal">
            <div class="ragflow-modal-content">
                <div class="ragflow-modal-header">
                    <h3>RAGFlow Context Preview</h3>
                    <button class="ragflow-close-btn">&times;</button>
                </div>
                <div class="ragflow-modal-body">
                    <p><strong>Found ${context.length} characters of relevant context:</strong></p>
                    <div class="ragflow-preview-text">${context.substring(0, 1000)}${context.length > 1000 ? '...' : ''}</div>
                </div>
                <div class="ragflow-modal-footer">
                    <button class="ragflow-btn ragflow-btn-cancel" id="ragflow_preview_cancel">Discard</button>
                    <button class="ragflow-btn ragflow-btn-confirm" id="ragflow_preview_confirm">Inject Context</button>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    $('#ragflow_preview_modal').remove();
    
    // Add modal to body
    $('body').append(modalHtml);
    
    // Handle close button
    $('#ragflow_preview_modal .ragflow-close-btn, #ragflow_preview_cancel').on('click', function() {
        $('#ragflow_preview_modal').remove();
        manualChunksPending = null;
        toastr.info("Context discarded", "RAGFlow");
    });
    
    // Handle confirm button
    $('#ragflow_preview_confirm').on('click', function() {
        $('#ragflow_preview_modal').remove();
        manualChunksPending = null;
        
        // Inject into chat
        if (chat && Array.isArray(chat)) {
            injectContextIntoChat(chat, context);
            toastr.success("Context injected! Send a message to use it.", "RAGFlow");
        }
    });
    
    // Close on background click
    $('#ragflow_preview_modal').on('click', function(e) {
        if (e.target.id === 'ragflow_preview_modal') {
            $(this).remove();
            manualChunksPending = null;
        }
    });
}

// 3. Settings & UI Management
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const settings = extension_settings[extensionName];
    for (const key in defaultSettings) {
        if (!settings.hasOwnProperty(key)) {
            settings[key] = defaultSettings[key];
        }
    }
    
    // Initialize perChatSettings if not exists
    if (!settings.perChatSettings) {
        settings.perChatSettings = {};
    }
    
    // Update UI Elements
    $("#ragflow_enabled").prop("checked", settings.enabled);
    $("#ragflow_baseUrl").val(settings.baseUrl);
    $("#ragflow_apiKey").val(settings.apiKey);
    $("#ragflow_datasetId").val(settings.datasetId);
    $("#ragflow_maxChunks").val(settings.maxChunks);
    $("#ragflow_similarity").val(settings.similarityThreshold);
    $("#ragflow_useKg").prop("checked", settings.useKg);
    $("#ragflow_keyword").prop("checked", settings.keyword);
    $("#ragflow_rerankId").val(settings.rerankId);
    $("#ragflow_timeout").val(settings.timeout);
    $("#ragflow_mode").val(settings.mode);
    $("#ragflow_debugMode").prop("checked", settings.debugMode);
    $("#ragflow_showPreview").prop("checked", settings.showPreview);
    $("#ragflow_keepInHistory").prop("checked", settings.keepInHistory);
    
    // Update current chat mode
    currentChatMode = getEffectiveMode();
    updateModeIndicator();
}

function onSettingChange(event) {
    const id = event.target.id;
    const settings = extension_settings[extensionName];
    
    cachedContext = null;
    lastProcessedQuery = null;
    
    switch (id) {
        case "ragflow_enabled": settings.enabled = !!$(event.target).prop("checked"); break;
        case "ragflow_baseUrl": settings.baseUrl = $(event.target).val(); break;
        case "ragflow_apiKey": settings.apiKey = $(event.target).val(); break;
        case "ragflow_datasetId": settings.datasetId = $(event.target).val(); break;
        case "ragflow_maxChunks": settings.maxChunks = parseInt($(event.target).val()); break;
        case "ragflow_similarity": settings.similarityThreshold = parseFloat($(event.target).val()); break;
        case "ragflow_useKg": settings.useKg = !!$(event.target).prop("checked"); break;
        case "ragflow_keyword": settings.keyword = !!$(event.target).prop("checked"); break;
        case "ragflow_rerankId": settings.rerankId = $(event.target).val(); break;
        case "ragflow_timeout": settings.timeout = parseInt($(event.target).val()) || 15000; break;
        case "ragflow_mode": settings.mode = $(event.target).val(); updateModeIndicator(); break;
        case "ragflow_debugMode": settings.debugMode = !!$(event.target).prop("checked"); break;
        case "ragflow_showPreview": settings.showPreview = !!$(event.target).prop("checked"); break;
        case "ragflow_keepInHistory": settings.keepInHistory = !!$(event.target).prop("checked"); break;
    }
    saveSettingsDebounced();
}

// 4. Initialization
jQuery(async () => {
    try {
        console.log("[RAGFlow] 2. jQuery Initialization started...");

        // Inject Settings UI
        const settingsHtml = `
        <div class="ragflow-extension-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>RAGFlow Lore Injector</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="flex-container">
                        <label class="checkbox_label">
                            <input type="checkbox" id="ragflow_enabled" />
                            Enable RAGFlow Lore
                        </label>
                    </div>
                    
                    <hr />
                    
                    <div class="flex-container">
                        <label>Global Mode</label>
                        <select id="ragflow_mode" class="text_pole">
                            <option value="auto">Auto (fetch on every message)</option>
                            <option value="manual">Manual (fetch only when triggered)</option>
                            <option value="disabled">Disabled (off by default)</option>
                        </select>
                        <small>Can be overridden per chat</small>
                    </div>
                    
                    <hr />
                    
                    <div class="flex-container">
                        <label>Base URL</label>
                        <input type="text" class="text_pole" id="ragflow_baseUrl" placeholder="https://rag.latour.live" />
                    </div>
                    <div class="flex-container">
                        <label>API Key</label>
                        <input type="password" class="text_pole" id="ragflow_apiKey" />
                    </div>
                    <div class="flex-container">
                        <label>Dataset ID</label>
                        <input type="text" class="text_pole" id="ragflow_datasetId" />
                    </div>
                    
                    <hr />
                    
                    <div class="flex-container">
                        <label>Max Chunks</label>
                        <input type="number" class="text_pole" id="ragflow_maxChunks" min="1" max="10" />
                    </div>
                    <div class="flex-container">
                        <label>Similarity (0.0 - 1.0)</label>
                        <input type="number" class="text_pole" id="ragflow_similarity" step="0.05" />
                    </div>
                    
                    <div class="flex-container">
                        <label class="checkbox_label">
                            <input type="checkbox" id="ragflow_useKg" />
                            Use Knowledge Graph
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label">
                            <input type="checkbox" id="ragflow_keyword" />
                            Keyword Matching
                        </label>
                    </div>
                    <div class="flex-container">
                        <label>Rerank Model ID (Optional)</label>
                        <input type="number" class="text_pole" id="ragflow_rerankId" placeholder="e.g. 1" />
                    </div>
                    <div class="flex-container">
                        <label>Timeout (ms)</label>
                        <input type="number" class="text_pole" id="ragflow_timeout" placeholder="15000" />
                    </div>
                    
                    <hr />
                    
                    <div class="flex-container">
                        <label class="checkbox_label">
                            <input type="checkbox" id="ragflow_debugMode" />
                            Debug Mode (verbose logging)
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label">
                            <input type="checkbox" id="ragflow_showPreview" />
                            Show Preview Before Inject (Manual Mode)
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label">
                            <input type="checkbox" id="ragflow_keepInHistory" />
                            Keep RAG Messages in Chat History
                        </label>
                    </div>

                    <div class="flex-container" style="margin-top:15px;">
                        <button id="ragflow_test_btn" class="menu_button">Test Connection</button>
                        <button id="ragflow_manual_btn" class="menu_button" style="margin-left: 10px;">Manual Trigger</button>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Chat Mode Indicator -->
        <div id="ragflow_chat_controls" style="display: none; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 5px; margin: 10px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>RAGFlow Mode:</strong>
                    <span id="ragflow_mode_indicator" style="margin-left: 10px; font-weight: bold;">🟢 AUTO</span>
                </div>
                <div>
                    <select id="ragflow_chat_mode_select" class="text_pole" style="width: auto;">
                        <option value="global">Use Global Setting</option>
                        <option value="disabled">Disabled</option>
                        <option value="auto">Auto</option>
                        <option value="manual">Manual</option>
                    </select>
                </div>
            </div>
        </div>
        `;

        if ($("#extensions_settings").length === 0) {
            console.error("[RAGFlow] #extensions_settings container not found!");
        } else {
            $("#extensions_settings").append(settingsHtml);
        }

        // Bind Event Listeners
        $("#ragflow_enabled").on("change", onSettingChange);
        $("#ragflow_baseUrl").on("input", onSettingChange);
        $("#ragflow_apiKey").on("input", onSettingChange);
        $("#ragflow_datasetId").on("input", onSettingChange);
        $("#ragflow_maxChunks").on("input", onSettingChange);
        $("#ragflow_similarity").on("input", onSettingChange);
        $("#ragflow_useKg").on("change", onSettingChange);
        $("#ragflow_keyword").on("change", onSettingChange);
        $("#ragflow_rerankId").on("input", onSettingChange);
        $("#ragflow_timeout").on("input", onSettingChange);
        $("#ragflow_mode").on("change", onSettingChange);
        $("#ragflow_debugMode").on("change", onSettingChange);
        $("#ragflow_showPreview").on("change", onSettingChange);
        $("#ragflow_keepInHistory").on("change", onSettingChange);

        // Test Button
        $("#ragflow_test_btn").on("click", async function(e) {
            e.preventDefault();
            const getLastUserMessage = () => {
                if (!chat || chat.length === 0) return "test connection check";
                for (let i = chat.length - 1; i >= 0; i--) {
                    if (!chat[i].is_system && chat[i].is_user) {
                        return chat[i].mes;
                    }
                }
                return "test connection check";
            };
            const query = getLastUserMessage();
            toastr.info(`Sending test query: "${query.substring(0, 20)}..."`, "RAGFlow");
            const result = await fetchRagflowContext(query, { similarity_threshold: 0.01 });
            if (result) {
                toastr.success("Connection Successful!", "RAGFlow");
                alert("RAGFlow Response:\n----------------\n" + result);
            } else {
                toastr.warning("Connection returned no results.", "RAGFlow");
            }
        });
        
        // Manual Trigger Button
        $("#ragflow_manual_btn").on("click", async function(e) {
            e.preventDefault();
            await manualRagTrigger();
        });
        
        // Chat Mode Selector
        $("#ragflow_chat_mode_select").on("change", function() {
            const mode = $(this).val();
            setChatMode(mode);
        });

        // Load Settings
        loadSettings();

        // 5. Cleanup Logic: Remove injected RAG messages after generation
        // This keeps the chat history clean from massive context dumps
        const cleanupRagMessages = () => {
            const settings = extension_settings[extensionName];
            
            // Skip cleanup if keepInHistory is enabled
            if (settings && settings.keepInHistory) {
                debugLog('CLEANUP_SKIP', 'keepInHistory is enabled');
                return;
            }
            
            if (!chat || !Array.isArray(chat)) return;
            let removedCount = 0;
            for (let i = chat.length - 1; i >= 0; i--) {
                if (chat[i].extra && chat[i].extra.type === 'ragflow_injection') {
                    chat.splice(i, 1);
                    removedCount++;
                }
            }
            if (removedCount > 0) {
                log(`🧹 Cleaned up ${removedCount} RAG injection message(s) from history.`);
                // Trigger a UI refresh if necessary (context update handles it usually, but just in case)
                if (eventSource) eventSource.emit(event_types.CHAT_CHANGED);
            }
        };

        // Listen for generation end to clean up
        eventSource.on(event_types.GENERATION_ENDED, cleanupRagMessages);
        eventSource.on(event_types.GENERATION_STOPPED, cleanupRagMessages);
        
        // 6. Initialize Chat Controls
        // Try to add chat controls to the chat interface
        const initChatControls = () => {
            // Try to find a suitable place to inject the chat controls
            const chatControlsTarget = $('#chat-controls').first();
            if (chatControlsTarget.length > 0) {
                $('#ragflow_chat_controls').insertAfter(chatControlsTarget).show();
                log("✅ Chat controls added to interface");
            } else {
                // Fallback: try other locations
                const alternateTarget = $('#form_shown').parent();
                if (alternateTarget.length > 0) {
                    $('#ragflow_chat_controls').insertBefore(alternateTarget).show();
                    log("✅ Chat controls added to alternate location");
                }
            }
            
            // Update mode indicator
            updateModeIndicator();
        };
        
        // Delay initialization to ensure UI is ready
        setTimeout(initChatControls, 1000);
        
        // Listen for chat changes to update mode indicator
        eventSource.on(event_types.CHAT_CHANGED, () => {
            currentChatMode = getEffectiveMode();
            updateModeIndicator();
        });

        console.log("[RAGFlow] 3. Lore Injector UI & Interceptor Loaded.");
    
    } catch (e) {
        console.error("[RAGFlow] ❌ CRITICAL INITIALIZATION ERROR:", e);
        toastr.error("RAGFlow Extension failed to load. Check console.", "Extension Error");
    }
});