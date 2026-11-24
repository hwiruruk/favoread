/* 🗒️ 메모지 + 편집기 공용 "손 놓으면 저장" + 메모 보관 브랜치
 *
 *  EditorIdle  — 키보드·마우스 입력이 5분 동안 없으면 등록된 저장 함수를 부른다.
 *                쓰는 중에 커밋이 계속 쌓이지 않게, 손을 놓았을 때 한 번에 저장한다.
 *                저장 전 내용은 이 브라우저(localStorage)에 따로 보관해서 창이 닫혀도 안 날아간다.
 *  EditorNotes — 편집기 내부 메모를 사이트(main)가 아니라 notes/editor 브랜치에 저장한다.
 *                GitHub Pages 는 main 만 내보내므로 favorbook.co.kr 에는 안 나간다.
 *                (저장소가 공개라 GitHub 에서는 누구나 볼 수 있다 — 비밀은 적지 말 것)
 *  메모지       — 화면 위에 떠 있는 메모장. 편집하면서 옆에 띄워 둘 수 있다. data/editor_notes.md
 *
 * app.js 의 Gh·Config·LS·toast 를 쓰므로 app.js 뒤, submissions.js 앞에 불러온다. */
(function () {
  'use strict';

  /* ---------------- 손 놓으면 저장 ---------------- */
  const IDLE_MS = 5 * 60 * 1000;
  const Idle = {
    IDLE_MS,
    last: Date.now(),
    jobs: new Map(),   // 이름 → { isDirty(), save() }
    register(name, job) { this.jobs.set(name, job); },
    left() { return Math.max(0, IDLE_MS - (Date.now() - this.last)); },
    async runAll() {
      for (const job of this.jobs.values()) {
        try { if (job.isDirty()) await job.save(); } catch (e) { console.warn('[idle save]', e); }
      }
    },
  };
  const touch = () => { Idle.last = Date.now(); };
  let moveT = 0;
  ['keydown', 'input', 'pointerdown', 'wheel'].forEach(ev => document.addEventListener(ev, touch, true));
  document.addEventListener('pointermove', () => { const n = Date.now(); if (n - moveT > 2000) { moveT = n; touch(); } }, true);
  setInterval(() => {
    if (Date.now() - Idle.last >= IDLE_MS) Idle.runAll();
  }, 15000);
  // 탭을 닫거나 다른 탭으로 갈 때도 남은 걸 저장해 본다 (못 끝내도 localStorage 백업이 있다)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Idle.runAll(); });
  window.EditorIdle = Idle;

  /* ---------------- 메모 보관 브랜치 ---------------- */
  const Notes = {
    BRANCH: 'notes/editor',
    _ready: null,
    // 브랜치가 없으면 발행 브랜치 끝에서 딴다
    ensureBranch() {
      if (!this._ready) {
        this._ready = (async () => {
          if (await Gh.branchHead(this.BRANCH)) return;
          const head = await Gh.branchHead(Config.branch);
          if (!head) throw new Error('발행 브랜치를 찾지 못했어요');
          await Gh.createBranch(this.BRANCH, head);
        })().catch(e => { this._ready = null; throw e; });
      }
      return this._ready;
    },
    async get(path, { fallbackMain = false } = {}) {
      const r = await Gh.getFile(path, { ref: this.BRANCH, allowMissing: true }).catch(e => {
        if (/404/.test(e.message)) return { content: null, sha: null };
        throw e;
      });
      if (r.content == null && fallbackMain) {
        const m = await Gh.getFile(path, { allowMissing: true });
        return { content: m.content, sha: null, fromMain: !!m.content };
      }
      return r;
    },
    async put(path, content, sha, message) {
      await this.ensureBranch();
      return Gh.putFile({ content, sha, path, message, branch: this.BRANCH });
    },
  };
  window.EditorNotes = Notes;

  /* ---------------- 메모지 ---------------- */
  const PATH = 'data/editor_notes.md';
  const BK = 'favoread.notepadBackup';   // 저장 전 내용 { text, base, at }
  const UI = 'favoread.notepadUi';       // 위치·크기·열림
  const P = { loaded: false, sha: null, saved: '', dirty: false, saving: null };
  const box = document.getElementById('notepad');
  const ta = document.getElementById('notepadText');
  const st = document.getElementById('notepadState');

  const readJson = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const writeJson = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 꽉 참 등 */ } };
  const hm = (d = new Date()) => d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  function showState() {
    if (P.saving) { st.textContent = '저장 중…'; st.className = 'np-state'; return; }
    if (P.dirty) {
      const m = Math.ceil(Idle.left() / 60000);
      st.textContent = `저장 안 됨 · 손 놓고 ${m}분 뒤 자동 저장`;
      st.className = 'np-state unsaved';
    }
  }
  setInterval(() => { if (!box.classList.contains('hidden')) showState(); }, 15000);

  async function load() {
    st.textContent = '불러오는 중…';
    try {
      const { content, sha } = await Notes.get(PATH);
      P.sha = sha;
      P.saved = content || '';
      ta.value = P.saved;
      P.loaded = true;
      P.dirty = false;
      st.textContent = sha ? '불러옴' : '새 메모지 (저장하면 만들어져요)';
      st.className = 'np-state';
      // 저장 못 하고 닫았던 내용 되살리기
      const bk = readJson(BK);
      if (bk && bk.text !== P.saved) {
        // 저장본 위에 이어 쓴 것이면 그대로, 그새 다른 곳에서 바뀌었으면 아래에 붙인다
        if (bk.base === P.sha || bk.text.startsWith(P.saved)) ta.value = bk.text;
        else ta.value = P.saved + (P.saved && !P.saved.endsWith('\n') ? '\n' : '') +
          `\n──── 저장 안 된 이 브라우저 메모 (${new Date(bk.at).toLocaleString('ko-KR')}) ────\n${bk.text}\n`;
        P.dirty = true;
        showState();
        toast('저장 안 된 메모지 내용을 되살렸어요', 'ok');
      }
    } catch (err) {
      st.textContent = '';
      toast('메모지 불러오기 실패: ' + err.message, 'err');
    }
  }

  async function save() {
    if (!P.loaded || P.saving) return P.saving;
    const text = ta.value;
    if (text === P.saved) { P.dirty = false; writeJson(BK, null); st.textContent = `저장됨 · ${hm()}`; return; }
    P.saving = (async () => {
      showState();
      try {
        let stored = text;
        try {
          const r = await Notes.put(PATH, text, P.sha, `메모지 저장 (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`);
          P.sha = r.sha;
        } catch (err) {
          if (!err.conflict && !/변경/.test(err.message)) throw err;
          // 다른 컴퓨터에서 먼저 저장했다 — 두 내용을 합쳐서 다시 저장
          const remote = await Notes.get(PATH);
          stored = remote.content === text ? text
            : `${remote.content || ''}${(remote.content || '').endsWith('\n') ? '' : '\n'}\n──── 이 컴퓨터에서 쓴 내용 (${new Date().toLocaleString('ko-KR')}) ────\n${text}\n`;
          const r = await Notes.put(PATH, stored, remote.sha, '메모지 저장 (다른 곳 내용과 합침)');
          P.sha = r.sha;
          if (stored !== text) {
            // 합친 걸 보여 주되, 저장하는 사이 더 쓴 줄이 있으면 뒤에 붙여 둔다
            const extra = ta.value.startsWith(text) ? ta.value.slice(text.length) : '';
            ta.value = stored + extra;
            toast('다른 곳에서 바뀐 메모지와 합쳤어요 — 확인해 주세요', 'err');
          }
        }
        // 저장하는 동안 더 쓴 게 있으면 그건 다음 저장 몫
        P.saved = stored;
        P.dirty = ta.value !== P.saved;
        writeJson(BK, P.dirty ? { text: ta.value, base: P.sha, at: Date.now() } : null);
        st.textContent = `저장됨 · ${hm()}`;
        st.className = 'np-state';
      } catch (err) {
        st.textContent = '저장 실패 — 이 브라우저에는 보관돼 있어요';
        st.className = 'np-state unsaved';
        toast('메모지 저장 실패: ' + err.message, 'err');
      } finally {
        P.saving = null;
      }
    })();
    return P.saving;
  }

  ta.addEventListener('input', () => {
    P.dirty = ta.value !== P.saved;
    writeJson(BK, P.dirty ? { text: ta.value, base: P.sha, at: Date.now() } : null);
    if (P.dirty) showState(); else st.textContent = '저장됨';
  });
  // Ctrl+S — 메모지 안에서는 메모지를 저장 (편집기 드래프트 저장으로 안 넘어가게)
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault(); e.stopPropagation();
      save();
    }
  });
  Idle.register('notepad', { isDirty: () => P.loaded && P.dirty, save });
  window.addEventListener('beforeunload', (e) => { if (P.loaded && P.dirty) { save(); e.preventDefault(); e.returnValue = ''; } });

  /* 열기·닫기·위치 */
  function saveUi() {
    const r = box.getBoundingClientRect();
    writeJson(UI, { open: !box.classList.contains('hidden'), x: r.left, y: r.top, w: box.offsetWidth, h: box.offsetHeight });
  }
  function placeUi() {
    const u = readJson(UI);
    if (!u) return;
    if (u.w) box.style.width = Math.min(u.w, window.innerWidth - 16) + 'px';
    if (u.h) box.style.height = Math.min(u.h, window.innerHeight - 16) + 'px';
    if (u.x != null) {
      box.style.left = Math.max(8, Math.min(u.x, window.innerWidth - 120)) + 'px';
      box.style.top = Math.max(8, Math.min(u.y, window.innerHeight - 60)) + 'px';
      box.style.right = 'auto'; box.style.bottom = 'auto';
    }
  }
  async function open() {
    if (!Config.token) { toast('GitHub Token을 먼저 설정하세요', 'err'); settingsDlg.showModal(); return; }
    box.classList.remove('hidden');
    placeUi();
    saveUi();
    if (!P.loaded) await load();
    ta.focus();
  }
  function close() {
    box.classList.add('hidden');
    saveUi();
    if (P.dirty) save();
  }
  document.getElementById('notepadBtn').addEventListener('click', () => {
    if (box.classList.contains('hidden')) open(); else close();
  });
  document.getElementById('notepadClose').addEventListener('click', close);
  document.getElementById('notepadSave').addEventListener('click', () => save());
  document.getElementById('notepadDate').addEventListener('click', () => {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const line = `── ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm(d)} ──\n`;
    const at = ta.selectionStart;
    const pre = ta.value.slice(0, at);
    const ins = (pre && !pre.endsWith('\n') ? '\n' : '') + line;
    ta.setRangeText(ins, at, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  });

  // 머리 줄을 끌어 옮긴다
  const head = box.querySelector('.np-head');
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = box.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      box.style.left = Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - 80)) + 'px';
      box.style.top = Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - 40)) + 'px';
      box.style.right = 'auto'; box.style.bottom = 'auto';
    };
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); saveUi(); };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });
  // 크기를 바꾸면 기억
  if (window.ResizeObserver) {
    let t = null;
    new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!box.classList.contains('hidden')) saveUi(); }, 400); }).observe(box);
  }
  // 지난번에 열어 둔 채로 나갔으면 다시 띄운다 (토큰이 있을 때)
  if ((readJson(UI) || {}).open && Config.token) open();
})();
