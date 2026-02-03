// RAGFlow Lore Injector - Index.js
// Aligned strictly with the st-extension-example pattern

import { 
    extension_settings, 
    getContext, 
    loadExtensionSettings
} from "../../../extensions.js";

import { 
    saveSettingsDebounced,
    eventSource,
    event_types
} from "../../../../script.js";

const extensionName = "ragflow-lore";

// 1. Default Settings
const defaultSettings = {
    enabled: true,
    baseUrl: 'https://rag.latour.live', // Updated to your working HTTPS URL
    apiKey: '',
    datasetId: '',
    similarityThreshold: 0.1, // Lowered default to 0.1 to match your curl success
    maxChunks: 3,
    useKg: false,
    keyword: false,
    rerankId: '', 
    injectPrefix: '\n\n<ragflow_context>\n[Relevant excerpts from the original novel for this scene:\n',
    injectSuffix: '\n]\n</ragflow_context>\n'
};

// Global State: We store the PROMISE, not just the string. 
// This allows us to "await" it in a later event, guaranteeing synchronization.
let loreFetchPromise = null;

// 2. Core Logic (RAGFlow Interaction)
async function fetchRagflowContext(query, overrides = {}) {
    const settings = extension_settings[extensionName];
    
    if (!settings.apiKey || !settings.datasetId) {
        console.warn('[RAGFlow] API Key or Dataset ID missing.');
        return null;
    }

    const cleanUrl = settings.baseUrl.replace(/\/$/, '');
    const url = `${cleanUrl}/api/v1/retrieval`;

    // --- SECURITY CHECK: Mixed Content ---
    const isPageSecure = window.location.protocol === 'https:';
    const isApiInsecure = cleanUrl.startsWith('http:');
    const isLocalhost = cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1');

    if (isPageSecure && isApiInsecure && !isLocalhost) {
        const errorMsg = "Mixed Content Error: Your browser blocked the request because SillyTavern is HTTPS but RAGFlow is HTTP.";
        console.error(`[RAGFlow] ${errorMsg}`);
        toastr.error("Browser Blocked Request. Access SillyTavern via HTTP or use your https://rag.latour.live URL.", "Security Error");
        return null;
    }
    
    // Determine effective settings
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

    console.log(`[RAGFlow DEBUG] Sending Query to ${url}: "${query}" (Threshold: ${threshold})`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`${response.status} ${response.statusText} - ${errText}`);
        }
        
        const data = await response.json();
        
        let chunks = [];
        let rawItems = [];

        if (data.code === 0 && data.data && Array.isArray(data.data.chunks)) {
             rawItems = data.data.chunks;
        } else if (data.data && Array.isArray(data.data.rows)) {
             rawItems = data.data.rows;
        }

        if (rawItems.length > 0) {
            console.log(`[RAGFlow DEBUG] Received ${rawItems.length} potential chunks.`);
            chunks = rawItems.map((item, index) => {
                const content = item.content_with_weight || item.content || item.text || "";
                const score = item.similarity || item.vector_similarity || item.score || 0;
                // Log score to help user debug thresholds
                console.log(`[RAGFlow DEBUG] Chunk #${index + 1} Score: ${score.toFixed(4)}`);
                return content;
            });
        } else {
            console.log(`[RAGFlow DEBUG] Query returned 0 chunks (Threshold was ${threshold}).`);
        }

        if (chunks.length === 0) return null;
        return chunks.join('\n...\n');

    } catch (error) {
        console.error('[RAGFlow DEBUG] Fetch Error:', error);
        toastr.error(`RAGFlow Error: ${error.message}`);
        return null;
    }
}

// 3. Settings Management
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const settings = extension_settings[extensionName];
    for (const key in defaultSettings) {
        if (!settings.hasOwnProperty(key)) {
            settings[key] = defaultSettings[key];
        }
    }
    
    // Update UI
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
                    <input type="text" class="text_pole" id="ragflow_baseUrl" placeholder="https://rag.yourdomain.com" />
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
                    <label>Rerank Model ID (Integer, Optional)</label>
                    <input type="number" class="text_pole" id="ragflow_rerankId" placeholder="e.g. 1" />
                </div>

                <div class="flex-container" style="margin-top:15px;">
                    <button id="ragflow_test_btn" class="menu_button">Test Connection</button>
                </div>

                <div class="flex-container">
                    <small><i>Check browser console (F12) for detailed logs.</i></small>
                </div>
            </div>
        </div>
    </div>
    `;

    $("#extensions_settings").append(settingsHtml);

    $("#ragflow_enabled").on("change", onSettingChange);
    $("#ragflow_baseUrl").on("input", onSettingChange);
    $("#ragflow_apiKey").on("input", onSettingChange);
    $("#ragflow_datasetId").on("input", onSettingChange);
    $("#ragflow_maxChunks").on("input", onSettingChange);
    $("#ragflow_similarity").on("input", onSettingChange);
    $("#ragflow_useKg").on("change", onSettingChange);
    $("#ragflow_keyword").on("change", onSettingChange);
    $("#ragflow_rerankId").on("input", onSettingChange);

    // TEST BUTTON
    $("#ragflow_test_btn").on("click", async function(e) {
        e.preventDefault();
        toastr.info("Sending test query...", "RAGFlow");
        // Force extremely low threshold for testing
        const result = await fetchRagflowContext("test connection check", { similarity_threshold: 0.01 });
        if (result) {
            toastr.success("Connection Successful!", "RAGFlow");
            alert("RAGFlow Response:\n----------------\n" + result);
        }
    });

    loadSettings();

    // EVENT 1: Input Handling (Start the Fetch)
    eventSource.on(event_types.chat_input_handling, (data) => {
        const settings = extension_settings[extensionName];
        if (!settings?.enabled) return;
        
        console.log('[RAGFlow DEBUG] Event: chat_input_handling fired.');

        const userQuery = data.text;
        if (!userQuery || userQuery.trim().length < 5) {
            console.log('[RAGFlow DEBUG] Query too short, clearing promise.');
            loreFetchPromise = null;
            return;
        }

        console.log('[RAGFlow DEBUG] User Input detected. Starting background fetch promise...');
        toastr.info("Searching RAGFlow...", "Lore Injector", { timeOut: 1500 });
        
        // CRITICAL: We save the PROMISE here, so we can await it later.
        loreFetchPromise = fetchRagflowContext(userQuery).then(res => {
            console.log(`[RAGFlow DEBUG] Promise Resolved. Result length: ${res ? res.length : 0}`);
            return res;
        }).catch(err => {
            console.error("[RAGFlow DEBUG] Promise Rejected:", err);
            return null;
        });
    });

    // EVENT 2: Prompt Ready (Wait for Data & Inject)
    eventSource.on(event_types.chat_completion_prompt_ready, async (data) => {
        console.log('[RAGFlow DEBUG] Event: chat_completion_prompt_ready fired.');
        
        // If no fetch is pending, do nothing
        if (!loreFetchPromise) {
            console.log('[RAGFlow DEBUG] No active RAGFlow promise found. Skipping injection.');
            return;
        }

        console.log('[RAGFlow DEBUG] Promise found. Awaiting RAG fetch to finish...');
        
        // CRITICAL: Force SillyTavern generation to PAUSE until RAGFlow replies
        const result = await loreFetchPromise;
        
        console.log('[RAGFlow DEBUG] Fetch complete. Result:', result ? 'Has Data' : 'Null');

        if (result) {
            const settings = extension_settings[extensionName];
            const injection = `${settings.injectPrefix}${result}${settings.injectSuffix}`;
            
            let injected = false;

            console.log('[RAGFlow DEBUG] Attempting injection. Available keys:', Object.keys(data));

            if (data.system_prompt !== undefined) {
                console.log(`[RAGFlow DEBUG] Injecting into system_prompt. Old length: ${data.system_prompt.length}`);
                data.system_prompt += injection;
                injected = true;
            } 
            else if (data.story_string !== undefined) {
                console.log(`[RAGFlow DEBUG] Injecting into story_string. Old length: ${data.story_string.length}`);
                data.story_string += injection;
                injected = true;
            } else {
                console.warn('[RAGFlow DEBUG] No suitable injection target (system_prompt or story_string) found!');
            }

            if (injected) {
                toastr.success("Context Injected!", "RAGFlow", { timeOut: 2000 });
                console.log('[RAGFlow DEBUG] Injection successful.');
            }
        } else {
            console.log('[RAGFlow DEBUG] Fetch finished but returned no valid context (or error occurred).');
        }
        
        // Cleanup
        loreFetchPromise = null;
    });

    console.log("[RAGFlow] Extension loaded.");
});