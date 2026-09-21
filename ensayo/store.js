// store.js — persistencia local: localStorage para datos chicos, IndexedDB para
// archivos (audio local, grabaciones). Expone window.Store.
(function () {
  'use strict';
  const KEY = 'ensayo.v1';
  const DB_NAME = 'ensayo-files';

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function defaultState() {
    return {
      version: 1,
      profile: { instrument: null, level: 'intermedio', name: '' },
      settings: { ytApiKey: '', fontSize: 100, showChords: true, showLyrics: true, autoScroll: true, countIn: true, theme: 'dark' },
      songs: [],
      setlists: [],
      currentSetlistId: null,
      takes: [], // metadatos de grabaciones; el blob va en IndexedDB
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return Object.assign(defaultState(), s, { profile: Object.assign(defaultState().profile, s.profile), settings: Object.assign(defaultState().settings, s.settings) });
    } catch (e) { console.warn('No se pudo leer el estado', e); return null; }
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { console.error('No se pudo guardar', e); return false; }
  }

  // ---------------- IndexedDB (blobs) ----------------
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('files'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function putFile(id, blob) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('files', 'readwrite');
      tx.objectStore('files').put(blob, id);
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function getFile(id) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction('files').objectStore('files').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function deleteFile(id) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('files', 'readwrite');
      tx.objectStore('files').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function clearFiles() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('files', 'readwrite');
      tx.objectStore('files').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  window.Store = { load, save, defaultState, uid, putFile, getFile, deleteFile, clearFiles };
})();
