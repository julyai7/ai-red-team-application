(function () {
  'use strict';

  var CONFIG = window.APP_CONFIG || {};
  var MAX_MB = CONFIG.maxResumeMB || 10;
  var STORE_KEY = 'july-redteam-application-v1';
  var QUESTION_COUNT = 6;
  var SAMPLE_APP_URL = 'https://app.gojuly.ai/?invite_code=PGHFQGWA';
  var FINAL_LABEL = 'Save application & start sample submission';
  var OUT_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg>';

  var SOURCES = [
    'Referral', '80,000 Hours', 'Reddit', 'LinkedIn', 'Discord', 'ilovecreatives',
    'Web Forum', 'Make Writing Your Job', 'Substack', 'Fiverr', 'FreeUp', 'Freelancer',
    'Other Newsletter', 'ProBlogger', 'Flexjobs', 'Other'
  ];
  var RESUME_EXT = ['pdf', 'doc', 'docx'];

  var form = document.getElementById('form');
  var panel = document.getElementById('application');
  var progress = document.getElementById('progress');
  var steps = Array.prototype.slice.call(form.querySelectorAll('[data-step]'));
  var nav = document.getElementById('nav');
  var backBtn = document.getElementById('backBtn');
  var nextBtn = document.getElementById('nextBtn');
  var nextLabel = document.getElementById('nextLabel');
  var nextDisc = document.getElementById('nextDisc');
  var stepError = document.getElementById('stepError');
  var progressFill = document.getElementById('progressFill');
  var progressLabel = document.getElementById('progressLabel');
  var announce = document.getElementById('announce');
  var fileInput = document.getElementById('resume');
  var drop = document.getElementById('drop');
  var fileChip = document.getElementById('fileChip');

  var current = 0;
  var resumeFile = null;
  var submitting = false;
  var appOpened = false;

  if (!CONFIG.submitEndpoint) document.getElementById('devNotice').hidden = false;

  // ---------- Build the "how did you hear" choices ----------
  var CHECK = '<svg class="check" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';
  var sourceSet = form.querySelector('[data-group="source"]');
  sourceSet.innerHTML = SOURCES.map(function (label, i) {
    var id = 'src-' + i;
    return '<div class="choice"><input type="radio" name="source" id="' + id + '" value="' + label + '">' +
      '<label for="' + id + '"><span class="key">' + String.fromCharCode(65 + i) + '</span>' + label + CHECK + '</label></div>';
  }).join('');

  // ---------- Navigation ----------
  function stepName(i) { return steps[i].getAttribute('data-step'); }
  function isQuestion(i) { var n = stepName(i); return n !== 'welcome' && n !== 'done'; }

  function show(i, dir, focus) {
    steps.forEach(function (s, k) { s.hidden = k !== i; s.classList.remove('is-entering', 'is-back'); });
    var step = steps[i];
    void step.offsetWidth;
    step.classList.add('is-entering');
    if (dir === 'back') step.classList.add('is-back');
    current = i;
    progress.hidden = !isQuestion(i);
    // Remind applicants which email to sign up with on the July app.
    var email = form.elements.email.value.trim();
    step.querySelectorAll('[data-email-echo]').forEach(function (el) { el.textContent = email; });

    var q = isQuestion(i);
    nav.hidden = !q;
    clearError();
    if (q) {
      progressFill.style.width = (i / QUESTION_COUNT) * 100 + '%';
      progressLabel.textContent = i + ' of ' + QUESTION_COUNT;
      var last = i === QUESTION_COUNT;
      nextLabel.textContent = last ? FINAL_LABEL : 'Continue';
      nextDisc.innerHTML = last ? OUT_ICON : '';
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
    save();
  }

  function next() {
    if (submitting) return;
    if (isQuestion(current) && !validate(current)) return;
    if (current === QUESTION_COUNT) {
      // Open the July app inside the click/keypress itself so popup blockers allow it,
      // then save the application in the background.
      if (!appOpened) { window.open(SAMPLE_APP_URL, '_blank', 'noopener'); appOpened = true; }
      submit();
      return;
    }
    show(current + 1, 'fwd');
  }
  function back() { if (current > 0 && !submitting) show(current - 1, 'back'); }

  form.querySelectorAll('[data-next]').forEach(function (b) { b.addEventListener('click', next); });
  nextBtn.addEventListener('click', next);
  backBtn.addEventListener('click', back);
  form.addEventListener('submit', function (e) { e.preventDefault(); next(); });

  // ---------- Validation ----------
  function setFieldError(input, msg) {
    var err = document.getElementById(input.id + '-err');
    if (err) err.textContent = msg || '';
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }
  function showError(msg) {
    stepError.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.3"/><path d="M8 4.8v3.6M8 11h.01"/></svg>' + msg;
    stepError.hidden = false;
  }
  function clearError() { stepError.hidden = true; stepError.textContent = ''; }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function validate(i) {
    clearError();
    var step = steps[i];
    var name = stepName(i);
    var firstBad = null;

    if (name === 'contact') {
      [['firstName', 'Enter your first name'], ['lastName', 'Enter your last name']].forEach(function (p) {
        var el = form.elements[p[0]];
        var bad = !el.value.trim();
        setFieldError(el, bad ? p[1] : '');
        if (bad && !firstBad) firstBad = el;
      });
      var email = form.elements.email;
      var ev = email.value.trim();
      var emailMsg = !ev ? 'Enter your email' : (!EMAIL_RE.test(ev) ? 'That email doesn’t look right. Check for typos.' : '');
      setFieldError(email, emailMsg);
      if (emailMsg && !firstBad) firstBad = email;
      var phone = form.elements.phone;
      var digits = phone.value.replace(/\D/g, '');
      var phoneMsg = phone.value.trim() && (digits.length < 7 || digits.length > 15) ? 'Enter a full phone number, or leave it blank' : '';
      setFieldError(phone, phoneMsg);
      if (phoneMsg && !firstBad) firstBad = phone;
      if (firstBad) { firstBad.focus(); return false; }
      return true;
    }

    if (name === 'resume') {
      if (!resumeFile) { drop.setAttribute('aria-invalid', 'true'); showError('Upload your resume to continue'); return false; }
      return true;
    }

    var groups = step.querySelectorAll('[data-required][data-group]');
    for (var g = 0; g < groups.length; g++) {
      var gname = groups[g].getAttribute('data-group');
      var checked = form.querySelector('input[name="' + gname + '"]:checked');
      if (!checked) {
        var isBox = groups[g].querySelector('input[type="checkbox"]');
        showError(isBox ? 'Check the box to continue' : 'Choose an option to continue');
        return false;
      }
    }

    if (name === 'auth' && form.elements.workAuth.value === 'Other') {
      var other = form.elements.workAuthOther;
      var msg = other.value.trim() ? '' : 'Tell us about your work authorization';
      setFieldError(other, msg);
      if (msg) { other.focus(); return false; }
    }
    return true;
  }

  // Clear field errors as people fix them.
  form.addEventListener('input', function (e) {
    if (e.target.getAttribute('aria-invalid') === 'true') setFieldError(e.target, '');
    save();
  });

  // ---------- Choices ----------
  var advanceTimer = null;
  form.addEventListener('change', function (e) {
    var t = e.target;
    clearError();
    if (t.name === 'workAuth') {
      var isOther = t.value === 'Other';
      document.getElementById('workAuthOtherWrap').hidden = !isOther;
      if (isOther) { form.elements.workAuthOther.focus(); save(); return; }
    }
    save();
    // Single-choice questions move on by themselves, like the original form.
    if (current === QUESTION_COUNT) return;
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
      if (stepName(current) === 'done') return;
      e.preventDefault();
      next();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[a-z]$/i.test(e.key) && isQuestion(current)) {
      var idx = e.key.toUpperCase().charCodeAt(0) - 65;
      var inputs = steps[current].querySelectorAll('.choice input');
      if (inputs[idx]) {
        e.preventDefault();
        var inp = inputs[idx];
        if (inp.type === 'checkbox') inp.checked = !inp.checked; else inp.checked = true;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.focus({ preventScroll: true });
      }
    }
  });

  // ---------- Resume upload ----------
  function fmtSize(b) { return b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1024 / 1024).toFixed(1) + ' MB'; }

  function setFile(f) {
    clearError();
    drop.removeAttribute('aria-invalid');
    if (!f) return;
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    if (RESUME_EXT.indexOf(ext) === -1) { showError('Upload a PDF, DOC or DOCX file'); fileInput.value = ''; return; }
    if (f.size > MAX_MB * 1024 * 1024) { showError('That file is ' + fmtSize(f.size) + '. The limit is ' + MAX_MB + ' MB.'); fileInput.value = ''; return; }
    resumeFile = f;
    document.getElementById('fileExt').textContent = ext.toUpperCase();
    document.getElementById('fileName').textContent = f.name;
    document.getElementById('fileSize').textContent = fmtSize(f.size);
    fileChip.hidden = false;
    drop.hidden = true;
    document.getElementById('fileRemove').focus();
  }
  fileInput.addEventListener('change', function () { setFile(fileInput.files[0]); });
  document.getElementById('fileRemove').addEventListener('click', function () {
    resumeFile = null; fileInput.value = '';
    fileChip.hidden = true; drop.hidden = false;
    fileInput.focus();
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

  // ---------- Save progress in this browser (not the resume) ----------
  var SAVED_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'source', 'workAuth', 'workAuthOther'];
  function save() {
    try {
      var data = { step: stepName(current) === 'done' ? 0 : current };
      SAVED_FIELDS.forEach(function (n) { data[n] = form.elements[n].value; });
      data.ackProcess = form.elements.ackProcess.checked;
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable: progress just isn't kept */ }
  }
  function restore() {
    var data;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { data = null; }
    if (!data) return 0;
    SAVED_FIELDS.forEach(function (n) {
      var el = form.elements[n];
      if (!el || data[n] == null) return;
      if (el instanceof RadioNodeList) {
        Array.prototype.forEach.call(el, function (r) { r.checked = r.value === data[n]; });
      } else el.value = data[n];
    });
    form.elements.ackProcess.checked = !!data.ackProcess;
    document.getElementById('workAuthOtherWrap').hidden = data.workAuth !== 'Other';
    // The resume isn't saved, so never resume past the upload step.
    var resumeIdx = steps.findIndex(function (s) { return s.getAttribute('data-step') === 'resume'; });
    var s = Math.min(data.step || 0, resumeIdx);
    return s > 0 && s <= QUESTION_COUNT ? s : 0;
  }

  // ---------- Submit ----------
  function readBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  }

  function setBusy(on) {
    submitting = on;
    nextBtn.disabled = on;
    backBtn.disabled = on;
    nextLabel.textContent = on ? 'Saving…' : FINAL_LABEL;
    nextDisc.innerHTML = on ? '<span class="spinner" aria-hidden="true"></span>' : OUT_ICON;
  }

  function finish() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    progressFill.style.width = '100%';
    show(steps.length - 1, 'fwd');
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  function submit() {
    // Bots fill the hidden field; let them think it worked.
    if (form.elements.company_website.value) { finish(); return; }

    setBusy(true);
    readBase64(resumeFile).then(function (b64) {
      var f = form.elements;
      var payload = {
        firstName: f.firstName.value.trim(),
        lastName: f.lastName.value.trim(),
        email: f.email.value.trim(),
        phone: f.phone.value.trim(),
        source: f.source.value,
        workAuth: f.workAuth.value === 'Other' ? 'Other: ' + f.workAuthOther.value.trim() : f.workAuth.value,
        ackApplicationProcess: f.ackProcess.checked,
        ackSampleSteps: f.ackSteps.checked,
        status: 'Sample pending',
        resume: { name: resumeFile.name, type: resumeFile.type || 'application/octet-stream', size: resumeFile.size, data: b64 },
        submittedAt: new Date().toISOString(),
        page: location.href
      };

      if (!CONFIG.submitEndpoint) {
        var preview = JSON.parse(JSON.stringify(payload));
        preview.resume.data = '[' + b64.length + ' base64 chars]';
        console.info('[preview] Application payload (not sent):', preview);
        return new Promise(function (r) { setTimeout(r, 700); });
      }

      // text/plain keeps this a "simple" request, so there is no CORS preflight
      // (Apps Script web apps can't answer OPTIONS).
      return fetch(CONFIG.submitEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (json) {
        if (!json || !json.ok) throw new Error((json && json.error) || 'Submission was not accepted');
      });
    }).then(function () {
      setBusy(false);
      finish();
    }).catch(function (err) {
      console.error(err);
      setBusy(false);
      showError('We couldn’t save your application. Check your connection and try again. If it keeps failing, email <a href="mailto:info@gojuly.ai" style="color:inherit">info@gojuly.ai</a>.');
    });
  }

  // ---------- Start ----------
  show(restore(), 'fwd', false);
  // Opening the Application tab puts focus on the current question.
  document.addEventListener('tabchange', function (e) {
    if (e.detail !== 'application') return;
    var heading = steps[current].querySelector('.q-title');
    if (heading) heading.focus({ preventScroll: true });
  });
})();
