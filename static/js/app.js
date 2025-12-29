/**
 * Oil Record Book Tool - Core JavaScript
 * Handles common functionality across pages with offline-first support
 */

// API helper with offline support
// Uses ORBOffline when available, falls back to direct fetch
const api = {
    async get(endpoint) {
        // Use offline-aware API if available
        if (typeof ORBOffline !== 'undefined') {
            const result = await ORBOffline.api.get(endpoint);
            if (!result.ok && !result.queued) {
                throw new Error(`API error: ${result.status}`);
            }
            return result.data;
        }
        
        // Fallback to direct fetch
        const response = await fetch(`/api${endpoint}`);
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        return response.json();
    },

    async post(endpoint, data) {
        // Use offline-aware API if available
        if (typeof ORBOffline !== 'undefined') {
            return ORBOffline.api.post(endpoint, data);
        }
        
        // Fallback to direct fetch
        const response = await fetch(`/api${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return {
            ok: response.ok,
            status: response.status,
            data: await response.json()
        };
    },

    async put(endpoint, data) {
        // Use offline-aware API if available
        if (typeof ORBOffline !== 'undefined') {
            return ORBOffline.api.put(endpoint, data);
        }
        
        // Fallback to direct fetch
        const response = await fetch(`/api${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return {
            ok: response.ok,
            status: response.status,
            data: await response.json()
        };
    },

    async delete(endpoint) {
        // Use offline-aware API if available
        if (typeof ORBOffline !== 'undefined') {
            return ORBOffline.api.delete(endpoint);
        }
        
        // Fallback to direct fetch
        const response = await fetch(`/api${endpoint}`, {
            method: 'DELETE'
        });
        return {
            ok: response.ok,
            status: response.status,
            data: response.status !== 204 ? await response.json() : null
        };
    }
};

// Format helpers
const format = {
    date(isoString) {
        const date = new Date(isoString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric'
        });
    },

    dateShort(isoString) {
        const date = new Date(isoString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric'
        });
    },

    sounding(feet, inches) {
        return `${feet}' ${inches}"`;
    },

    volume(gallons, m3) {
        return {
            gallons: `${gallons} gal`,
            m3: `${m3.toFixed(2)} m³`
        };
    },

    delta(value, unit = '') {
        const prefix = value >= 0 ? '+' : '';
        return `${prefix}${value}${unit}`;
    }
};

// Storage helpers - delegate to ORBStorage if available
const storage = {
    set(key, value) {
        if (typeof ORBStorage !== 'undefined') {
            return ORBStorage.set(key, value);
        }
        try {
            localStorage.setItem(`orb_${key}`, JSON.stringify(value));
        } catch (e) {
            console.warn('localStorage not available:', e);
        }
    },

    get(key, defaultValue = null) {
        if (typeof ORBStorage !== 'undefined') {
            return ORBStorage.get(key, defaultValue);
        }
        try {
            const item = localStorage.getItem(`orb_${key}`);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.warn('localStorage not available:', e);
            return defaultValue;
        }
    },

    remove(key) {
        if (typeof ORBStorage !== 'undefined') {
            return ORBStorage.remove(key);
        }
        try {
            localStorage.removeItem(`orb_${key}`);
        } catch (e) {
            console.warn('localStorage not available:', e);
        }
    }
};

// Toast notifications - delegate to ORBOffline if available
const toast = {
    show(message, type = 'info', duration = 3000) {
        if (typeof ORBOffline !== 'undefined') {
            ORBOffline.showToast(message, type, duration);
        } else {
            console.log(`[${type}] ${message}`);
        }
    },
    
    success(message) {
        this.show(message, 'success');
    },
    
    error(message) {
        this.show(message, 'error');
    },
    
    warning(message) {
        this.show(message, 'warning');
    },
    
    info(message) {
        this.show(message, 'info');
    }
};

// Offline status helpers
const offline = {
    isOnline() {
        if (typeof ORBOffline !== 'undefined') {
            return ORBOffline.isOnline();
        }
        return navigator.onLine;
    },
    
    isSyncing() {
        if (typeof ORBOffline !== 'undefined') {
            return ORBOffline.isSyncing();
        }
        return false;
    },
    
    async getQueueCount() {
        if (typeof ORBOffline !== 'undefined') {
            return ORBOffline.getQueueCount();
        }
        return 0;
    },
    
    syncNow() {
        if (typeof ORBOffline !== 'undefined') {
            return ORBOffline.syncQueue();
        }
    },
    
    setupFormAutoSave(formId, form, debounceMs = 1000) {
        if (typeof ORBOffline !== 'undefined') {
            return ORBOffline.setupFormAutoSave(formId, form, debounceMs);
        }
        return { restore: () => false, clear: () => {} };
    },
    
    onStatusChange(callback) {
        if (typeof ORBOffline !== 'undefined') {
            return ORBOffline.onStatusChange(callback);
        }
        return () => {};
    }
};

// Export for use in templates
window.ORB = { api, format, storage, toast, offline };
