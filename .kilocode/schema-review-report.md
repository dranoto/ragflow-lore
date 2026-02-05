# SillyTavern Extension Schema Compliance Review
## RAGFlow Lore Injector Extension

**Review Date:** 2025-02-05  
**Extension Version:** 1.0.2  
**Schema Version:** Based on SillyTavern Extension Documentation

---

## Executive Summary

The RAGFlow Lore Injector extension has **multiple critical issues** that violate the SillyTavern extension schema and best practices. The most severe issues are:

1. **Security Violation**: Storing API keys in `extensionSettings` (plaintext, accessible to all extensions)
2. **Incorrect Import Pattern**: Using direct imports from `/script.js` instead of `SillyTavern.getContext()`
3. **Missing Manifest Fields**: Lacks `homePage` and other recommended fields
4. **Non-standard Settings Pattern**: Not using the documented `extensionSettings` pattern correctly

---

## 1. Manifest.json Issues

### 1.1 Missing Required Field: `homePage`

**Current State:**
```json
{
    "name": "RAGFlow Lore Injector",
    "display_name": "RAGFlow Lore Injector",
    "loading_order": 9,
    "version": "1.0.2",
    "author": "angusthefuzz",
    "description": "...",
    "js": "index.js",
    "css": "style.css",
    "generate_interceptor": "ragflowLoreInterceptor"
}
```

**Issue:** The `homePage` field is missing. According to the schema documentation, this is a recommended field for extension submissions.

**Fix Required:**
```json
{
    "homePage": "https://github.com/angusthefuzz/ragflow-lore",
    ...
}
```

### 1.2 Non-standard Field: `name`

**Issue:** The manifest includes a `name` field which is not part of the official SillyTavern schema. Only `display_name` is required.

**Fix Required:** Remove the `name` field or keep it as additional metadata (it won't cause errors but is non-standard).

### 1.3 Missing Optional but Recommended Fields

| Field | Status | Recommendation |
|-------|--------|----------------|
| `auto_update` | Missing | Add: `true` or `false` |
| `minimum_client_version` | Missing | Add: `"1.0.0"` or similar |
| `dependencies` | Missing | Add if this extension depends on others |
| `i18n` | Missing | Add if translations are planned |

---

## 2. Index.js Issues

### 2.1 CRITICAL: Incorrect Import Pattern

**Current Code (Lines 6-15):**
```javascript
import { 
    extension_settings, 
} from '/scripts/extensions.js';

import { 
    saveSettingsDebounced,
    eventSource,
    event_types,
    chat
} from '/script.js';
```

**Issue:** Direct imports from `/script.js` and `/scripts/extensions.js` are **unreliable and can break** when SillyTavern's internal structure changes.

**Schema Documentation States:**
> "Using imports from SillyTavern code is unreliable and can break at any time if the internal structure of ST's modules changes. getContext provides a more stable API."

**Fix Required:**
```javascript
// Get context from SillyTavern global object
const { 
    extensionSettings,      // Note: different naming convention
    saveSettingsDebounced,
    eventSource,
    event_types,
    chat
} = SillyTavern.getContext();
```

### 2.2 CRITICAL: Security Violation - API Key Storage

**Current Code (Lines 20-42):**
```javascript
const defaultSettings = {
    enabled: true,
    baseUrl: 'https://rag.latour.live',
    apiKey: '',  // ⚠️ SECURITY ISSUE
    datasetId: '',
    // ...
};
```

**Schema Documentation States:**
> "Never store API keys or secrets in extensionSettings. Extension settings are accessible to all other extensions and are stored in plain text."

**Issue:** The extension stores the RAGFlow API key in `extensionSettings`, which:
- Is accessible to all other extensions
- Is stored in plain text on the server
- Violates security best practices

**Recommended Solutions:**
1. **Best**: Use a server plugin to handle API calls (requires backend component)
2. **Alternative**: Document clearly that the API key is stored insecurely and warn users
3. **Workaround**: Use environment variables or a separate secure storage mechanism

### 2.3 Incorrect Settings Access Pattern

**Current Code (Lines 59, 86, 104, etc.):**
```javascript
const settings = extension_settings[extensionName];
```

**Issue:** The code uses `extension_settings` (snake_case) but the schema uses `extensionSettings` (camelCase) from `getContext()`.

**Fix Required:**
```javascript
const { extensionSettings } = SillyTavern.getContext();
const settings = extensionSettings[extensionName];
```

### 2.4 Missing Settings Initialization Pattern

**Current Code (Lines 482-494):**
```javascript
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const settings = extension_settings[extensionName];
    for (const key in defaultSettings) {
        if (!settings.hasOwnProperty(key)) {
            settings[key] = defaultSettings[key];
        }
    }
    // ...
}
```

**Schema Documentation Recommends:**
```javascript
function loadSettings() {
    // Merge with defaults to handle new keys after updates
    extensionSettings[MODULE_NAME] = SillyTavern.libs.lodash.merge(
        structuredClone(defaultSettings),
        extensionSettings[MODULE_NAME]
    );
}
```

**Issue:** The current implementation doesn't use the recommended lodash merge pattern for handling settings updates.

### 2.5 Missing TypeScript Definitions

**Schema Documentation States:**
> "If you want access to autocomplete for all methods in the SillyTavern global object, you should add a TypeScript .d.ts module declaration."

**Issue:** No `global.d.ts` file exists for TypeScript autocomplete support.

**Fix Required:** Create `global.d.ts`:
```typescript
export {};

// Import for user-scoped extensions
import '../../../../public/global';
// Import for server-scoped extensions  
import '../../../../global';

declare global {
    // Add extension-specific types if needed
}
```

### 2.6 Inconsistent Module Naming

**Current Code (Line 17):**
```javascript
const extensionName = "ragflow-lore";
```

**Schema Documentation Recommends:**
```javascript
const MODULE_NAME = 'my_extension_name';
```

**Issue:** Inconsistent naming convention. The schema recommends `MODULE_NAME` (uppercase snake_case).

### 2.7 Missing Shared Library Usage

**Current Code:** The extension doesn't leverage SillyTavern's shared libraries.

**Available Libraries Not Used:**
- `lodash` - Could be used for settings merging
- `DOMPurify` - Should be used to sanitize any user inputs
- `localforage` - Could be used for large data storage instead of settings

**Example from Schema:**
```javascript
const { lodash, DOMPurify, localforage } = SillyTavern.libs;

// Use lodash for deep merging
extensionSettings[MODULE_NAME] = lodash.merge(
    structuredClone(defaultSettings),
    extensionSettings[MODULE_NAME]
);

// Sanitize user inputs
const cleanInput = DOMPurify.sanitize(userInput);
```

### 2.8 Console Logging Pattern

**Current Code (Lines 52-55):**
```javascript
function log(msg, ...args) {
    const time = new Date().toISOString().split('T')[1].slice(0, -1);
    console.log(`[RAGFlow ${time}] ${msg}`, ...args);
}
```

**Schema Documentation Recommends:**
```javascript
const MODULE_NAME = 'MyExtension';
console.log(`[${MODULE_NAME}] Extension loaded`);
```

**Issue:** The logging pattern is acceptable but could be simplified to match the recommended pattern.

---

## 3. Best Practices Violations

### 3.1 No Input Sanitization

**Current Code:** User inputs (baseUrl, apiKey, datasetId) are not sanitized before use.

**Schema Documentation States:**
> "Always validate and sanitize data from user inputs before using it in commands, API calls, or DOM manipulation."

**Fix Required:**
```javascript
const { DOMPurify } = SillyTavern.libs;

// Sanitize URL input
const cleanUrl = DOMPurify.sanitize(settings.baseUrl).replace(/\/$/, '');
```

### 3.2 Large Data in Settings

**Current Code:** The `perChatSettings` object could grow large with many chats.

**Schema Documentation States:**
> "Don't store large data in extensionSettings... Use localforage (abstraction over IndexedDB/localStorage)"

**Fix Required:**
```javascript
const { localforage } = SillyTavern.libs;

// Store per-chat settings in localforage
await localforage.setItem(`${MODULE_NAME}_perChatSettings`, perChatSettings);
```

### 3.3 Missing Event Listener Cleanup

**Current Code:** Event listeners are registered but there's no cleanup function.

**Schema Documentation States:**
> "Remove event listeners when they're no longer needed to prevent memory leaks."

**Fix Required:** Add a cleanup function:
```javascript
function cleanup() {
    eventSource.removeListener(event_types.MESSAGE_RECEIVED, handleMessage);
    // Remove other listeners
}
```

---

## 4. Positive Aspects

The extension does follow several best practices correctly:

✅ **Proper Interceptor Registration**: Uses `globalThis.ragflowLoreInterceptor` correctly  
✅ **Manifest Structure**: Has required fields (display_name, js, author, version)  
✅ **CSS Isolation**: Uses prefixed class names (`.ragflow-*`)  
✅ **Toast Notifications**: Uses toastr for user feedback  
✅ **Error Handling**: Has try-catch blocks for API calls  
✅ **Timeout Protection**: Implements AbortController for fetch timeouts  

---

## 5. Recommended Fixes Priority

### Priority 1 (Critical - Must Fix)

1. **Replace direct imports with `SillyTavern.getContext()`**
   - Change all imports from `/script.js` and `/scripts/extensions.js`
   - Use context API for all SillyTavern interactions

2. **Add security warning about API key storage**
   - Document clearly that API keys are stored in plain text
   - Consider implementing a server plugin alternative

3. **Fix settings access pattern**
   - Use `extensionSettings` from context, not `extension_settings`
   - Implement proper lodash merge for defaults

### Priority 2 (Important - Should Fix)

4. **Add missing manifest fields**
   - Add `homePage` URL
   - Add `auto_update` setting
   - Add `minimum_client_version`

5. **Add input sanitization**
   - Use DOMPurify for all user inputs
   - Validate API keys and IDs

6. **Create TypeScript definitions**
   - Add `global.d.ts` for autocomplete support

### Priority 3 (Nice to Have)

7. **Use shared libraries**
   - Use lodash for settings merging
   - Use localforage for large data storage

8. **Add event listener cleanup**
   - Implement cleanup function for proper memory management

9. **Standardize naming conventions**
   - Use `MODULE_NAME` constant
   - Follow schema naming patterns

---

## 6. Code Examples for Fixes

### Fix 1: Replace Imports with Context API

**Before:**
```javascript
import { 
    extension_settings, 
} from '/scripts/extensions.js';

import { 
    saveSettingsDebounced,
    eventSource,
    event_types,
    chat
} from '/script.js';
```

**After:**
```javascript
// Get SillyTavern context
const { 
    extensionSettings,
    saveSettingsDebounced,
    eventSource,
    event_types,
    chat
} = SillyTavern.getContext();
```

### Fix 2: Proper Settings Initialization

**Before:**
```javascript
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const settings = extension_settings[extensionName];
    for (const key in defaultSettings) {
        if (!settings.hasOwnProperty(key)) {
            settings[key] = defaultSettings[key];
        }
    }
}
```

**After:**
```javascript
const { lodash } = SillyTavern.libs;
const MODULE_NAME = 'ragflow-lore';

function loadSettings() {
    // Initialize settings if they don't exist
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    
    // Merge with defaults to handle new keys after updates
    extensionSettings[MODULE_NAME] = lodash.merge(
        structuredClone(defaultSettings),
        extensionSettings[MODULE_NAME]
    );
}
```

### Fix 3: Input Sanitization

**Before:**
```javascript
const cleanUrl = settings.baseUrl.replace(/\/$/, '');
```

**After:**
```javascript
const { DOMPurify } = SillyTavern.libs;
const cleanUrl = DOMPurify.sanitize(settings.baseUrl).replace(/\/$/, '');
```

---

## 7. Updated Manifest.json Template

```json
{
    "display_name": "RAGFlow Lore Injector",
    "loading_order": 9,
    "requires": [],
    "optional": [],
    "dependencies": [],
    "js": "index.js",
    "css": "style.css",
    "author": "angusthefuzz",
    "version": "1.0.2",
    "homePage": "https://github.com/angusthefuzz/ragflow-lore",
    "auto_update": true,
    "minimum_client_version": "1.0.0",
    "generate_interceptor": "ragflowLoreInterceptor",
    "i18n": {}
}
```

---

## 8. Conclusion

The RAGFlow Lore Injector extension is **functional but not fully compliant** with the SillyTavern extension schema. The most critical issues are:

1. **Security**: API keys stored in plaintext settings
2. **Stability**: Direct imports that may break with updates
3. **Completeness**: Missing recommended manifest fields

**Recommendation**: Implement Priority 1 fixes before submitting to the official repository. The extension will work as-is but may break with SillyTavern updates and poses security risks for users' API keys.

---

**Review Completed By:** Kilo Code Debug Mode  
**Schema Reference:** https://docs.sillytavern.app/for-contributors/ui-extensions/
