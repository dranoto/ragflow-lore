// RAGFlow Lore Injector - Index.js
// Aligned strictly with the st-extension-example pattern

import { 
    extension_settings, 
    getContext, 
    loadExtensionSettings
} from "../../../extensions.js";

// NOTE: The example assumes 'scripts/extensions/third-party/extension-name' (Depth 4).
// If you are in 'scripts/extensions/ragflow-lore' (Depth 3), this import might need to be '../../script.js'.
// We will stick to the example's depth.
import { 
    saveSettingsDebounced,
    eventSource,
    event_types
} from "../../../../script.js";

const extensionName = "ragflow-lore";

// 1. Default Settings
const defaultSettings = {
    enabled: true,
    baseUrl: 'http://localhost:9380',
    apiKey: '',
    datasetId: '',
    similarityThreshold: 0.5,
    maxChunks: 3,
    useKg: false,      // Knowledge Graph
    keyword: false,    // Keyword Matching
    rerankId: '',      // Reranker Model ID
    injectPrefix: '\n\n<ragflow_context>\n[Relevant excerpts from the original novel for this scene:\n',
    injectSuffix: '\n]\n</ragflow_context>\n'
};

// Global state
let pendingLore = "";

// 2. Core Logic (RAGFlow Interaction)
async function fetchRagflowContext(query) {
    const settings = extension_settings[extensionName];
    
    if (!settings.apiKey || !settings.datasetId) {
        console.warn('[RAGFlow] API Key or Dataset ID missing.');
        return null;
    }

    const cleanUrl = settings.baseUrl.replace(/\/$/, '');
    const url = `${cleanUrl}/api/v1/retrieval`;
    
    console.log(`[RAGFlow] Querying: ${url}`);

    // Construct Payload
    // mapping maxChunks -> page_size ensures we strictly limit the output
    const payload = {
        question: query,
        dataset_ids: [settings.datasetId],
        similarity_threshold: parseFloat(settings.similarityThreshold),
        page_size: parseInt(settings.maxChunks),
        top_k: 1024, // Default high search depth for quality
        use_kg: settings.useKg,
        keyword: settings.keyword
    };

    // Only add rerank_id if user provided one
    if (settings.rerankId && settings.rerankId.trim() !== '') {
        payload.rerank_id = settings.rerankId.trim();
    }

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
        console.log('[RAGFlow] Raw Response:', data);
        
        let chunks = [];
        
        if (data.code === 0 && data.data && Array.isArray(data.data.chunks)) {
             chunks = data.data.chunks.map(c => c.content_with_weight || c.content);
        } 
        else if (data.data && Array.isArray(data.data.rows)) {
            chunks = data.data.rows.map(row => row.content_with_weight || row.content);
        } else if (Array.isArray(data.chunks)) {
            chunks = data.chunks.map(c => c.content_with_weight || c.content);
        } else if (Array.isArray(data.results)) {
            chunks = data.results.map(r => r.content || r.text);
        }

        if (chunks.length === 0) {
            console.log('[RAGFlow] No chunks returned.');
            return null;
        }
        
        return chunks.join('\n...\n');
    } catch (error) {
        console.error('[RAGFlow] Search failed:', error);
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
    
    // New Fields
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
        // New Fields
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
                    <input type="text" class="text_pole" id="ragflow_baseUrl" placeholder="http://localhost:9380" />
                </div>
                <div class="flex-container">
                    <label>API Key</label>
                    <input type="password" class="text_pole" id="ragflow_apiKey" />
                </div>
                <div class="flex-container">
                    <label>Dataset ID</label>
                    <input type="text" class="text_pole" id="ragflow_datasetId" />
                </div>
                <div class="flex-container">
                    <label>Max Chunks</label>
                    <input type="number" class="text_pole" id="ragflow_maxChunks" min="1" max="10" />
                </div>
                <div class="flex-container">
                    <label>Similarity</label>
                    <input type="number" class="text_pole" id="ragflow_similarity" step="0.1" />
                </div>

                <hr />
                
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
                    <input type="text" class="text_pole" id="ragflow_rerankId" placeholder="e.g. bge-reranker-v2-m3" />
                </div>

                <div class="flex-container">
                    <small><i>Check the browser console (F12) for detailed debug logs.</i></small>
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
    // New Bindings
    $("#ragflow_useKg").on("change", onSettingChange);
    $("#ragflow_keyword").on("change", onSettingChange);
    $("#ragflow_rerankId").on("input", onSettingChange);

    loadSettings();

    // -- DEBUG LOGGING --
    console.log('[RAGFlow] Event Types Available:', Object.keys(event_types));

    // EVENT 1: Input Handling (The Fetch)
    eventSource.on(event_types.chat_input_handling, async (data) => {
        const settings = extension_settings[extensionName];
        if (!settings?.enabled) return;
        
        pendingLore = ""; // Reset previous lore
        const userQuery = data.text;
        
        if (!userQuery || userQuery.trim().length < 5) {
            console.log('[RAGFlow] Query too short, skipping.');
            return;
        }

        console.log('[RAGFlow] 1. Input detected. Starting fetch for:', userQuery);
        const startTime = Date.now();
        
        const result = await fetchRagflowContext(userQuery);
        
        const duration = Date.now() - startTime;
        console.log(`[RAGFlow] 2. Fetch completed in ${duration}ms`);

        if (result) {
            pendingLore = `${settings.injectPrefix}${result}${settings.injectSuffix}`;
            console.log('[RAGFlow] Lore prepared. Length:', pendingLore.length);
        } else {
            console.log('[RAGFlow] No lore found.');
        }
    });

    // EVENT 2: Prompt Injection (The Action)
    eventSource.on(event_types.chat_completion_prompt_ready, (data) => {
        console.log('[RAGFlow] 3. Prompt Ready Event Triggered.');
        
        if (!pendingLore) {
            console.log('[RAGFlow] pendingLore is empty. Nothing to inject.');
            return;
        }

        // Try to find the best place to inject
        if (data.system_prompt !== undefined) {
            console.log('[RAGFlow] Injecting into data.system_prompt');
            data.system_prompt += pendingLore;
        } 
        else if (data.story_string !== undefined) {
            // Fallback for some backends
            console.log('[RAGFlow] system_prompt missing, injecting into story_string');
            data.story_string += pendingLore;
        }
        else {
            console.warn('[RAGFlow] Could not find a field to inject lore into! keys:', Object.keys(data));
        }

        console.log('[RAGFlow] Injection complete.');
    });

    console.log("[RAGFlow] Extension loaded successfully.");
});