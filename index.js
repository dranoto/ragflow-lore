// RAGFlow Lore Injector - Index.js
// Aligned with StoryMode & SillyTavern Best Practices

import { 
    extension_settings, 
} from '/scripts/extensions.js';

import { 
    saveSettingsDebounced,
    eventSource,
    event_types,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    chat // Import chat directly to access history if needed
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
    injectPrefix: '\n\n<ragflow_context>\n[Relevant excerpts from the original novel for this scene:\n',
    injectSuffix: '\n]\n</ragflow_context>\n'
};

// Global State
// We track the promise primarily for debugging, but we act on resolution immediately.
let loreFetchPromise = null;

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
    log(`   Query: "${query.substring(0, 50)}..."`);
    log(`   Payload:`, payload);

    try {
        const startTime = Date.now();
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const duration = Date.now() - startTime;
        log(`📡 Response received in ${duration}ms. Status: ${response.status}`);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`${response.status} ${response.statusText} - ${errText}`);
        }
        
        const data = await response.json();
        log(`📦 Raw JSON Response:`, data);
        
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
        log(`⛔ Fetch Error:`, error);
        toastr.error(`RAGFlow Error: ${error.message}`);
        return null;
    }
}

/**
 * Updates the SillyTavern extension prompt slot.
 * This updates the global state so it's ready whenever ST generates a prompt.
 */
function updateInjectedPrompt(content = '') {
    const settings = extension_settings[extensionName];
    
    // If disabled or empty content, clear the prompt slot
    if (!settings.enabled) {
        log("Extension disabled. Clearing prompt slot.");
        setExtensionPrompt(extensionName, extension_prompt_types.IN_CHAT, '', extension_prompt_roles.SYSTEM);
        return;
    }
    
    if (!content) {
        log("No content to inject. Clearing prompt slot.");
        setExtensionPrompt(extensionName, extension_prompt_types.IN_CHAT, '', extension_prompt_roles.SYSTEM);
        return;
    }

    log(`💉 Injecting content (${content.length} chars) into prompt slot.`);
    const fullInjection = `${settings.injectPrefix}${content}${settings.injectSuffix}`;
    
    // Inject into the IN_CHAT depth (standard depth for context injection)
    // extension_prompt_roles.SYSTEM ensures it is treated as a system instruction
    setExtensionPrompt(
        extensionName, 
        extension_prompt_types.IN_CHAT, 
        fullInjection, 
        extension_prompt_roles.SYSTEM
    );
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
}

function onSettingChange(event) {
    const id = event.target.id;
    const settings = extension_settings[extensionName];
    
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
    }
    saveSettingsDebounced();
}

// 4. Initialization
jQuery(async () => {
    // Inject Settings UI into the Extensions Panel
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

                <div class="flex-container" style="margin-top:15px;">
                    <button id="ragflow_test_btn" class="menu_button">Test Connection</button>
                </div>
            </div>
        </div>
    </div>
    `;

    $("#extensions_settings").append(settingsHtml);

    // Bind Event Listeners for Settings
    $("#ragflow_enabled").on("change", onSettingChange);
    $("#ragflow_baseUrl").on("input", onSettingChange);
    $("#ragflow_apiKey").on("input", onSettingChange);
    $("#ragflow_datasetId").on("input", onSettingChange);
    $("#ragflow_maxChunks").on("input", onSettingChange);
    $("#ragflow_similarity").on("input", onSettingChange);
    $("#ragflow_useKg").on("change", onSettingChange);
    $("#ragflow_keyword").on("change", onSettingChange);
    $("#ragflow_rerankId").on("input", onSettingChange);

    // Test Button Logic
    $("#ragflow_test_btn").on("click", async function(e) {
        e.preventDefault();
        toastr.info("Sending test query...", "RAGFlow");
        log("Testing connection with manual query...");
        const result = await fetchRagflowContext("test connection check", { similarity_threshold: 0.01 });
        if (result) {
            toastr.success("Connection Successful!", "RAGFlow");
            alert("RAGFlow Response:\n----------------\n" + result);
        } else {
            toastr.warning("Connection technically worked but returned no results (or check console for errors).", "RAGFlow");
        }
    });

    // Load initial settings
    loadSettings();

    // --- MAIN EVENT LOOP ---

    /**
     * TRIGGER 1: chat_input_handling
     * Fired when user presses Enter/Send. This is the earliest possible hook.
     * We start the fetch here to race against the prompt generation.
     */
    eventSource.on(event_types.chat_input_handling, async (data) => {
        log(`🔔 Event: chat_input_handling triggered.`);
        const settings = extension_settings[extensionName];
        if (!settings?.enabled) {
            log("Extension disabled. Skipping.");
            return;
        }

        const userQuery = data.text;
        
        // Basic filter for empty or very short queries
        if (!userQuery || userQuery.trim().length < 2) {
            log("Query too short. Clearing previous injection.");
            updateInjectedPrompt(''); 
            loreFetchPromise = null;
            return;
        }

        log(`▶ Starting background fetch for: "${userQuery}"`);
        toastr.info("Fetching Lore...", "RAGFlow", { timeOut: 1500 });
        
        // Start the fetch and immediately attach the handler to update the prompt when done.
        // We do NOT await here, or we would block the UI.
        loreFetchPromise = fetchRagflowContext(userQuery).then(result => {
            log(`🏁 Fetch complete in background.`);
            updateInjectedPrompt(result);
            return result;
        });
    });

    /**
     * TRIGGER 2: MESSAGE_SWIPED / MESSAGE_REGENERATED
     * If the user swipes, the previous 'input' event won't fire. 
     * We need to fetch based on the LAST message in chat.
     */
    const onRegenerate = async () => {
        log(`🔔 Event: Regenerate/Swipe triggered.`);
        const settings = extension_settings[extensionName];
        if (!settings?.enabled) return;

        // Get the last user message from chat history
        if (!chat || chat.length === 0) {
            log("Chat history empty. Skipping.");
            return;
        }
        
        // Find last user message
        let lastUserMes = null;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_system && chat[i].is_user) {
                lastUserMes = chat[i].mes;
                break;
            }
        }

        if (lastUserMes) {
            log(`▶ Refetching context for last user message: "${lastUserMes}"`);
            toastr.info("Refetching Lore...", "RAGFlow", { timeOut: 1500 });
            loreFetchPromise = fetchRagflowContext(lastUserMes).then(result => {
                log(`🏁 Fetch complete (regen).`);
                updateInjectedPrompt(result);
                return result;
            });
        }
    };

    eventSource.on(event_types.MESSAGE_SWIPED, onRegenerate);
    // event_types.MESSAGE_REGENERATED might not exist in all ST versions, usually handled by SWIPED or internal logic
    if (event_types.MESSAGE_REGENERATED) {
        eventSource.on(event_types.MESSAGE_REGENERATED, onRegenerate);
    }

    // Reset prompt on chat change to prevent context bleeding
    eventSource.on(event_types.CHAT_CHANGED, () => {
        log(`🔔 Chat changed. Clearing context.`);
        updateInjectedPrompt('');
        loreFetchPromise = null;
    });

    console.log("[RAGFlow] Lore Injector Aligned & Loaded.");
});