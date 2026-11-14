/* Runner shell controller. Runs inside /sandbox/runner.html (opaque origin, shell CSP).
   HARNESS_SRC is defined by the server just before this script. */
(function () {
  'use strict';
  var hostPort = null;
  var current = null;
  var ignoredWindowMessages = 0;

  var caps = {
    origin: self.origin,
    isSecureContext: self.isSecureContext,
    hasWorker: typeof Worker === 'function',
    hasMessageChannel: typeof MessageChannel === 'function',
  };
  try { caps.shellCookie = 'ok:' + JSON.stringify(document.cookie); } catch (e) { caps.shellCookie = 'throws ' + e.name; }
  try { void localStorage; caps.shellLocalStorage = 'accessible'; } catch (e) { caps.shellLocalStorage = 'throws ' + e.name; }

  parent.postMessage({ type: 'shell-hello', v: 1 }, '*');

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!hostPort && e.source === parent && d && d.type === 'connect' && e.ports && e.ports[0]) {
      hostPort = e.ports[0];
      hostPort.onmessage = onHost;
      hostPort.postMessage({ type: 'ready', v: 1, caps: caps });
      return;
    }
    if (current && current.frame && e.source === current.frame.contentWindow && d && d.type === 'pg-harness-hello' && !current.portGiven) {
      current.portGiven = true;
      e.source.postMessage({ type: 'pg-port' }, '*', [current.harnessPort]);
      return;
    }
    /* Anything else (including learner code spoofing results via parent.postMessage) is ignored. */
    ignoredWindowMessages++;
  });

  function onHost(e) {
    var m = e.data;
    if (!m || m.v !== 1) return;
    if (m.type === 'run') startRun(m);
    else if (m.type === 'abort' && current && current.runId === m.runId) finishRun({ status: 'aborted' });
    else if (m.type === 'stats') hostPort.postMessage({ type: 'stats', ignoredWindowMessages: ignoredWindowMessages });
  }

  function toBlobUrl(text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type || 'text/javascript' }));
    current.blobUrls.push(url);
    return url;
  }

  function startRun(req) {
    if (current) finishRun({ status: 'aborted', reason: 'superseded' });
    var ch = new MessageChannel();
    current = {
      runId: req.runId,
      mode: req.mode,
      started: performance.now(),
      blobUrls: [],
      consoleEntries: [],
      harnessPort: ch.port2,
      portGiven: false,
      shellNotes: [],
      done: false,
    };
    var run = current;
    ch.port1.onmessage = function (ev) { onHarness(run, ev.data); };
    run.channel = ch.port1;
    run.heartbeat = setInterval(function () {
      hostPort.postMessage({ type: 'heartbeat', v: 1, runId: run.runId, at: performance.now() - run.started });
    }, 250);
    run.hardTimer = setTimeout(function () {
      if (current === run && !run.done) finishRun({ status: 'timeout', reason: 'shell maxDurationMs' });
    }, req.limits.maxDurationMs + 300);

    var cfg = {
      limits: req.limits,
      steps: req.checks || [],
      scripts: req.scripts || [],
      fileMap: {},
    };

    if (req.mode === 'js-console') {
      var urls = [];
      for (var i = 0; i < req.files.length; i++) {
        var u = toBlobUrl(req.files[i].content);
        cfg.fileMap[u] = req.files[i].path;
        urls.push(u);
      }
      var prelude = 'self.__PG_CFG=' + JSON.stringify(cfg) + ';' + HARNESS_SRC;
      var exposeUrl = req.expose ? toBlobUrl(req.expose) : null;
      try {
        run.worker = new Worker(toBlobUrl(prelude));
        run.shellNotes.push('blob Worker created');
      } catch (err) {
        run.shellNotes.push('blob Worker FAILED: ' + err.name + ': ' + err.message);
        finishRun({ status: 'crashed', reason: 'worker-create-failed', error: String(err) });
        return;
      }
      run.worker.onerror = function (ev) {
        run.shellNotes.push('worker.onerror: ' + (ev && ev.message));
        if (ev && ev.preventDefault) ev.preventDefault();
      };
      run.worker.postMessage({ type: 'pg-start', scripts: urls, exposeUrl: exposeUrl }, [ch.port2]);
      run.portGiven = true;
    } else {
      var frame = document.createElement('iframe');
      if (req.nestedSandbox !== false) frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      frame.setAttribute('title', 'learner document');
      var vp = req.viewport || { width: 800, height: 600 };
      frame.style.width = vp.width + 'px';
      frame.style.height = vp.height + 'px';
      var cfgJson = JSON.stringify(cfg).replace(/</g, '\\u003c');
      var metaCsp = req.allowLearnerWorkers ? '' : '<meta http-equiv="Content-Security-Policy" content="worker-src \'none\'">';
      var harnessTag = metaCsp + '<script>self.__PG_CFG=' + cfgJson + ';' + HARNESS_SRC + '<\/script>';
      var html = req.files[0].content.replace('<!--PG_HARNESS-->', function () { return harnessTag; });
      frame.srcdoc = html;
      run.frame = frame;
      document.body.appendChild(frame);
      run.shellNotes.push('nested srcdoc iframe appended');
    }
  }

  function onHarness(run, msg) {
    if (current !== run || !msg) return;
    if (msg.type === 'console') {
      for (var i = 0; i < msg.entries.length; i++) run.consoleEntries.push(msg.entries[i]);
      hostPort.postMessage({ type: 'event', v: 1, runId: run.runId, kind: 'console-batch', count: msg.entries.length });
    } else if (msg.type === 'viewport') {
      if (run.frame) {
        run.frame.style.width = msg.width + 'px';
        run.frame.style.height = msg.height + 'px';
      }
      run.channel.postMessage({ reqId: msg.reqId, ok: true });
    } else if (msg.type === 'done') {
      finishRun({
        status: msg.status,
        errors: msg.errors,
        observations: msg.observations,
        consoleCount: msg.consoleCount,
        droppedConsoleEntries: msg.droppedConsoleEntries,
        pendingAtEnd: msg.pendingAtEnd,
        csp: msg.csp,
        harnessCaps: msg.caps,
        harnessMs: msg.harnessMs,
      });
    }
  }

  function finishRun(partial) {
    var run = current;
    if (!run || run.done) return;
    run.done = true;
    clearInterval(run.heartbeat);
    clearTimeout(run.hardTimer);
    if (run.worker) run.worker.terminate();
    if (run.frame && !run.keepFrame) run.frame.remove();
    for (var i = 0; i < run.blobUrls.length; i++) URL.revokeObjectURL(run.blobUrls[i]);
    current = null;
    var result = {
      type: 'result',
      v: 1,
      runId: run.runId,
      durationMs: Math.round(performance.now() - run.started),
      console: run.consoleEntries,
      shellNotes: run.shellNotes,
      ignoredWindowMessages: ignoredWindowMessages,
    };
    for (var k in partial) result[k] = partial[k];
    hostPort.postMessage(result);
  }
})();
