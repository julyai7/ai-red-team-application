(function () {
  'use strict';

  var CONFIG = window.APP_CONFIG || {};
  var API = CONFIG.apiBase || '/api';
  var MAX_MB = CONFIG.maxResumeMB || 10;
  var STORE_KEY = 'july-redteam-application-v1';
  var QUESTION_COUNT = 6;
  var SAMPLE_APP_URL = 'https://app.gojuly.ai/?invite_code=PGHFQGWA';
  var FINAL_LABEL = 'Save application & start sample submission';
  var OUT_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg>';
  var CONTACT_US = ' If it keeps happening, email <a href="mailto:info@gojuly.ai" style="color:inherit">info@gojuly.ai</a>.';

  var SOURCES = [
    'Referral', '80,000 Hours', 'Reddit', 'LinkedIn', 'Discord', 'ilovecreatives',
    'Web Forum', 'Make Writing Your Job', 'Substack', 'Fiverr', 'FreeUp', 'Freelancer',
    'Other Newsletter', 'ProBlogger', 'Flexjobs', 'Other'
  ];
  var RESUME_EXT = ['pdf', 'doc', 'docx'];

  var $ = function (id) { return document.getElementById(id); };
  var form = $('form');
  var f = form.elements;
  var panel = $('application');
  var progress = $('progress');
  var steps = Array.prototype.slice.call(form.querySelectorAll('[data-step]'));
  var nav = $('nav');
  var backBtn = $('backBtn');
  var nextBtn = $('nextBtn');
  var nextLabel = $('nextLabel');
  var nextDisc = $('nextDisc');
  var stepError = $('stepError');
  var progressFill = $('progressFill');
  var progressLabel = $('progressLabel');
  var saveState = $('saveState');
  var announce = $('announce');
  var fileInput = $('resume');
  var drop = $('drop');
  var fileChip = $('fileChip');

  var current = 0;
  var busy = false;
  var appOpened = false;

  // 'loading' until we know whether the backend is reachable, then 'api' or 'preview'.
  var mode = 'loading';
  var signedIn = false;
  var appStatus = 'draft';
  var savedAnswers = {};   // what the server has, to send only changes
  var saveTimer = null;
  var saving = null;
  var resumeFile = null;   // preview mode: the chosen File
  var resumeInfo = null;   // api mode: { fileName, sizeBytes } once stored in S3
  var uploading = null;
  var uploadSeq = 0;

  // ---------- Build the "how did you hear" choices ----------
  var CHECK = '<svg class="check" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';
  form.querySelector('[data-group="source"]').innerHTML = SOURCES.map(function (label, i) {
    var id = 'src-' + i;
    return '<div class="choice"><input type="radio" name="source" id="' + id + '" value="' + label + '">' +
      '<label for="' + id + '"><span class="key">' + String.fromCharCode(65 + i) + '</span>' + label + CHECK + '</label></div>';
  }).join('');

  // ---------- API ----------
  function api(method, path, body) {
    return fetch(API + path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.message || data.error || 'HTTP ' + res.status);
          err.status = res.status; err.code = data.error;
          throw err;
        }
        return data;
      });
    });
  }

  // ---------- Navigation ----------
  function stepName(i) { return steps[i].getAttribute('data-step'); }
  function idx(name) { return steps.findIndex(function (s) { return s.getAttribute('data-step') === name; }); }
  function isQuestion(i) { return i >= 1 && i <= QUESTION_COUNT; }

  function show(i, dir, focus) {
    steps.forEach(function (s, k) { s.hidden = k !== i; s.classList.remove('is-entering', 'is-back'); });
    var step = steps[i];
    void step.offsetWidth;
    step.classList.add('is-entering');
    if (dir === 'back') step.classList.add('is-back');
    current = i;
    progress.hidden = !isQuestion(i);
    // Remind applicants which email to sign up with on the July app.
    var email = f.email.value.trim();
    step.querySelectorAll('[data-email-echo]').forEach(function (el) { el.textContent = email; });

    var q = isQuestion(i);
    nav.hidden = !q;
    clearError();
    if (q) {
      progressFill.style.width = (i / QUESTION_COUNT) * 100 + '%';
      progressLabel.textContent = i + ' of ' + QUESTION_COUNT;
      setNextLabel();
      backBtn.hidden = false;
    }
    if (focus !== false) {
      var heading = step.querySelector('.q-title');
      if (heading) heading.focus({ preventScroll: true });
      // Keep the top of the question in view after moving between steps.
      var top = panel.getBoundingClientRect().top;
      if (top < 0) window.scrollTo({ top: window.scrollY + top - 80, behavior: 'smooth' });
    }
    if (q) announce.textContent = 'Question ' + i + ' of ' + QUESTION_COUNT;
    saveLocal();
  }

  function setNextLabel() {
    var last = current === QUESTION_COUNT;
    nextLabel.textContent = last ? FINAL_LABEL : 'Continue';
    nextDisc.innerHTML = last ? OUT_ICON : '';
  }

  function setBusy(on, label) {
    busy = on;
    nextBtn.disabled = on;
    backBtn.disabled = on;
    if (on) {
      nextLabel.textContent = label || 'Saving…';
      nextDisc.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
    } else setNextLabel();
  }

  function next() {
    if (busy) return;
    var name = stepName(current);
    if (name === 'returning') { requestLink(); return; }
    if (name === 'check' || name === 'done') return;
    if (isQuestion(current) && !validate(current)) return;
    if (name === 'contact' && mode === 'api' && !signedIn) { startApplication(); return; }
    if (current === QUESTION_COUNT) {
      // Open the July app inside the click/keypress itself so popup blockers allow it,
      // then save the application in the background.
      if (!appOpened) { window.open(SAMPLE_APP_URL, '_blank', 'noopener'); appOpened = true; }
      submit();
      return;
    }
    if (signedIn) flush().catch(function () {}); // don't hold people up; the save indicator reports problems
    show(current + 1, 'fwd');
  }
  function back() { if (current > 0 && !busy) show(current - 1, 'back'); }

  form.querySelectorAll('[data-next]').forEach(function (b) { b.addEventListener('click', next); });
  form.querySelectorAll('[data-goto]').forEach(function (b) {
    b.addEventListener('click', function () {
      var to = b.getAttribute('data-goto');
      if (to === 'returning' && !$('returnEmail').value) $('returnEmail').value = f.email.value.trim();
      $('returnError').hidden = true;
      show(idx(to), to === 'welcome' ? 'back' : 'fwd');
      if (to === 'returning') $('returnEmail').focus();
    });
  });
  nextBtn.addEventListener('click', next);
  backBtn.addEventListener('click', back);
  form.addEventListener('submit', function (e) { e.preventDefault(); next(); });

  // ---------- Validation ----------
  function setFieldError(input, msg) {
    var err = $(input.id + '-err');
    if (err) err.textContent = msg || '';
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }
  var ERR_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.3"/><path d="M8 4.8v3.6M8 11h.01"/></svg>';
  function showError(msg, el) {
    el = el || stepError;
    el.innerHTML = ERR_ICON + '<span>' + msg + '</span>';
    el.hidden = false;
  }
  function clearError() { stepError.hidden = true; stepError.textContent = ''; }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function emailError(v) { return !v ? 'Enter your email' : (!EMAIL_RE.test(v) ? 'That email doesn’t look right. Check for typos.' : ''); }

  function validate(i) {
    clearError();
    var step = steps[i];
    var name = stepName(i);
    var firstBad = null;

    if (name === 'contact') {
      [['firstName', 'Enter your first name'], ['lastName', 'Enter your last name']].forEach(function (p) {
        var el = f[p[0]];
        var bad = !el.value.trim();
        setFieldError(el, bad ? p[1] : '');
        if (bad && !firstBad) firstBad = el;
      });
      var emailMsg = emailError(f.email.value.trim());
      setFieldError(f.email, emailMsg);
      if (emailMsg && !firstBad) firstBad = f.email;
      var digits = f.phone.value.replace(/\D/g, '');
      var phoneMsg = f.phone.value.trim() && (digits.length < 7 || digits.length > 15) ? 'Enter a full phone number, or leave it blank' : '';
      setFieldError(f.phone, phoneMsg);
      if (phoneMsg && !firstBad) firstBad = f.phone;
      if (firstBad) { firstBad.focus(); return false; }
      return true;
    }

    if (name === 'resume') {
      if (uploading) { showError('Your resume is still uploading. One moment.'); return false; }
      if (mode === 'api' ? !resumeInfo : !resumeFile) {
        drop.setAttribute('aria-invalid', 'true'); showError('Upload your resume to continue'); return false;
      }
      return true;
    }

    var groups = step.querySelectorAll('[data-required][data-group]');
    for (var g = 0; g < groups.length; g++) {
      var gname = groups[g].getAttribute('data-group');
      if (!form.querySelector('input[name="' + gname + '"]:checked')) {
        showError(groups[g].querySelector('input[type="checkbox"]') ? 'Check the box to continue' : 'Choose an option to continue');
        return false;
      }
    }

    if (name === 'auth' && f.workAuth.value === 'Other') {
      var msg = f.workAuthOther.value.trim() ? '' : 'Tell us about your work authorization';
      setFieldError(f.workAuthOther, msg);
      if (msg) { f.workAuthOther.focus(); return false; }
    }
    return true;
  }

  // Clear field errors as people fix them, and autosave.
  form.addEventListener('input', function (e) {
    if (e.target.getAttribute('aria-invalid') === 'true') setFieldError(e.target, '');
    saveLocal();
    queueSave();
  });

  // ---------- Choices ----------
  var advanceTimer = null;
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t === fileInput) return;
    clearError();
    if (t.name === 'workAuth') {
      var isOther = t.value === 'Other';
      $('workAuthOtherWrap').hidden = !isOther;
      if (isOther) { f.workAuthOther.focus(); saveLocal(); queueSave(); return; }
    }
    saveLocal();
    queueSave();
    // Single-choice questions move on by themselves, like the original form.
    if (current === QUESTION_COUNT || !isQuestion(current)) return;
    if (t.type === 'radio' || t.type === 'checkbox' && t.checked) {
      clearTimeout(advanceTimer);
      var at = current;
      advanceTimer = setTimeout(function () { if (current === at) next(); }, 420);
    }
  });

  // ---------- Keyboard ----------
  document.addEventListener('keydown', function (e) {
    if (panel.hidden) return;
    var t = e.target;
    var tag = t.tagName;
    var typing = tag === 'TEXTAREA' || (tag === 'INPUT' && /^(text|email|tel|search)$/.test(t.type));

    if (e.key === 'Enter' && !e.shiftKey) {
      if (tag === 'A' || (tag === 'BUTTON' && t !== nextBtn)) return;
      if (tag === 'TEXTAREA' && !(e.metaKey || e.ctrlKey)) return;
      var n = stepName(current);
      if (n === 'done' || n === 'check') return;
      e.preventDefault();
      next();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[a-z]$/i.test(e.key) && isQuestion(current)) {
      var i = e.key.toUpperCase().charCodeAt(0) - 65;
      var inputs = steps[current].querySelectorAll('.choice input');
      if (inputs[i]) {
        e.preventDefault();
        var inp = inputs[i];
        if (inp.type === 'checkbox') inp.checked = !inp.checked; else inp.checked = true;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.focus({ preventScroll: true });
      }
    }
  });

  // ---------- Answers & autosave ----------
  function currentAnswers() {
    return {
      first_name: f.firstName.value.trim(),
      last_name: f.lastName.value.trim(),
      phone: f.phone.value.trim(),
      source: f.source.value || '',
      work_auth: f.workAuth.value || '',
      work_auth_other: f.workAuthOther.value.trim(),
      ack_application_process: f.ackProcess.checked ? 'true' : 'false',
      ack_sample_steps: f.ackSteps.checked ? 'true' : 'false'
    };
  }

  function setSaveState(text, isError) {
    saveState.textContent = text || '';
    saveState.classList.toggle('is-error', !!isError);
  }

  function canSave() { return mode === 'api' && signedIn && appStatus === 'draft'; }

  function queueSave() {
    if (!canSave()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { flush().catch(function () {}); }, 700);
  }

  // Sends any changed answers now. Resolves once the server has them.
  function flush() {
    clearTimeout(saveTimer);
    if (!canSave()) return Promise.resolve();
    if (saving) return saving.catch(function () {}).then(flush);
    var all = currentAnswers();
    var diff = {};
    var changed = false;
    Object.keys(all).forEach(function (k) {
      if (all[k] !== (savedAnswers[k] || '')) { diff[k] = all[k]; changed = true; }
    });
    if (!changed) return Promise.resolve();
    setSaveState('Saving…');
    saving = api('PATCH', '/application', { answers: diff }).then(function () {
      saving = null;
      Object.keys(diff).forEach(function (k) { savedAnswers[k] = diff[k]; });
      setSaveState('Saved');
    }, function (err) {
      saving = null;
      if (err.status === 401) { signedOut(); throw err; }
      setSaveState('Couldn’t save. Retrying…', true);
      saveTimer = setTimeout(function () { flush().catch(function () {}); }, 4000);
      throw err;
    });
    return saving;
  }

  // Fills the form from the server's copy of the application.
  function applyState(app) {
    signedIn = true;
    appStatus = app.status;
    var a = app.answers || {};
    savedAnswers = Object.assign({}, a);
    f.email.value = app.email;
    f.email.readOnly = true;
    $('emailNote').hidden = false;
    if (a.first_name != null) f.firstName.value = a.first_name;
    if (a.last_name != null) f.lastName.value = a.last_name;
    if (a.phone != null) f.phone.value = a.phone;
    Array.prototype.forEach.call(f.source, function (r) { r.checked = r.value === a.source; });
    Array.prototype.forEach.call(f.workAuth, function (r) { r.checked = r.value === a.work_auth; });
    f.workAuthOther.value = a.work_auth_other || '';
    $('workAuthOtherWrap').hidden = a.work_auth !== 'Other';
    f.ackProcess.checked = a.ack_application_process === 'true';
    f.ackSteps.checked = a.ack_sample_steps === 'true';
    resumeInfo = app.resume;
    if (resumeInfo) showChip(resumeInfo.fileName, fmtSize(resumeInfo.sizeBytes), false);
    else hideChip();
  }

  // Where a returning applicant should land.
  function resumeStep(app) {
    if (app.status === 'submitted') return idx('done');
    var a = app.answers || {};
    if (!a.first_name || !a.last_name) return idx('contact');
    if (!a.source) return idx('source');
    if (!app.resume) return idx('resume');
    if (!a.work_auth || (a.work_auth === 'Other' && !a.work_auth_other)) return idx('auth');
    if (a.ack_application_process !== 'true') return idx('ack');
    return idx('sample');
  }

  function signedOut() {
    signedIn = false;
    f.email.readOnly = false;
    $('emailNote').hidden = true;
    setSaveState('');
    show(idx('contact'), 'back');
    showError('You’ve been signed out. Select Continue and we’ll email you a link to pick up where you left off.');
  }

  // ---------- Starting, returning, and starting over ----------
  function startApplication() {
    setBusy(true);
    api('POST', '/start', {
      email: f.email.value.trim(),
      firstName: f.firstName.value.trim(),
      lastName: f.lastName.value.trim(),
      phone: f.phone.value.trim(),
      company_website: f.company_website.value
    }).then(function (r) {
      setBusy(false);
      if (r.status === 'check_email') {
        $('checkMsg').innerHTML = 'There’s already an application for <strong></strong>. We sent a link to that address so you can pick up where you left off.';
        $('checkMsg').querySelector('strong').textContent = f.email.value.trim();
        show(idx('check'), 'fwd');
        return;
      }
      applyState(r.application);
      setSaveState('Saved');
      show(current + 1, 'fwd');
    }).catch(function (err) {
      setBusy(false);
      showError('We couldn’t save your details. Check your connection and try again.' + CONTACT_US);
      console.error(err);
    });
  }

  function requestLink() {
    var input = $('returnEmail');
    var v = input.value.trim();
    var msg = emailError(v);
    setFieldError(input, msg);
    $('returnError').hidden = true;
    if (msg) { input.focus(); return; }
    var btn = $('returnBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    api('POST', '/auth/link', { email: v }).then(function () {
      $('checkMsg').innerHTML = 'If there’s an application for <strong></strong>, we’ve sent a link to that address so you can pick up where you left off.';
      $('checkMsg').querySelector('strong').textContent = v;
      show(idx('check'), 'fwd');
    }).catch(function (err) {
      console.error(err);
      showError('We couldn’t send the link. Try again in a minute.' + CONTACT_US, $('returnError'));
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Email me a link';
    });
  }
  $('returnBtn').addEventListener('click', requestLink);

  $('startOver').addEventListener('click', function () {
    api('POST', '/auth/logout', {}).catch(function () {}).then(function () {
      signedIn = false;
      appStatus = 'draft';
      savedAnswers = {};
      form.reset();
      f.email.readOnly = false;
      $('emailNote').hidden = true;
      $('workAuthOtherWrap').hidden = true;
      resumeInfo = null; resumeFile = null; hideChip();
      setSaveState('');
      show(idx('contact'), 'back');
      f.firstName.focus();
    });
  });

  // ---------- Resume upload ----------
  function fmtSize(b) { return b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1024 / 1024).toFixed(1) + ' MB'; }

  function showChip(name, sizeText, spinning) {
    $('fileExt').textContent = (name.split('.').pop() || '').toUpperCase();
    $('fileName').textContent = name;
    $('fileSize').textContent = sizeText;
    $('fileSpin').hidden = !spinning;
    fileChip.hidden = false;
    drop.hidden = true;
  }
  function hideChip() {
    fileChip.hidden = true;
    drop.hidden = false;
    $('fileSpin').hidden = true;
  }

  function setFile(file) {
    clearError();
    drop.removeAttribute('aria-invalid');
    if (!file) return;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (RESUME_EXT.indexOf(ext) === -1) { showError('Upload a PDF, DOC or DOCX file'); fileInput.value = ''; return; }
    if (file.size > MAX_MB * 1024 * 1024) { showError('That file is ' + fmtSize(file.size) + '. The limit is ' + MAX_MB + ' MB.'); fileInput.value = ''; return; }
    if (mode !== 'api') {
      resumeFile = file;
      showChip(file.name, fmtSize(file.size), false);
      $('fileRemove').focus();
      return;
    }
    upload(file);
  }

  // Sends the file to the API, which stores it in S3.
  function upload(file) {
    var seq = ++uploadSeq;
    var previous = resumeInfo;
    showChip(file.name, 'Uploading…', true);
    setSaveState('Saving…');
    uploading = fetch(API + '/resume', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      body: file
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.message || 'HTTP ' + res.status); e.status = res.status; throw e; }
        return data;
      });
    })
      .then(function (r) {
        if (seq !== uploadSeq) return;
        uploading = null;
        resumeInfo = r.resume;
        showChip(r.resume.fileName, fmtSize(r.resume.sizeBytes) + ' · Uploaded', false);
        setSaveState('Saved');
        $('fileRemove').focus();
      })
      .catch(function (err) {
        if (seq !== uploadSeq) return;
        uploading = null;
        console.error(err);
        if (err.status === 401) { signedOut(); return; }
        resumeInfo = previous;
        if (previous) showChip(previous.fileName, fmtSize(previous.sizeBytes), false); else hideChip();
        fileInput.value = '';
        setSaveState('');
        showError('We couldn’t upload your resume. Try again.' + CONTACT_US);
      });
  }

  fileInput.addEventListener('change', function () { setFile(fileInput.files[0]); });
  $('fileRemove').addEventListener('click', function () {
    uploadSeq++;
    uploading = null;
    resumeFile = null; resumeInfo = null; fileInput.value = '';
    hideChip();
    setSaveState('');
    fileInput.focus();
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

  // ---------- Preview mode: keep progress in this browser only ----------
  var LOCAL_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'source', 'workAuth', 'workAuthOther'];
  function saveLocal() {
    if (mode !== 'preview') return;
    try {
      var data = { step: isQuestion(current) ? current : 0 };
      LOCAL_FIELDS.forEach(function (n) { data[n] = f[n].value; });
      data.ackProcess = f.ackProcess.checked;
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable: progress just isn't kept */ }
  }
  function restoreLocal() {
    var data;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { data = null; }
    if (!data) return 0;
    LOCAL_FIELDS.forEach(function (n) {
      var el = f[n];
      if (!el || data[n] == null) return;
      if (el instanceof RadioNodeList) Array.prototype.forEach.call(el, function (r) { r.checked = r.value === data[n]; });
      else el.value = data[n];
    });
    f.ackProcess.checked = !!data.ackProcess;
    $('workAuthOtherWrap').hidden = data.workAuth !== 'Other';
    // The resume file isn't kept, so never resume past the upload step.
    var s = Math.min(data.step || 0, idx('resume'));
    return s > 0 ? s : 0;
  }

  // ---------- Submit ----------
  function finish() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    progressFill.style.width = '100%';
    show(idx('done'), 'fwd');
  }

  function submit() {
    // Bots fill the hidden field; let them think it worked.
    if (f.company_website.value) { finish(); return; }
    setBusy(true);

    if (mode !== 'api') {
      console.info('[preview] Application (not sent):', Object.assign(currentAnswers(), {
        email: f.email.value.trim(),
        resume: resumeFile && { name: resumeFile.name, size: resumeFile.size }
      }));
      setTimeout(function () { setBusy(false); finish(); }, 600);
      return;
    }

    flush().then(function () { return api('POST', '/submit', {}); }).then(function (r) {
      appStatus = r.application.status;
      setBusy(false);
      setSaveState('');
      finish();
    }).catch(function (err) {
      setBusy(false);
      console.error(err);
      if (err.status === 401) return;
      showError(err.code === 'incomplete'
        ? 'Some answers are missing. Go back through the questions and try again.'
        : 'We couldn’t save your application. Check your connection and try again.' + CONTACT_US);
    });
  }

  // ---------- Start ----------
  function startPreview() {
    mode = 'preview';
    $('devNotice').hidden = false;
    show(restoreLocal(), 'fwd', false);
  }

  show(0, 'fwd', false);

  // A link from the "continue your application" email: ?resume=<token>#application
  var token = new URLSearchParams(location.search).get('resume');
  if (token) history.replaceState(null, '', location.pathname + '#application');
  var linkFailed = false;

  if (location.protocol === 'file:') {
    startPreview();
  } else {
    (token
      ? api('POST', '/auth/verify', { token: token }).catch(function (err) {
          if (err.status !== 400) throw err;
          linkFailed = true;
          return api('GET', '/application');
        })
      : api('GET', '/application')
    ).then(function (r) {
      mode = 'api';
      $('returningLink').hidden = false;
      applyState(r.application);
      show(resumeStep(r.application), 'fwd', !!token);
    }).catch(function (err) {
      if (err.status !== 401) { console.warn('Application API unavailable, running in preview mode.', err); startPreview(); return; }
      mode = 'api';
      $('returningLink').hidden = false;
      if (linkFailed) {
        show(idx('returning'), 'fwd');
        showError('That link has expired or was already used. Enter your email and we’ll send a new one.', $('returnError'));
      }
    });
  }

  // Opening the Application tab puts focus on the current question.
  document.addEventListener('tabchange', function (e) {
    if (e.detail !== 'application') return;
    var heading = steps[current].querySelector('.q-title');
    if (heading) heading.focus({ preventScroll: true });
  });
})();
