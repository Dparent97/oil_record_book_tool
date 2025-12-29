/**
 * Oil Record Book Tool - Storage Module
 * Provides IndexedDB with localStorage fallback for offline data persistence
 */

const ORBStorage = (function() {
    const DB_NAME = 'orb_offline';
    const DB_VERSION = 1;
    const STORES = {
        QUEUE: 'request_queue',
        FORM_DATA: 'form_data',
        CACHE: 'api_cache'
    };
    
    let db = null;
    let useIndexedDB = true;

    /**
     * Initialize IndexedDB
     */
    async function initDB() {
        if (!window.indexedDB) {
            console.warn('IndexedDB not available, falling back to localStorage');
            useIndexedDB = false;
            return false;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.warn('IndexedDB open failed, falling back to localStorage');
                useIndexedDB = false;
                resolve(false);
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                console.log('IndexedDB initialized');
                resolve(true);
            };

            request.onupgradeneeded = (event) => {
                const database = event.target.result;

                // Request queue store
                if (!database.objectStoreNames.contains(STORES.QUEUE)) {
                    const queueStore = database.createObjectStore(STORES.QUEUE, { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    queueStore.createIndex('timestamp', 'timestamp', { unique: false });
                    queueStore.createIndex('endpoint', 'endpoint', { unique: false });
                }

                // Form data store for auto-save
                if (!database.objectStoreNames.contains(STORES.FORM_DATA)) {
                    const formStore = database.createObjectStore(STORES.FORM_DATA, { 
                        keyPath: 'formId' 
                    });
                    formStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // API response cache
                if (!database.objectStoreNames.contains(STORES.CACHE)) {
                    const cacheStore = database.createObjectStore(STORES.CACHE, { 
                        keyPath: 'key' 
                    });
                    cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    /**
     * Generic IndexedDB transaction wrapper
     */
    function dbTransaction(storeName, mode = 'readonly') {
        if (!db) {
            throw new Error('Database not initialized');
        }
        const transaction = db.transaction([storeName], mode);
        return transaction.objectStore(storeName);
    }

    // ==========================================
    // Request Queue Operations
    // ==========================================

    /**
     * Add a failed request to the queue
     */
    async function queueRequest(request) {
        const item = {
            ...request,
            timestamp: Date.now(),
            retryCount: 0
        };

        if (useIndexedDB && db) {
            return new Promise((resolve, reject) => {
                const store = dbTransaction(STORES.QUEUE, 'readwrite');
                const addRequest = store.add(item);
                addRequest.onsuccess = () => resolve(addRequest.result);
                addRequest.onerror = () => reject(addRequest.error);
            });
        } else {
            // localStorage fallback
            const queue = JSON.parse(localStorage.getItem('orb_queue') || '[]');
            item.id = Date.now() + Math.random();
            queue.push(item);
            localStorage.setItem('orb_queue', JSON.stringify(queue));
            return item.id;
        }
    }

    /**
     * Get all queued requests
     */
    async function getQueuedRequests() {
        if (useIndexedDB && db) {
            return new Promise((resolve, reject) => {
                const store = dbTransaction(STORES.QUEUE, 'readonly');
                const getAllRequest = store.getAll();
                getAllRequest.onsuccess = () => resolve(getAllRequest.result || []);
                getAllRequest.onerror = () => reject(getAllRequest.error);
            });
        } else {
            return JSON.parse(localStorage.getItem('orb_queue') || '[]');
        }
    }

    /**
     * Get queue count
     */
    async function getQueueCount() {
        if (useIndexedDB && db) {
            return new Promise((resolve, reject) => {
                const store = dbTransaction(STORES.QUEUE, 'readonly');
                const countRequest = store.count();
                countRequest.onsuccess = () => resolve(countRequest.result);
                countRequest.onerror = () => reject(countRequest.error);
            });
        } else {
            const queue = JSON.parse(localStorage.getItem('orb_queue') || '[]');
            return queue.length;
        }
    }

    /**
     * Remove a request from the queue
     */
    async function removeFromQueue(id) {
        if (useIndexedDB && db) {
            return new Promise((resolve, reject) => {
                const store = dbTransaction(STORES.QUEUE, 'readwrite');
                const deleteRequest = store.delete(id);
                deleteRequest.onsuccess = () => resolve(true);
                deleteRequest.onerror = () => reject(deleteRequest.error);
            });
        } else {
            const queue = JSON.parse(localStorage.getItem('orb_queue') || '[]');
            const filtered = queue.filter(item => item.id !== id);
            localStorage.setItem('orb_queue', JSON.stringify(filtered));
            return true;
        }
    }

    /**
     * Update retry count for a queued request
     */
    async function updateRetryCount(id, retryCount) {
        if (useIndexedDB && db) {
            return new Promise((resolve, reject) => {
                const store = dbTransaction(STORES.QUEUE, 'readwrite');
                const getRequest = store.get(id);
                getRequest.onsuccess = () => {
                    const item = getRequest.result;
                    if (item) {
                        item.retryCount = retryCount;
                        item.lastRetry = Date.now();
                        const putRequest = store.put(item);
                        putRequest.onsuccess = () => resolve(true);
                        putRequest.onerror = () => reject(putRequest.error);
                    } else {
                        resolve(false);
                    }
                };
                getRequest.onerror = () => reject(getRequest.error);
            });
        } else {
            const queue = JSON.parse(localStorage.getItem('orb_queue') || '[]');
            const item = queue.find(i => i.id === id);
            if (item) {
                item.retryCount = retryCount;
                item.lastRetry = Date.now();
                localStorage.setItem('orb_queue', JSON.stringify(queue));
            }
            return true;
        }
    }

    /**
     * Clear the entire queue
     */
    async function clearQueue() {
        if (useIndexedDB && db) {
            return new Promise((resolve, reject) => {
                const store = dbTransaction(STORES.QUEUE, 'readwrite');
                const clearRequest = store.clear();
                clearRequest.onsuccess = () => resolve(true);
                clearRequest.onerror = () => reject(clearRequest.error);
            });
        } else {
            localStorage.removeItem('orb_queue');
            return true;
        }
    }

    // ==========================================
    // Form Data Persistence
    // ==========================================

    /**
     * Auto-save form data
     */
    async function saveFormData(formId, data) {
        const item = {
            formId,
            data,
            timestamp: Date.now()
        };

        if (useIndexedDB && db) {
            return new Promise((resolve, reject) => {
                const store = dbTransaction(STORES.FORM_DATA, 'readwrite');
                const putRequest = store.put(item);
                putRequest.onsuccess = () => resolve(true);
                putRequest.onerror = () => reject(putRequest.error);
            });
        } else {
            localStorage.setItem(`orb_form_${formId}`, JSON.stringify(item));
            return true;
        }
    }

    /**
     * Get saved form data
     */
    async function getFormData(formId) {
        if (useIndexedDB && db) {
            return new Promise((resolve, reject) => {
                const store = dbTransaction(STORES.FORM_DATA, 'readonly');
                const getRequest = store.get(formId);
                getRequest.onsuccess = () => {
                    const result = getRequest.result;
                    resolve(result ? result.data : null);
                };
                getRequest.onerror = () => reject(getRequest.error);
            });
        } else {
            const item = localStorage.getItem(`orb_form_${formId}`);
            if (item) {
                const parsed = JSON.parse(item);
                return parsed.data;
            }
            return null;
        }
    }

    /**
     * Clear saved form data
     */
    async function clearFormData(formId) {
        if (useIndexedDB && db) {
            return new Promise((resolve, reject) => {
                const store = dbTransaction(STORES.FORM_DATA, 'readwrite');
                const deleteRequest = store.delete(formId);
                deleteRequest.onsuccess = () => resolve(true);
                deleteRequest.onerror = () => reject(deleteRequest.error);
            });
        } else {
            localStorage.removeItem(`orb_form_${formId}`);
            return true;
        }
    }

    // ==========================================
    // Simple Key-Value Storage (localStorage wrapper)
    // ==========================================

    function set(key, value) {
        try {
            localStorage.setItem(`orb_${key}`, JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn('localStorage set failed:', e);
            return false;
        }
    }

    function get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(`orb_${key}`);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            console.warn('localStorage get failed:', e);
            return defaultValue;
        }
    }

    function remove(key) {
        try {
            localStorage.removeItem(`orb_${key}`);
            return true;
        } catch (e) {
            console.warn('localStorage remove failed:', e);
            return false;
        }
    }

    // ==========================================
    // Public API
    // ==========================================

    return {
        init: initDB,
        
        // Request queue
        queue: {
            add: queueRequest,
            getAll: getQueuedRequests,
            count: getQueueCount,
            remove: removeFromQueue,
            updateRetry: updateRetryCount,
            clear: clearQueue
        },
        
        // Form data
        form: {
            save: saveFormData,
            get: getFormData,
            clear: clearFormData
        },
        
        // Simple key-value
        set,
        get,
        remove
    };
})();

// Initialize on load
ORBStorage.init().then(success => {
    console.log('ORBStorage initialized:', success ? 'IndexedDB' : 'localStorage fallback');
});

// Export for module systems if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ORBStorage;
}
