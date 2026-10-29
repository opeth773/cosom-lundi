/* Android-only adapter. The PWA does not load or depend on this file. */
(() => {
  'use strict';
  if (!window.CosomNative?.postMessage) return;
  let nextId = 0;
  const pending = new Map();
  const speech = new Map();
  const send = message => window.CosomNative.postMessage(JSON.stringify(message));
  function request(action, data = {}) {
    const id = String(++nextId);
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject});
      send({action, id, ...data});
    });
  }

  class AndroidSpeechRecognition {
    constructor() {
      this.lang = 'fr-CA';
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 3;
      this._id = null;
      this._results = [];
    }
    start() {
      if (this._id !== null) throw new DOMException('Déjà en écoute.', 'InvalidStateError');
      this._id = String(++nextId);
      this._results = [];
      speech.set(this._id, this);
      send({action: 'speechStart', id: this._id, lang: this.lang,
        continuous: this.continuous, interimResults: this.interimResults,
        maxAlternatives: this.maxAlternatives});
    }
    stop() {
      if (this._id !== null) send({action: 'speechStop', id: this._id});
    }
    abort() {
      if (this._id === null) return;
      const id = this._id;
      send({action: 'speechAbort', id});
      // Close synchronously so a late native result cannot submit a goal.
      this._end();
    }
    _emit(type, detail = {}) {
      this['on' + type]?.({type, target: this, ...detail});
    }
    _end() {
      if (this._id === null) return;
      speech.delete(this._id);
      this._id = null;
      this._emit('end');
    }
    _native(event) {
      if (event.type === 'end') return this._end();
      if (event.type !== 'result') return this._emit(event.type, event);
      if (!event.final && !this.interimResults) return;
      const result = event.alternatives.map((transcript, index) => ({
        transcript, confidence: event.confidences?.[index] ?? 0
      }));
      if (!result.length) return;
      result.isFinal = Boolean(event.final);
      const resultIndex = this._results.length;
      const results = [...this._results, result];
      if (result.isFinal) this._results.push(result);
      this._emit('result', {resultIndex, results});
    }
  }

  window.CosomAndroid = {
    signInGoogle: () => request('googleSignIn'),
    copyText: text => request('copyText', {text}),
    saveFile: (name, text, type) => request('saveFile', {name, text, type}),
    _event(event) {
      if (event.channel === 'speech') {
        speech.get(event.id)?._native(event);
      } else if (event.channel === 'lifecycle') {
        window.dispatchEvent(new Event('cosom:native-pause'));
      } else {
        const operation = pending.get(event.id);
        if (!operation) return;
        pending.delete(event.id);
        if (event.error) operation.reject(new Error(event.error));
        else operation.resolve(event.value);
      }
    }
  };
  window.SpeechRecognition = AndroidSpeechRecognition;
  window.webkitSpeechRecognition = AndroidSpeechRecognition;
  // A WebView may omit Wake Lock entirely. Native handling is foreground-only.
  if (!('wakeLock' in navigator)) {
    Object.defineProperty(navigator, 'wakeLock', {value: {
      async request() {
        send({action: 'keepScreenOn', enabled: true});
        const lock = new EventTarget();
        lock.released = false;
        lock.release = async () => {
          if (lock.released) return;
          lock.released = true;
          send({action: 'keepScreenOn', enabled: false});
          lock.dispatchEvent(new Event('release'));
        };
        window.addEventListener('cosom:native-pause', () => lock.release(), {once:true});
        return lock;
      }
    }});
  }
})();
