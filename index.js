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
    baseUrl: 'http://localhost:9380',
    apiKey: '',
    datasetId: '',
    similarityThreshold: 0.2,
    maxChunks: 3,
    useKg: false,
    keyword: false,
    rerankId: '', // Default to empty (will be parsed to int if set)
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
    
    // Construct Payload
    const payload = {
        question: query,
        dataset_ids: [settings.datasetId],
        similarity_threshold: parseFloat(settings.similarityThreshold),
        page_size: parseInt(settings.maxChunks),
        top_k: 1024,
        use_kg: settings.useKg,
        keyword: settings.keyword
    };

    // Parse Rerank ID as Integer (Strict Requirement)
    if (settings.rerankId && settings.rerankId.toString().trim() !== '') {
        const rid = parseInt(settings.rerankId, 10);
        if (!isNaN(rid)) {
            payload.rerank_id = rid;
        } else {
            console.warn("[RAGFlow] Rerank ID provided is not a valid integer. Ignoring.");
        }
    }

    console.log(`[RAGFlow] POST ${url}`, payload);

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
            console.error('[RAGFlow] Server responded with error:', errText);
            throw new Error(`${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('[RAGFlow] Raw Response Data:', data);
        
        let chunks = [];
        let rawItems = [];

        // Parse: Handle generic vs chunk vs row formats
        if (data.code === 0 && data.data && Array.isArray(data.data.chunks)) {
             rawItems = data.data.chunks;
        } else if (data.data && Array.isArray(data.data.rows)) {
             rawItems = data.data.rows;
        }

        if (rawItems.length > 0) {
            console.log(`[RAGFlow] Found ${rawItems.length} items.`);
            chunks = rawItems.map((item, index) => {
                // Try to find the content field
                const content = item.content_with_weight || item.content || item.text || "";
                const score = item.similarity || item.vector_similarity || item.score || 0;
                console.log(`[RAGFlow] Chunk #${index + 1} (Score: ${score}):`, content.substring(0, 50) + "...");
                return content;
            });
        }

        if (chunks.length === 0) {
            console.warn('[RAGFlow] Request succeeded but returned 0 chunks. Check your Threshold setting vs the Score in logs.');
            return null;
        }
        
        return chunks.join('\n...\n');
    } catch (error) {
        console.error('[RAGFlow] Search failed completely:', error);
        
        // Specific CORS advice
        if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
            toastr.error("Network Error (CORS). Your browser blocked the request. Check console for details.", "RAGFlow");
        } else {
            toastr.error(`Error: ${error.message}`, "RAGFlow");
        }
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

    // TEST BUTTON LISTENER
    $("#ragflow_test_btn").on("click", async function(e) {
        e.preventDefault();
        toastr.info("Sending test query...", "RAGFlow");
        console.log("[RAGFlow] Test button clicked.");
        
        const result = await fetchRagflowContext("test connection check");
        
        if (result) {
            toastr.success("Connection Successful! Chunks found.", "RAGFlow");
            alert("RAGFlow Response:\n----------------\n" + result);
        } else {
            // Error is handled in fetchRagflowContext via toastr
            console.log("[RAGFlow] Test failed.");
        }
    });

    loadSettings();

    // EVENT 1: Input Handling
    eventSource.on(event_types.chat_input_handling, async (data) => {
        const settings = extension_settings[extensionName];
        if (!settings?.enabled) return;
        
        pendingLore = ""; 
        const userQuery = data.text;
        
        if (!userQuery || userQuery.trim().length < 5) return;

        // Visual feedback
        toastr.info("Searching RAGFlow...", "Lore Injector", { timeOut: 1500 });
        
        const result = await fetchRagflowContext(userQuery);

        if (result) {
            pendingLore = `${settings.injectPrefix}${result}${settings.injectSuffix}`;
            console.log('[RAGFlow] Lore ready to inject.');
        }
    });

    // EVENT 2: Prompt Injection
    eventSource.on(event_types.chat_completion_prompt_ready, (data) => {
        if (!pendingLore) return;

        let injected = false;

        if (data.system_prompt !== undefined) {
            data.system_prompt += pendingLore;
            injected = true;
        } 
        else if (data.story_string !== undefined) {
            data.story_string += pendingLore;
            injected = true;
        }
        else {
             console.warn('[RAGFlow] Could not find system_prompt or story_string.');
        }

        if (injected) {
            toastr.success("Context Injected!", "RAGFlow", { timeOut: 2000 });
            console.log('[RAGFlow] Injection successful.');
        }
    });

    console.log("[RAGFlow] Extension loaded.");
});