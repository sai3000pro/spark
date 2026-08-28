"""The page the studio serves to itself.

WHY THIS EXISTS
    The frozen build was a 163 MB download that required a terminal. Everything
    it could do, it could only be told to do by typing a path into a shell -
    which is exactly the audience it was built to avoid. Double-clicking it
    opened a console, printed three lines of health check, and closed.

    So the executable serves its own page. Double-click, a browser opens, drop a
    video in, watch it build. No Node, no repo, no npm, no terminal.

WHY ONE FILE WITH NO CDN
    This runs on a laptop that may have no internet - that is half the point of
    reconstructing locally - so every byte of CSS and script is inline. A page
    that renders unstyled because fonts.googleapis.com was unreachable would be
    a strange way to fail for a tool whose whole promise is that it needs
    nothing.

WHY THE UPLOAD IS A RAW BODY
    `fetch(url, { body: file })` sends the file's bytes as the request body,
    which the server reads with a Content-Length and a loop. The alternative is
    multipart, which means writing a boundary parser in the server for no gain -
    `cgi.FieldStorage` was removed in Python 3.13 and there is no stdlib
    replacement that streams.

WHAT THE PAGE PROMISES, AND WHAT IT REFUSES TO
    It says the honest number: half an hour to two hours on a laptop without
    CUDA. Somebody who knows that will not kill it at minute six. It shows the
    stage and the percentage the worker actually reports, never a fake bar.
"""

from __future__ import annotations

PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spark Studio</title>
<style>
  :root {
    --bg: #12110f; --panel: #1b1a17; --line: #2e2c27;
    --ink: #ece8e0; --soft: #a8a196; --faint: #6f695f;
    --brass: #c39d5a; --clay: #c97a5a; --good: #7fa96a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 32px 20px 64px;
  }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 21px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { color: var(--soft); font-size: 13.5px; margin: 0 0 26px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  .panel {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 8px; padding: 20px; margin-bottom: 16px;
  }
  #drop {
    border: 1.5px dashed #3a382f; border-radius: 8px; padding: 34px 20px;
    text-align: center; transition: border-color .15s, background .15s;
  }
  #drop.over { border-color: var(--brass); background: #201d17; }
  button, .btn {
    background: var(--brass); color: #17140f; border: 0; border-radius: 999px;
    padding: 9px 18px; font-size: 14px; font-weight: 600; cursor: pointer;
    font-family: inherit; text-decoration: none; display: inline-block;
  }
  button:disabled { opacity: .45; cursor: default; }
  .ghost { background: transparent; color: var(--soft); border: 1px solid var(--line); }
  label.opt { color: var(--soft); font-size: 13px; display: inline-flex; align-items: center; gap: 8px; }
  select, input[type=text] {
    background: #17150f; color: var(--ink); border: 1px solid var(--line);
    border-radius: 6px; padding: 7px 10px; font: inherit; font-size: 13.5px;
  }
  .row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-top: 16px; }
  .note { color: var(--faint); font-size: 12px; margin-top: 10px; }
  .bar { height: 4px; background: #2a2822; border-radius: 999px; overflow: hidden; margin-top: 9px; }
  .bar > i { display: block; height: 100%; background: var(--brass); width: 0; transition: width .3s; }
  .job { border-top: 1px solid var(--line); padding: 14px 0; }
  .job:first-of-type { border-top: 0; }
  .job h3 { margin: 0; font-size: 14.5px; font-weight: 600; }
  .job .meta { color: var(--soft); font-size: 12.5px; margin-top: 3px; }
  .tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--soft); }
  .tag.run { color: var(--brass); border-color: #4a3c22; }
  .tag.done { color: var(--good); border-color: #33422b; }
  .tag.fail { color: var(--clay); border-color: #4a2f22; }
  .err { color: var(--clay); font-size: 13px; margin-top: 10px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  h2 { font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: var(--faint);
       margin: 0 0 14px; font-weight: 600; }
  a { color: var(--brass); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Spark Studio</h1>
  <p class="sub">A video goes in, a Gaussian splat comes out, and none of it leaves this machine.</p>

  <div class="panel">
    <div id="drop">
      <button id="pick">Choose a video</button>
      <p class="note">or drop one here &middot; mp4, mov, m4v, webm</p>
      <input id="file" type="file" accept="video/*" hidden>
      <div id="sending" style="display:none">
        <p class="mono" id="sendtext">Sending&hellip;</p>
        <div class="bar"><i id="sendbar"></i></div>
      </div>
      <p class="err" id="err" style="display:none"></p>
    </div>
    <div class="row">
      <label class="opt">Quality
        <select id="preset">
          <option value="fast">fast &middot; 10k steps</option>
          <option value="balanced" selected>balanced &middot; 30k steps</option>
          <option value="high">high &middot; 50k steps</option>
        </select>
      </label>
      <span class="note" style="margin:0" id="health">checking this machine&hellip;</span>
    </div>
    <p class="note">
      Reconstruction is slow: roughly <strong>30 minutes to 2 hours</strong> on a laptop with no
      CUDA, depending on quality and clip length. You can close this tab &mdash; the work carries on
      and this page picks it back up.
    </p>
  </div>

  <div class="panel">
    <div class="head"><h2>Reconstructions</h2><span class="note mono" id="count"></span></div>
    <div id="jobs"><p class="note" style="margin:0">Nothing yet.</p></div>
  </div>

  <p class="note">
    Walk <em>around</em> the subject rather than panning from one spot &mdash; camera solving needs
    parallax, and footage shot from a single position cannot be reconstructed by anything.
  </p>
</div>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var busy = false;

  fetch('/api/studio/health').then(function (r) { return r.json(); }).then(function (d) {
    $('health').textContent = d.ready
      ? 'all three stages can run here'
      : 'MISSING: ' + d.missing.join(', ');
    if (!d.ready) $('health').style.color = 'var(--clay)';
  }).catch(function () { $('health').textContent = ''; });

  function fail(msg) {
    $('err').textContent = msg;
    $('err').style.display = 'block';
    $('sending').style.display = 'none';
    $('pick').style.display = '';
    busy = false;
  }

  function send(file) {
    if (!file || busy) return;
    busy = true;
    $('err').style.display = 'none';
    $('pick').style.display = 'none';
    $('sending').style.display = 'block';
    $('sendbar').style.width = '0';
    $('sendtext').textContent = 'Sending ' + file.name;

    // XHR rather than fetch: only XHR reports upload progress, and a video is
    // big enough that a silent wait looks like a hang.
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/studio/reconstruct?preset=' + encodeURIComponent($('preset').value));
    xhr.setRequestHeader('X-Video-Filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = function (e) {
      if (!e.lengthComputable) return;
      $('sendbar').style.width = (e.loaded / e.total * 100) + '%';
    };
    xhr.upload.onload = function () { $('sendtext').textContent = 'Queued. Starting…'; };
    xhr.onload = function () {
      busy = false;
      $('sending').style.display = 'none';
      $('pick').style.display = '';
      var d = {};
      try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) { poll(); }
      else { fail(d.error || ('Upload failed (' + xhr.status + ')')); }
    };
    xhr.onerror = function () { fail('The connection to the studio dropped.'); };
    xhr.send(file);
  }

  $('pick').onclick = function () { $('file').click(); };
  $('file').onchange = function (e) { send(e.target.files[0]); e.target.value = ''; };

  var drop = $('drop');
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault(); drop.classList.remove('over'); send(e.dataTransfer.files[0]);
  });

  function human(s) {
    if (s < 90) return Math.round(s) + 's';
    var m = s / 60;
    if (m < 60) return m.toFixed(1) + ' min';
    return Math.floor(m / 60) + 'h ' + Math.round(m % 60) + 'm';
  }
  function mb(b) { return (b / 1048576).toFixed(1) + ' MB'; }

  function render(jobs) {
    $('count').textContent = jobs.length ? jobs.length + ' total' : '';
    if (!jobs.length) {
      $('jobs').innerHTML = '<p class="note" style="margin:0">Nothing yet.</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      var tag = j.status === 'running' ? '<span class="tag run">building</span>'
              : j.status === 'done' ? '<span class="tag done">ready</span>'
              : j.status === 'failed' ? '<span class="tag fail">failed</span>'
              : '<span class="tag">queued</span>';
      html += '<div class="job"><div class="head"><h3>' + esc(j.name) + '</h3>' + tag + '</div>';
      if (j.status === 'running') {
        html += '<div class="meta">' + esc(j.stage || 'working') + '</div>'
             +  '<div class="bar"><i style="width:' + Math.round((j.fraction || 0) * 100) + '%"></i></div>';
      } else if (j.status === 'done') {
        html += '<div class="meta">' + mb(j.bytes) + (j.seconds ? ' &middot; took ' + human(j.seconds) : '') + '</div>'
             +  '<div class="row" style="margin-top:10px">'
             +  '<a class="btn" href="/api/studio/download?job=' + encodeURIComponent(j.id) + '">Download .ply</a>'
             +  '</div>';
      } else if (j.status === 'failed') {
        html += '<div class="err">' + esc(j.error || 'It did not finish.') + '</div>'
             +  '<div class="meta">The clip is still here, so a retry reuses whatever stage did work.</div>';
      } else {
        html += '<div class="meta">waiting for the one ahead of it</div>';
      }
      html += '</div>';
    }
    $('jobs').innerHTML = html;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function poll() {
    fetch('/api/studio/jobs', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { render(d.jobs || []); })
      .catch(function () { /* the server is restarting or gone; the next tick retries */ });
  }
  poll();
  setInterval(poll, 2000);
})();
</script>
</body>
</html>
"""
