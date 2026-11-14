/* ProgInOne sandbox PoC harness. Runs inside the js-console Worker or the nested DOM document.
   It is injected as a single line: no line comments, explicit semicolons only.
   Observation model: collects observations, never knows expected values. */
(function () {
  'use strict';
  var G = globalThis;
  var CFG = G.__PG_CFG || {};
  try { delete G.__PG_CFG; } catch (e) { G.__PG_CFG = undefined; }
  var isWorker = typeof window === 'undefined';
  var O = Object;
  var defineProperty = O.defineProperty;
  var freeze = O.freeze;
  var keys = O.keys;
  var getOwnPropertyNames = O.getOwnPropertyNames;
  var getOPD = O.getOwnPropertyDescriptor;
  var getProto = O.getPrototypeOf;
  var isArray = Array.isArray;
  var apply = Reflect.apply;
  var perfNow = performance.now;
  var now = function () { return apply(perfNow, performance, []); };
  var pmPort = MessagePort.prototype.postMessage;
  var arrPush = Array.prototype.push;
  var arrSlice = Array.prototype.slice;
  var push = function (a, v) { apply(arrPush, a, [v]); };
  var strSlice = String.prototype.slice;
  var fnToString = Function.prototype.toString;
  var reExec = RegExp.prototype.exec;
  var MapCtor = Map;
  var SetCtor = Set;
  var mapForEach = Map.prototype.forEach;
  var setForEach = Set.prototype.forEach;
  var DateCtor = Date;
  var dateGetTime = Date.prototype.getTime;
  var dateToISO = Date.prototype.toISOString;
  var ErrorCtor = Error;
  var PromiseCtor = Promise;
  var nSetTimeout = G.setTimeout;
  var nClearTimeout = G.clearTimeout;
  var nSetInterval = G.setInterval;
  var nClearInterval = G.clearInterval;
  var nConsole = G.console;
  var nConsoleLog = nConsole && nConsole.log;
  var setTimeoutRaw = function (f, ms) { return apply(nSetTimeout, G, [f, ms]); };
  var NodeCtor = isWorker ? null : G.Node;

  var limits = CFG.limits || {};
  var LOOP_BUDGET = limits.loopBudgetMs || 1000;
  var MAX_ENTRIES = limits.maxConsoleEntries || 1000;
  var MAX_ENTRY_BYTES = limits.maxEntryBytes || 10000;
  var MAX_OBS_BYTES = limits.maxObservationBytes || 64000;
  var MAX_DURATION = limits.maxDurationMs || 3000;
  var QUIET_MS = limits.quietMs == null ? 50 : limits.quietMs;
  var MAX_STR = Math.min(8000, MAX_ENTRY_BYTES - 1024);
  var MAX_ITEMS = 100;
  var MAX_DEPTH = 6;
  var t0 = now();

  var port = null;
  var outbox = [];
  var send = function (msg) {
    if (port) { apply(pmPort, port, [msg]); } else { push(outbox, msg); }
  };

  var errors = [];
  var csp = [];
  var caps = { env: isWorker ? 'worker' : 'dom' };
  var consoleCount = 0;
  var dropped = 0;
  var batch = [];
  var flushScheduled = false;
  var loopLimitHit = false;

  function LoopLimit(info) { this.name = 'LoopLimitError'; this.message = 'loop budget exceeded'; this.info = info; }
  LoopLimit.prototype = O.create(ErrorCtor.prototype);
  var isLoopLimit = function (e) { return e instanceof LoopLimit || (e && e.name === 'LoopLimitError'); };

  var estimate = function (v, depth) {
    if (depth > 12) { return 8; }
    if (v === null || typeof v !== 'object') { return typeof v === 'string' ? v.length + 2 : 8; }
    var n = 2;
    var ks = keys(v);
    for (var i = 0; i < ks.length; i++) { n += ks[i].length + 3 + estimate(v[ks[i]], depth + 1); }
    return n;
  };

  var fnKind = function (f) {
    var src = '';
    try { src = apply(fnToString, f, []); } catch (e) { return 'native'; }
    if (apply(reExec, /\[native code\]/, [src])) { return 'native'; }
    if (apply(reExec, /^class[\s{]/, [src])) { return 'class'; }
    if (apply(reExec, /^async\s/, [src])) { return 'async'; }
    if (apply(reExec, /^function\s*\*/, [src])) { return 'generator'; }
    if (apply(reExec, /^(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, [src])) { return 'arrow'; }
    return 'function';
  };

  var serialize = function (v, depth, seen) {
    try {
      var t = typeof v;
      if (v === undefined) { return { t: 'undefined' }; }
      if (v === null) { return { t: 'null' }; }
      if (t === 'boolean') { return { t: 'boolean', v: v }; }
      if (t === 'number') {
        if (v !== v) { return { t: 'number', v: 'NaN' }; }
        if (v === Infinity) { return { t: 'number', v: 'Infinity' }; }
        if (v === -Infinity) { return { t: 'number', v: '-Infinity' }; }
        if (v === 0 && 1 / v < 0) { return { t: 'number', v: '-0' }; }
        return { t: 'number', v: v };
      }
      if (t === 'bigint') { return { t: 'bigint', v: '' + v }; }
      if (t === 'string') {
        if (v.length > MAX_STR) { return { t: 'string', v: apply(strSlice, v, [0, MAX_STR]), truncated: true, length: v.length }; }
        return { t: 'string', v: v };
      }
      if (t === 'symbol') { return { t: 'symbol', description: v.description }; }
      if (t === 'function') {
        var prev = '';
        try { prev = apply(strSlice, apply(fnToString, v, []), [0, 80]); } catch (e) { prev = ''; }
        return { t: 'function', name: v.name, kind: fnKind(v), preview: prev };
      }
      if (seen.has(v)) { return { t: 'circular', refId: seen.get(v) }; }
      var refId = seen.size + 1;
      seen.set(v, refId);
      if (depth >= MAX_DEPTH) { return { t: 'object', className: ctorName(v), collapsed: true }; }
      if (v instanceof ErrorCtor) { return { t: 'error', name: v.name, message: '' + v.message }; }
      if (v instanceof DateCtor) {
        var tm = apply(dateGetTime, v, []);
        return { t: 'date', iso: tm !== tm ? 'Invalid Date' : apply(dateToISO, v, []) };
      }
      if (v instanceof RegExp) { return { t: 'regexp', source: v.source, flags: v.flags }; }
      if (v instanceof PromiseCtor) { return { t: 'promise' }; }
      if (NodeCtor && v instanceof NodeCtor) {
        var oh = '';
        try { oh = apply(strSlice, v.outerHTML || v.textContent || '', [0, 200]); } catch (e) { oh = ''; }
        return { t: 'dom', nodeName: v.nodeName, id: v.id || undefined, preview: oh };
      }
      if (v instanceof MapCtor) {
        var me = [];
        apply(mapForEach, v, [function (val, k) { if (me.length < MAX_ITEMS) { push(me, [serialize(k, depth + 1, seen), serialize(val, depth + 1, seen)]); } }]);
        return { t: 'map', entries: me, size: v.size, truncated: v.size > MAX_ITEMS || undefined };
      }
      if (v instanceof SetCtor) {
        var si = [];
        apply(setForEach, v, [function (val) { if (si.length < MAX_ITEMS) { push(si, serialize(val, depth + 1, seen)); } }]);
        return { t: 'set', items: si, size: v.size, truncated: v.size > MAX_ITEMS || undefined };
      }
      if (isArray(v)) {
        var items = [];
        var len = v.length;
        var holes = 0;
        for (var i = 0; i < len && i < MAX_ITEMS; i++) {
          if (!(i in v)) { holes++; push(items, { t: 'hole' }); continue; }
          var d = getOPD(v, '' + i);
          if (d && d.get) { push(items, { t: 'getter' }); } else { push(items, serialize(v[i], depth + 1, seen)); }
        }
        return { t: 'array', items: items, length: len, holes: holes || undefined, truncated: len > MAX_ITEMS || undefined };
      }
      var names = getOwnPropertyNames(v);
      var entries = [];
      for (var j = 0; j < names.length && entries.length < MAX_ITEMS; j++) {
        var pd = getOPD(v, names[j]);
        if (!pd || !pd.enumerable) { continue; }
        push(entries, [names[j], pd.get ? { t: 'getter' } : serialize(pd.value, depth + 1, seen)]);
      }
      return { t: 'object', className: ctorName(v), entries: entries, truncated: names.length > MAX_ITEMS || undefined };
    } catch (err) {
      return { t: 'unserializable', reason: '' + (err && err.message) };
    }
  };
  var ctorName = function (v) {
    try { var p = getProto(v); return p === null ? null : (p.constructor && p.constructor.name) || 'Object'; } catch (e) { return 'Object'; }
  };
  var ser = function (v) { return serialize(v, 0, new MapCtor()); };

  var scheduleFlush = function () {
    if (flushScheduled) { return; }
    flushScheduled = true;
    setTimeoutRaw(flush, 16);
  };
  var flush = function () {
    flushScheduled = false;
    if (batch.length) { var b = batch; batch = []; send({ type: 'console', entries: b }); }
  };

  var addEntry = function (level, args) {
    if (consoleCount >= MAX_ENTRIES) { dropped++; return; }
    consoleCount++;
    var sargs = [];
    for (var i = 0; i < args.length; i++) { push(sargs, ser(args[i])); }
    if (estimate(sargs, 0) > MAX_ENTRY_BYTES) { sargs = [{ t: 'unserializable', reason: 'entry exceeds maxEntryBytes' }]; }
    push(batch, { seq: consoleCount, level: level, args: sargs, at: Math.round(now() - t0) });
    scheduleFlush();
  };

  var shimConsole = {};
  var levels = ['log', 'info', 'warn', 'error', 'debug', 'table', 'dir'];
  for (var li = 0; li < levels.length; li++) {
    (function (lv) { shimConsole[lv] = function () { addEntry(lv, arguments); }; })(levels[li]);
  }
  shimConsole.assert = function (c) { if (!c) { addEntry('error', ['Assertion failed']); } };
  shimConsole.clear = function () {};
  shimConsole.group = shimConsole.log;
  shimConsole.groupEnd = function () {};
  try { defineProperty(G, 'console', { value: shimConsole, writable: true, configurable: true }); } catch (e) { G.console = shimConsole; }

  var dialog = function (kind, ret) { return function (m) { addEntry(kind, [m === undefined ? '' : m]); return ret; }; };
  try {
    defineProperty(G, 'alert', { value: dialog('alert', undefined), writable: true, configurable: true });
    defineProperty(G, 'confirm', { value: dialog('confirm', false), writable: true, configurable: true });
    defineProperty(G, 'prompt', { value: dialog('prompt', null), writable: true, configurable: true });
    caps.dialogShim = true;
  } catch (e) { caps.dialogShim = 'failed: ' + e.message; }

  var memStorage = function () {
    var data = new MapCtor();
    return {
      getItem: function (k) { return data.has('' + k) ? data.get('' + k) : null; },
      setItem: function (k, v) { data.set('' + k, '' + v); },
      removeItem: function (k) { data['delete']('' + k); },
      clear: function () { data.clear(); },
      key: function () { return null; },
      get length() { return data.size; }
    };
  };
  if (!isWorker) {
    try { var probe = G.localStorage; caps.nativeLocalStorage = probe ? 'accessible' : 'null'; } catch (e) { caps.nativeLocalStorage = 'throws ' + e.name; }
    try {
      defineProperty(G, 'localStorage', { value: memStorage(), configurable: true });
      defineProperty(G, 'sessionStorage', { value: memStorage(), configurable: true });
      caps.storageShim = G.localStorage && typeof G.localStorage.setItem === 'function' ? 'installed' : 'not-effective';
    } catch (e) { caps.storageShim = 'failed: ' + e.message; }
    try { var ck = G.document.cookie; caps.cookieRead = 'ok:' + JSON.stringify(ck); } catch (e) { caps.cookieRead = 'throws ' + e.name; }
    try { G.document.cookie = 'pg=1'; caps.cookieWrite = 'no-throw, now ' + JSON.stringify(G.document.cookie); } catch (e) { caps.cookieWrite = 'throws ' + e.name; }
    caps.isSecureContext = G.isSecureContext;
    caps.origin = G.origin;
  }

  var pendingTimeouts = 0;
  var pendingIntervals = 0;
  var lastActivity = now();
  var liveTimeouts = new MapCtor();
  var liveIntervals = new MapCtor();
  try {
    defineProperty(G, 'setTimeout', { writable: true, configurable: true, value: function (fn, ms) {
      if (typeof fn !== 'function') { return apply(nSetTimeout, G, arguments); }
      var extra = apply(arrSlice, arguments, [2]);
      var id = apply(nSetTimeout, G, [function () {
        if (liveTimeouts.has(id)) { liveTimeouts['delete'](id); pendingTimeouts--; }
        lastActivity = now();
        apply(fn, G, extra);
      }, ms]);
      liveTimeouts.set(id, 1);
      pendingTimeouts++;
      return id;
    } });
    defineProperty(G, 'clearTimeout', { writable: true, configurable: true, value: function (id) {
      if (liveTimeouts.has(id)) { liveTimeouts['delete'](id); pendingTimeouts--; }
      return apply(nClearTimeout, G, [id]);
    } });
    defineProperty(G, 'setInterval', { writable: true, configurable: true, value: function (fn, ms) {
      if (typeof fn !== 'function') { return apply(nSetInterval, G, arguments); }
      var id = apply(nSetInterval, G, [function () { lastActivity = now(); apply(fn, G, []); }, ms]);
      liveIntervals.set(id, 1);
      pendingIntervals++;
      return id;
    } });
    defineProperty(G, 'clearInterval', { writable: true, configurable: true, value: function (id) {
      if (liveIntervals.has(id)) { liveIntervals['delete'](id); pendingIntervals--; }
      return apply(nClearInterval, G, [id]);
    } });
  } catch (e) { caps.timerShim = 'failed: ' + e.message; }

  var recordError = function (phase, e, pos) {
    var name = (e && e.name) || 'Error';
    var message = '' + ((e && e.message) || e);
    var rec = { phase: phase, name: name, message: message };
    if (pos) { rec.position = pos; }
    if (e && typeof e.stack === 'string') { rec.stackPositions = stackPositions(e.stack); rec.rawStackHead = apply(strSlice, e.stack, [0, 300]); }
    push(errors, rec);
  };
  var fileMap = CFG.fileMap || {};
  var stackPositions = function (stack) {
    var re = /(blob:[^\s)]+?|about:srcdoc|learner:\/\/\/[^\s):]+):(\d+):(\d+)/g;
    var out = [];
    var m;
    while ((m = apply(reExec, re, [stack])) && out.length < 10) {
      push(out, { file: fileMap[m[1]] || m[1], line: +m[2], column: +m[3] });
    }
    return out;
  };

  var loopRecorded = false;
  var pg = {
    enter: function (id, line, col) { return { id: id, line: line, col: col, start: now(), n: 0, tripped: false }; },
    tick: function (h) {
      h.n++;
      if (h.tripped) { throw new LoopLimit(h); }
      if ((h.n & 255) === 0 && now() - h.start > LOOP_BUDGET) {
        h.tripped = true;
        loopLimitHit = true;
        if (!loopRecorded) {
          loopRecorded = true;
          push(errors, { phase: 'loop_limit', name: 'LoopLimitError', message: 'loop ran longer than ' + LOOP_BUDGET + 'ms', position: { line: h.line, column: h.col, loopId: h.id }, iterations: h.n });
        }
        throw new LoopLimit(h);
      }
    },
    expose: function (o) { exposed = o; },
    w: function (i) {
      var code = (CFG.scripts || [])[i];
      var u = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      fileMap[u] = 'index.html#script' + (i + 1);
      G.document.write('<script src="' + u + '"><\/script>');
    },
    MISSING: freeze({ missing: true }),
    TDZ: freeze({ tdz: true })
  };
  var exposed = {};
  freeze(pg);
  defineProperty(G, '__pg', { value: pg, writable: false, configurable: false, enumerable: false });

  var onError = function (ev) {
    if (isLoopLimit(ev.error)) { if (ev.preventDefault) { ev.preventDefault(); } return; }
    recordError('runtime', ev.error || { name: 'Error', message: ev.message }, { line: ev.lineno, column: ev.colno, file: ev.filename });
  };
  var onRejection = function (ev) {
    if (isLoopLimit(ev.reason)) { return; }
    recordError('unhandled_rejection', ev.reason);
  };
  G.addEventListener('error', onError, true);
  G.addEventListener('unhandledrejection', onRejection, true);
  caps.unhandledRejectionEventSupported = 'onunhandledrejection' in G;
  G.addEventListener('securitypolicyviolation', function (ev) {
    if (csp.length < 50) { push(csp, { directive: ev.effectiveDirective || ev.violatedDirective, blocked: ev.blockedURI, sample: ev.sample }); }
  }, true);

  var wait = function (ms) { return new PromiseCtor(function (r) { setTimeoutRaw(r, ms); }); };
  var settle = function (maxMs) {
    var deadline = now() + maxMs;
    return new PromiseCtor(function (resolve) {
      var check = function () {
        var quiet = pendingTimeouts === 0 && now() - lastActivity >= QUIET_MS;
        if (quiet || now() >= deadline) { resolve(quiet); return; }
        setTimeoutRaw(check, 10);
      };
      check();
    });
  };

  var shellReplies = new MapCtor();
  var shellSeq = 0;
  var askShell = function (msg) {
    return new PromiseCtor(function (resolve) {
      var id = ++shellSeq;
      msg.reqId = id;
      shellReplies.set(id, resolve);
      send(msg);
    });
  };
  var onShellMessage = function (e) {
    var d = e.data;
    if (d && d.reqId && shellReplies.has(d.reqId)) { var r = shellReplies.get(d.reqId); shellReplies['delete'](d.reqId); r(d); }
  };

  var lookup = function (name) {
    if (exposed && name in exposed && exposed[name] !== pg.MISSING) { return { found: exposed[name] !== pg.TDZ, tdz: exposed[name] === pg.TDZ, value: exposed[name] }; }
    if (name in G) { return { found: true, value: G[name] }; }
    return { found: false };
  };

  var withTimeout = function (p, ms) {
    return new PromiseCtor(function (resolve) {
      var done = false;
      setTimeoutRaw(function () { if (!done) { done = true; resolve({ timedOut: true }); } }, ms);
      p.then(function (v) { if (!done) { done = true; resolve({ value: v }); } }, function (er) { if (!done) { done = true; resolve({ rejected: er }); } });
    });
  };

  var els = function (sel) { return apply(arrSlice, G.document.querySelectorAll(sel), []); };
  var steps = {
    callFunction: function (s) {
      var f = lookup(s.name);
      if (!f.found || typeof f.value !== 'function') { return { missing: !f.found, tdz: !!f.tdz, notFunction: f.found }; }
      var before = consoleCount;
      var args = s.args || [];
      var out = {};
      try {
        var r = apply(f.value, undefined, args);
        if (r && typeof r.then === 'function') {
          return withTimeout(PromiseCtor.resolve(r), s.timeoutMs || 3000).then(function (x) {
            if (x.timedOut) { return { timedOut: true }; }
            if ('rejected' in x) { return { threw: ser(x.rejected) }; }
            return { returned: ser(x.value), async: true, argsAfter: s.observeArgsAfter ? ser(args) : undefined };
          });
        }
        out.returned = ser(r);
      } catch (e) {
        if (isLoopLimit(e)) { out.loopLimit = true; } else { out.threw = ser(e); }
      }
      if (s.observeArgsAfter) { out.argsAfter = ser(args); }
      out.consoleEntriesDuringCall = consoleCount - before;
      return out;
    },
    readGlobal: function (s) { var f = lookup(s.name); return f.found ? { value: ser(f.value) } : { missing: true, tdz: !!f.tdz }; },
    domQuery: function (s) {
      var list = els(s.selector);
      var read = s.read || ['count'];
      var res = { count: list.length, items: [] };
      for (var i = 0; i < list.length && i < 50; i++) {
        var el = list[i];
        var item = {};
        for (var j = 0; j < read.length; j++) {
          var k = read[j];
          if (k === 'text') { item.text = el.textContent; }
          else if (k === 'tagName') { item.tagName = el.tagName; }
          else if (k === 'value') { item.value = el.value; }
          else if (k === 'checked') { item.checked = el.checked; }
          else if (apply(strSlice, k, [0, 5]) === 'attr:') { item[k] = el.getAttribute(apply(strSlice, k, [5])); }
        }
        push(res.items, item);
      }
      return res;
    },
    computedStyle: function (s) {
      var list = els(s.selector);
      var res = [];
      for (var i = 0; i < list.length && i < 50; i++) {
        var cs = G.getComputedStyle(list[i], s.pseudo || null);
        var item = {};
        for (var j = 0; j < s.props.length; j++) { item[s.props[j]] = cs.getPropertyValue(s.props[j]); }
        push(res, item);
      }
      return res;
    },
    boxRect: function (s) {
      var res = {};
      for (var i = 0; i < s.selectors.length; i++) {
        var list = els(s.selectors[i]);
        var rects = [];
        for (var j = 0; j < list.length && j < 50; j++) {
          var r = list[j].getBoundingClientRect();
          push(rects, { x: r.x, y: r.y, width: r.width, height: r.height });
        }
        res[s.selectors[i]] = rects;
      }
      res.viewport = { width: G.innerWidth, height: G.innerHeight };
      return res;
    },
    dispatch: function (s) {
      var el = G.document.querySelector(s.selector);
      if (!el) { return { found: false }; }
      var errBefore = errors.length;
      var ok;
      if (s.event === 'click') { ok = el.dispatchEvent(new G.MouseEvent('click', { bubbles: true, cancelable: true })); }
      else if (s.event === 'submit') { if (el.requestSubmit) { el.requestSubmit(); ok = 'requestSubmit'; } else { ok = el.dispatchEvent(new G.Event('submit', { bubbles: true, cancelable: true })); } }
      else if (s.event === 'input') { el.value = s.value; ok = el.dispatchEvent(new G.Event('input', { bubbles: true })); }
      else { ok = el.dispatchEvent(new G.Event(s.event, { bubbles: true, cancelable: true })); }
      return { found: true, notCanceled: ok, newErrors: errors.length - errBefore };
    },
    setViewport: function (s) {
      var resized = new PromiseCtor(function (r) {
        var done = false;
        G.addEventListener('resize', function h() { if (!done) { done = true; G.removeEventListener('resize', h); r(true); } });
        setTimeoutRaw(function () { if (!done) { done = true; r(false); } }, 1000);
      });
      return askShell({ type: 'viewport', width: s.width, height: s.height }).then(function () { return resized; }).then(function (gotEvent) {
        return wait(0).then(function () { return wait(0); }).then(function () { return { resizeEvent: gotEvent, width: G.innerWidth, height: G.innerHeight }; });
      });
    },
    waitSettled: function (s) { return settle(s.maxMs || 500).then(function (q) { return { settled: q }; }); },
    timing: function () {
      var samples = [];
      var run = function (i, resolve) {
        var t = now();
        setTimeoutRaw(function () { push(samples, now() - t); if (i < 20) { run(i + 1, resolve); } else { resolve(); } }, 0);
      };
      return new PromiseCtor(function (r) { run(0, r); }).then(function () {
        var t = now();
        return new PromiseCtor(function (r) { setTimeoutRaw(function () { r(now() - t); }, 100); });
      }).then(function (late100) {
        var sum = 0;
        var max = 0;
        for (var i = 0; i < samples.length; i++) { sum += samples[i]; if (samples[i] > max) { max = samples[i]; } }
        var visibility = isWorker ? 'worker' : G.document.visibilityState;
        return { timeout0AvgMs: sum / samples.length, timeout0MaxMs: max, timeout100ActualMs: late100, visibility: visibility };
      });
    }
  };

  var observations = [];
  var runSteps = function (list) {
    var i = 0;
    var next = function () {
      if (!list || i >= list.length) { return PromiseCtor.resolve(); }
      var s = list[i++];
      var fn = steps[s.kind];
      var p;
      try { p = PromiseCtor.resolve(fn ? fn(s) : { unknownStep: s.kind }); } catch (e) { p = PromiseCtor.resolve({ stepError: ser(e) }); }
      return withTimeout(p, s.timeoutMs || limits.checkTimeoutMs || 3000).then(function (x) {
        var v = x.timedOut ? { stepTimeout: true } : ('rejected' in x ? { stepError: ser(x.rejected) } : x.value);
        if (estimate(v, 0) > MAX_OBS_BYTES) { v = { truncated: true, reason: 'maxObservationBytes' }; }
        push(observations, { kind: s.kind, value: v });
        return next();
      });
    };
    return next();
  };

  var finished = false;
  var finish = function () {
    if (finished) { return; }
    finished = true;
    flush();
    var status = loopLimitHit ? 'loop_limit' : (errors.length ? 'error' : 'completed');
    send({
      type: 'done',
      status: status,
      errors: errors,
      observations: observations,
      consoleCount: consoleCount,
      droppedConsoleEntries: dropped,
      pendingAtEnd: { timers: pendingTimeouts, intervals: pendingIntervals },
      csp: csp,
      caps: caps,
      harnessMs: Math.round(now() - t0)
    });
  };

  var afterScripts = function () {
    var budget = Math.max(100, MAX_DURATION - (now() - t0) - 200);
    return settle(budget).then(function () { return runSteps(CFG.steps); }).then(finish, function (e) { recordError('harness', e); finish(); });
  };

  if (isWorker) {
    var hide = ['EventSource', 'Worker', 'SharedWorker'];
    caps.hiddenInWorker = [];
    for (var hi = 0; hi < hide.length; hi++) {
      try { defineProperty(G, hide[hi], { value: undefined, writable: false, configurable: false }); push(caps.hiddenInWorker, hide[hi]); } catch (e) { push(caps.hiddenInWorker, hide[hi] + ':failed'); }
    }
    var onStart = function (e) {
      var d = e.data;
      if (port || !d || d.type !== 'pg-start' || !e.ports || !e.ports[0]) { return; }
      port = e.ports[0];
      port.onmessage = onShellMessage;
      for (var q = 0; q < outbox.length; q++) { apply(pmPort, port, [outbox[q]]); }
      outbox = [];
      G.removeEventListener('message', onStart);
      for (var i = 0; i < d.scripts.length; i++) {
        try { G.importScripts(d.scripts[i]); } catch (err) {
          if (!isLoopLimit(err)) { recordError(err && err.name === 'SyntaxError' ? 'syntax' : 'runtime', err); }
        }
      }
      if (d.exposeUrl) { try { G.importScripts(d.exposeUrl); } catch (err2) { recordError('harness', err2); } }
      afterScripts();
    };
    G.addEventListener('message', onStart);
    caps.importScripts = typeof G.importScripts;
  } else {
    G.addEventListener('message', function (e) {
      if (port || e.source !== G.parent || !e.data || e.data.type !== 'pg-port' || !e.ports || !e.ports[0]) { return; }
      e.stopImmediatePropagation();
      port = e.ports[0];
      port.onmessage = onShellMessage;
      for (var q = 0; q < outbox.length; q++) { apply(pmPort, port, [outbox[q]]); }
      outbox = [];
    }, true);
    G.parent.postMessage({ type: 'pg-harness-hello', v: 1 }, '*');
    G.addEventListener('load', function () { afterScripts(); });
  }
})();
