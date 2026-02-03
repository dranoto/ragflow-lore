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
    injectSuffix: '\n]\n</ragflow_context>\n'
};

// Global State
let lastProcessedQuery = null;
let cachedContext = null;

// Helper: Timestamped Logger
function log(msg, ...args) {
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    console.log(`[RAGFlow ${time}] ${msg}`, ...args);
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
 * PROMPT INTERCEPTOR
 * Directly injects a system message into the chat array before generation.
 */
globalThis.ragflowLoreInterceptor = async function (chatHistory, contextSize, abort, type) {
    const settings = extension_settings[extensionName];
    
    // 1. Safety Checks
    if (!settings || !settings.enabled) return;

    // 2. Determine Query
    let userQuery = "";
    let insertIndex = chatHistory.length; // Default to end

    // Iterate backwards to find last user message to serve as query
    // And determine where to insert the context (right before it)
    for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (chatHistory[i].is_user) {
            userQuery = chatHistory[i].mes;
            insertIndex = i; // Insert BEFORE the user message
            break;
        }
    }

    if (!userQuery || userQuery.trim().length < 2) {
        log("No valid user query found in history. Skipping.");
        return;
    }

    // 3. Fetch or Cache
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

    // 4. Inject into Chat Array
    if (contextContent) {
        const fullText = `${settings.injectPrefix}${contextContent}${settings.injectSuffix}`;
        
        const systemNote = {
            is_user: false,
            is_system: true,
            name: "RAGFlow",
            send_date: Date.now(),
            mes: fullText,
            force_avatar: '',
            extra: { 
                type: 'ragflow_injection',
                created: Date.now()
            }
        };

        // Splice into the chat array
        // This modifies the array used for prompt building directly
        chatHistory.splice(insertIndex, 0, systemNote);
        log(`💉 Injected context at index ${insertIndex} (Length: ${fullText.length})`);
    }
};

// 3. Settings & UI Management
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const settings = extension_settings[extensionName];
    for (const key in defaultSettings) {
        if (!settings.hasOwnProperty(key)) {
            settings[key] = defaultSettings[key];
        }
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

                    <div class="flex-container" style="margin-top:15px;">
                        <button id="ragflow_test_btn" class="menu_button">Test Connection</button>
                    </div>
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

        // Load Settings
        loadSettings();

        // 5. Cleanup Logic: Remove injected RAG messages after generation
        // This keeps the chat history clean from massive context dumps
        const cleanupRagMessages = () => {
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

        console.log("[RAGFlow] 3. Lore Injector UI & Interceptor Loaded.");
    
    } catch (e) {
        console.error("[RAGFlow] ❌ CRITICAL INITIALIZATION ERROR:", e);
        toastr.error("RAGFlow Extension failed to load. Check console.", "Extension Error");
    }
});