/**
 * Oil Record Book Tool - Offline Support Module
 * Handles network detection, request queuing, and automatic retry with exponential backoff
 */

const ORBOffline = (function() {
    // Configuration
    const CONFIG = {
        RETRY_DELAYS: [1000, 2000, 4000, 8000, 16000, 30000], // Exponential backoff (ms)
        MAX_RETRIES: 6,
        SYNC_INTERVAL: 30000, // Check queue every 30s when online
        PING_ENDPOINT: '/api/health', // Endpoint to check connectivity
        PING_TIMEOUT: 5000
    };

    // State
    let isOnline = navigator.onLine;
    let isSyncing = false;
    let syncTimer = null;
    let listeners = [];

    // ==========================================
    // Network Status Detection
    // ==========================================

    /**
     * Initialize network status monitoring
     */
    function init() {
        // Browser online/offline events
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Initial state
        isOnline = navigator.onLine;
        updateUI();

        // Start sync interval if online
        if (isOnline) {
            startSyncInterval();
        }

        console.log('ORBOffline initialized, online:', isOnline);
    }

    function handleOnline() {
        console.log('Network: online');
        isOnline = true;
        updateUI();
        notifyListeners('online');
        
        // Trigger sync when coming back online
        syncQueue();
        startSyncInterval();
    }

    function handleOffline() {
        console.log('Network: offline');
        isOnline = false;
        updateUI();
        notifyListeners('offline');
        stopSyncInterval();
    }

    /**
     * Verify connectivity with actual request (navigator.onLine can be unreliable)
     */
    async function verifyConnectivity() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.PING_TIMEOUT);
            
            const response = await fetch(CONFIG.PING_ENDPOINT, {
                method: 'HEAD',
                cache: 'no-store',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get current online status
     */
    function getStatus() {
        return {
            online: isOnline,
            syncing: isSyncing
        };
    }

    // ==========================================
    // UI Updates
    // ==========================================

    function updateUI() {
        const indicator = document.getElementById('offline-indicator');
        const badge = document.getElementById('queue-badge');
        
        if (indicator) {
            indicator.classList.toggle('online', isOnline);
            indicator.classList.toggle('offline', !isOnline);
            indicator.setAttribute('title', isOnline ? 'Connected' : 'Offline - changes will sync when online');
        }

        // Update queue badge
        updateQueueBadge();
    }

    async function updateQueueBadge() {
        const badge = document.getElementById('queue-badge');
        if (!badge) return;

        try {
            const count = await ORBStorage.queue.count();
            if (count > 0) {
                badge.textContent = count;
                badge.classList.add('visible');
            } else {
                badge.classList.remove('visible');
            }
        } catch (e) {
            console.error('Failed to update queue badge:', e);
        }
    }

    function setSyncing(syncing) {
        isSyncing = syncing;
        const indicator = document.getElementById('offline-indicator');
        if (indicator) {
            indicator.classList.toggle('syncing', syncing);
        }
    }

    // ==========================================
    // Toast Notifications
    // ==========================================

    function showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) {
            console.log(`[${type}] ${message}`);
            return;
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: '✓',
            error: '✗',
            warning: '⚠',
            info: 'ℹ',
            sync: '↻'
        };
        
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-message">${message}</span>
        `;

        container.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Remove after duration
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ==========================================
    // Request Queue & Sync
    // ==========================================

    /**
     * Queue a failed request for later retry
     */
    async function queueFailedRequest(endpoint, method, data, headers = {}) {
        const request = {
            endpoint,
            method,
            data,
            headers: { ...headers },
            timestamp: Date.now()
        };

        try {
            await ORBStorage.queue.add(request);
            updateQueueBadge();
            showToast('Saved offline - will sync when connected', 'warning');
            notifyListeners('queued', request);
        } catch (e) {
            console.error('Failed to queue request:', e);
            showToast('Failed to save offline', 'error');
        }
    }

    /**
     * Process the queue and retry failed requests
     */
    async function syncQueue() {
        if (isSyncing || !isOnline) {
            return;
        }

        const queue = await ORBStorage.queue.getAll();
        if (queue.length === 0) {
            return;
        }

        setSyncing(true);
        showToast(`Syncing ${queue.length} pending request(s)...`, 'sync');

        let successCount = 0;
        let failCount = 0;

        for (const item of queue) {
            try {
                const success = await retryRequest(item);
                if (success) {
                    await ORBStorage.queue.remove(item.id);
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (e) {
                console.error('Sync error for item:', item.id, e);
                failCount++;
            }
        }

        setSyncing(false);
        updateQueueBadge();

        if (successCount > 0) {
            showToast(`Synced ${successCount} request(s)`, 'success');
            notifyListeners('synced', { success: successCount, failed: failCount });
        }

        if (failCount > 0) {
            showToast(`${failCount} request(s) still pending`, 'warning');
        }
    }

    /**
     * Retry a single queued request with exponential backoff
     */
    async function retryRequest(item) {
        const delay = CONFIG.RETRY_DELAYS[Math.min(item.retryCount, CONFIG.RETRY_DELAYS.length - 1)];
        
        // If this isn't the first retry, wait before attempting
        if (item.retryCount > 0) {
            await sleep(delay);
        }

        try {
            const response = await fetch(`/api${item.endpoint}`, {
                method: item.method,
                headers: {
                    'Content-Type': 'application/json',
                    ...item.headers
                },
                body: item.data ? JSON.stringify(item.data) : undefined
            });

            if (response.ok) {
                return true;
            }

            // If server error (5xx), increment retry count
            if (response.status >= 500) {
                if (item.retryCount < CONFIG.MAX_RETRIES) {
                    await ORBStorage.queue.updateRetry(item.id, item.retryCount + 1);
                }
                return false;
            }

            // Client error (4xx) - don't retry, remove from queue
            console.warn('Request failed with client error, removing from queue:', response.status);
            return true; // Return true to remove from queue
            
        } catch (e) {
            // Network error - increment retry count
            if (item.retryCount < CONFIG.MAX_RETRIES) {
                await ORBStorage.queue.updateRetry(item.id, item.retryCount + 1);
            }
            return false;
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function startSyncInterval() {
        stopSyncInterval();
        syncTimer = setInterval(syncQueue, CONFIG.SYNC_INTERVAL);
    }

    function stopSyncInterval() {
        if (syncTimer) {
            clearInterval(syncTimer);
            syncTimer = null;
        }
    }

    // ==========================================
    // Offline-Aware API Wrapper
    // ==========================================

    /**
     * Make an API request with offline support
     * Falls back to queue if offline or request fails
     */
    async function request(endpoint, options = {}) {
        const {
            method = 'GET',
            data = null,
            headers = {},
            queueOnFail = true // Whether to queue POST/PUT/DELETE on failure
        } = options;

        // For GET requests, try to return cached data if offline
        if (method === 'GET' && !isOnline) {
            throw new Error('Offline - please try again when connected');
        }

        try {
            const fetchOptions = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                }
            };

            if (data && method !== 'GET') {
                fetchOptions.body = JSON.stringify(data);
            }

            const response = await fetch(`/api${endpoint}`, fetchOptions);
            const responseData = await response.json();

            return {
                ok: response.ok,
                status: response.status,
                data: responseData
            };

        } catch (error) {
            // Network error
            if (queueOnFail && method !== 'GET') {
                await queueFailedRequest(endpoint, method, data, headers);
                return {
                    ok: false,
                    status: 0,
                    data: null,
                    queued: true,
                    error: 'Request queued for later'
                };
            }
            
            throw error;
        }
    }

    /**
     * Convenience methods
     */
    const api = {
        async get(endpoint) {
            return request(endpoint, { method: 'GET', queueOnFail: false });
        },

        async post(endpoint, data) {
            return request(endpoint, { method: 'POST', data, queueOnFail: true });
        },

        async put(endpoint, data) {
            return request(endpoint, { method: 'PUT', data, queueOnFail: true });
        },

        async delete(endpoint) {
            return request(endpoint, { method: 'DELETE', queueOnFail: true });
        }
    };

    // ==========================================
    // Event Listeners
    // ==========================================

    function addListener(callback) {
        listeners.push(callback);
        return () => {
            listeners = listeners.filter(l => l !== callback);
        };
    }

    function notifyListeners(event, data = null) {
        listeners.forEach(callback => {
            try {
                callback(event, data);
            } catch (e) {
                console.error('Listener error:', e);
            }
        });
    }

    // ==========================================
    // Form Auto-Save
    // ==========================================

    /**
     * Setup auto-save for a form
     * @param {string} formId - Unique identifier for the form
     * @param {HTMLFormElement} form - The form element
     * @param {number} debounceMs - Debounce delay in milliseconds
     */
    function setupFormAutoSave(formId, form, debounceMs = 1000) {
        let debounceTimer = null;

        const saveForm = () => {
            const formData = new FormData(form);
            const data = {};
            formData.forEach((value, key) => {
                data[key] = value;
            });
            
            ORBStorage.form.save(formId, data);
        };

        // Debounced save on input
        form.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(saveForm, debounceMs);
        });

        // Immediate save on change (select, checkbox, etc.)
        form.addEventListener('change', saveForm);

        // Clear saved data on successful submit
        form.addEventListener('submit', () => {
            ORBStorage.form.clear(formId);
        });

        return {
            // Restore saved data
            async restore() {
                const data = await ORBStorage.form.get(formId);
                if (data) {
                    Object.keys(data).forEach(key => {
                        const input = form.elements[key];
                        if (input && input.type !== 'file') {
                            input.value = data[key];
                        }
                    });
                    showToast('Form restored from auto-save', 'info');
                    return true;
                }
                return false;
            },
            
            // Clear saved data
            clear() {
                ORBStorage.form.clear(formId);
            }
        };
    }

    // ==========================================
    // Public API
    // ==========================================

    return {
        init,
        getStatus,
        isOnline: () => isOnline,
        isSyncing: () => isSyncing,
        
        // API methods with offline support
        api,
        request,
        
        // Queue management
        syncQueue,
        getQueueCount: () => ORBStorage.queue.count(),
        clearQueue: () => ORBStorage.queue.clear(),
        
        // Form persistence
        setupFormAutoSave,
        
        // Notifications
        showToast,
        
        // Event handling
        onStatusChange: addListener,
        
        // Manual connectivity check
        verifyConnectivity
    };
})();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ORBOffline.init());
} else {
    ORBOffline.init();
}

// Export for module systems if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ORBOffline;
}
