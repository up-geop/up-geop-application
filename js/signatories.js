import {
  getSignatories,
  getAllMembersList,
  selectTaskForSignatory,
  updateSignatoryAnswer,
  generateApplicantShortCode,
  getAvailableTasksPool,
  getCommitteeDirectory,
  getMemberSignatureCounts,
  getGlobalSettings,
  getCurrentUserId
} from './storage.js';
import { getUserProfileData } from './auth.js';
import { showToast, startQrCodeCountdown } from './app.js';

let activeCategory = 'ALL';
let activeStatusFilter = 'ALL'; // 'ALL' | 'PENDING' | 'COMPLETED'
let activeSearchQuery = '';
let delegatedBoundContainer = null;
const inputDebounceTimers = new Map();

function cleanTraitText(text) {
  if (!text) return '';
  const cleaned = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^find\s+(an?|the|another|other)?\s*(member|person|someone)?\s*(who|na|that)?\s*/i, '')
    .replace(/^(another|other)?\s*member\s*(who|na|that)?\s*/i, '')
    .replace(/^(who|na|that)\s+/i, '')
    .trim();

  if (cleaned.length === 0) return text;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// Combined Filter: Committee Category + Pending/Completed Status + Search Term
function applySignatoryFilters(container) {
  const query = activeSearchQuery.toLowerCase().trim();

  container.querySelectorAll('.sig-item-card').forEach(card => {
    const isCompleted = card.dataset.completed === 'true';
    const matchesStatus =
      activeStatusFilter === 'ALL' ||
      (activeStatusFilter === 'PENDING' && !isCompleted) ||
      (activeStatusFilter === 'COMPLETED' && isCompleted);

    const searchableText = (card.dataset.search || '').toLowerCase();
    const matchesSearch = !query || searchableText.includes(query);

    card.style.display = (matchesStatus && matchesSearch) ? 'block' : 'none';
  });

  container.querySelectorAll('.committee-card').forEach(commCard => {
    const matchesCategory =
      activeCategory === 'ALL' ||
      commCard.dataset.committee.toLowerCase() === activeCategory.toLowerCase();

    const visibleChildren = commCard.querySelectorAll('.sig-item-card:not([style*="display: none"])').length;
    const hasFilterActive = activeStatusFilter !== 'ALL' || query.length > 0;

    if (!matchesCategory || (hasFilterActive && visibleChildren === 0)) {
      commCard.style.display = 'none';
    } else {
      commCard.style.display = 'block';
    }
  });
}

// Auto-Save Indicator Helper (Plain "Saved" text)
function flashSavedIndicator(sigId) {
  const el = document.querySelector(`.sig-save-status[data-sig-id="${sigId}"]`);
  if (!el) return;
  el.textContent = 'Saved';
  el.style.opacity = '1';
  if (el._hideTimer) clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.style.opacity = '0';
  }, 2000);
}

/* =========================================================
   PRINTABLE BIYAHE SIGNATORY SLAMBOOK PDF
   ========================================================= */
async function exportApplicantSlambookPdf() {
  const win = window.open('', '_blank');
  if (!win) {
    showToast('Popup blocked. Please allow popups to export your Slambook.', 'error');
    return;
  }

  win.document.write('<h3 style="font-family: sans-serif; color: #C1272D;">Generating your AO Biyahe Signatory Slambook...</h3>');

  const uid = await getCurrentUserId();
  const [signatories, profile, directory] = await Promise.all([
    getSignatories(uid),
    getUserProfileData(uid),
    getCommitteeDirectory()
  ]);

  const completedCount = signatories.filter(s => s.completed).length;
  const pesList = signatories.filter(s => s.role === 'PES' || s.type === 'PES' || (s.committee_name || '').toUpperCase() === 'PES');
  const oaList = signatories.filter(s => ['O.A', 'ALUMNI', 'OTHER MEMBER'].includes((s.committee_name || '').toUpperCase()) || ['O.A', 'ALUMNI', 'OTHER MEMBER'].includes((s.role || '').toUpperCase()));
  const regularList = signatories.filter(s => !pesList.includes(s) && !oaList.includes(s));

  const formatCardRow = (s) => {
    const isVP = s.role === 'VP' || s.type === 'VP';
    const dirMatch = directory.find(d => d.role_type === 'VP' && (d.committee_name || '').toLowerCase() === (s.committee_name || '').toLowerCase());
    const signer = s.signed_by || s.member_name || (isVP && dirMatch ? dirMatch.full_name : 'Unsigned');
    return `
      <div class="slam-card ${s.completed ? 'signed' : 'pending'}">
        <div class="slam-header">
          <span class="tag">${s.committee_name || s.role} • ${isVP ? 'VP Endorsement' : 'Member'}</span>
          <span class="status">${s.completed ? `Signed by ${signer}` : 'Pending'}</span>
        </div>
        <div class="trait">${cleanTraitText(s.trait || s.task)}</div>
        ${s.selected_task ? `<div class="meta"><strong>Task Completed:</strong> ${s.selected_task}</div>` : ''}
        <div class="grid">
          <div><strong>Member Name:</strong> ${signer}</div>
          <div><strong>Nickname:</strong> ${s.nickname || '—'}</div>
          <div><strong>Favorite GEOP Tradition:</strong> ${s.favorite_tradition || '—'}</div>
          <div><strong>Top Field Role:</strong> ${s.top_field_role || '—'}</div>
          <div style="grid-column: 1 / -1;"><strong>Unique Fact:</strong> ${s.unique_fact || '—'}</div>
        </div>
      </div>
    `;
  };

  win.document.open();
  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>AO Biyahe Signatory Slambook - ${profile?.full_name || 'Applicant'}</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; padding: 28px; color: #2B2B2B; background: #F4F1EB; }
          .banner { background: #111111; color: #F4F1EB; padding: 20px 24px; border-bottom: 5px solid #C1272D; border-radius: 10px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
          .banner h1 { margin: 0 0 4px 0; color: #F4F1EB; font-size: 1.5rem; }
          .banner p { margin: 0; color: #FBB03B; font-weight: 700; }
          h2 { color: #C1272D; border-bottom: 2px solid #C4B9A3; padding-bottom: 6px; margin-top: 24px; }
          .slam-card { background: #FFFFFF; border: 1px solid #DCD4C5; border-left: 5px solid #C4B9A3; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; page-break-inside: avoid; }
          .slam-card.signed { border-left-color: #C1272D; }
          .slam-header { display: flex; justify-content: space-between; font-size: 0.78rem; color: #666; margin-bottom: 4px; font-weight: 600; text-transform: uppercase; }
          .trait { font-size: 1rem; font-weight: 700; color: #C1272D; margin-bottom: 6px; }
          .meta { font-size: 0.82rem; margin-bottom: 6px; color: #444; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; font-size: 0.82rem; background: #F9F7F3; padding: 8px 10px; border-radius: 6px; }
          @media print { body { background: #fff; padding: 0; } }
        </style>
      </head>
      <body>
        <div class="banner">
          <div>
            <h1>UP GEOP Applicant Signatory Slambook</h1>
            <p>AO Biyahe — "Kasya pa, sakay na!"</p>
          </div>
          <div style="text-align: right; font-size: 0.85rem;">
            <div><strong>${profile?.full_name || ''}</strong> (${profile?.nickname || ''})</div>
            <div>Buddy Group: ${profile?.buddy_group_name || 'Unassigned'}</div>
            <div style="color: #FBB03B; font-weight: 700;">${completedCount} / ${signatories.length} Signed</div>
          </div>
        </div>

        <h2>PES</h2>
        ${pesList.map(s => formatCardRow(s)).join('')}

        <h2>Committee & VP Signatories</h2>
        ${regularList.map(s => formatCardRow(s)).join('')}

        ${oaList.length > 0 ? `
          <h2>O.A & Alumni Memories</h2>
          ${oaList.map(s => `
            <div class="slam-card ${s.completed ? 'signed' : 'pending'}">
              <div class="slam-header">
                <span>${s.task || 'O.A Signature'}</span>
                <span>${s.completed ? `Signed by ${s.signed_by || s.member_name}` : 'Pending'}</span>
              </div>
              <div class="trait">${cleanTraitText(s.trait || s.task)}</div>
              <div class="grid">
                <div><strong>Name:</strong> ${s.member_name || '—'}</div>
                <div><strong>GEOP Batch:</strong> ${s.geop_batch || '—'}</div>
                <div style="grid-column: 1 / -1;"><strong>Favorite Flagship Event:</strong> ${s.favorite_flagship_event || '—'}</div>
                <div style="grid-column: 1 / -1;"><strong>Favorite GEOP Memory:</strong> ${s.favorite_geop_memory || '—'}</div>
              </div>
            </div>
          `).join('')}
        ` : ''}

        <script>window.onload = function() { window.print(); }<\/script>
      </body>
    </html>
  `);
  win.document.close();
}

function attachSignatoryDelegation(container) {
  if (delegatedBoundContainer === container) return;
  delegatedBoundContainer = container;

  // Live typing auto-save (debounced 600ms) + Search Input handler
  container.addEventListener('input', (e) => {
    if (e.target.id === 'signatorySearchInput') {
      activeSearchQuery = e.target.value;
      applySignatoryFilters(container);
      return;
    }

    const sigInput = e.target.closest('.sig-input');
    if (!sigInput || sigInput.tagName === 'SELECT') return;
    const sigId = sigInput.dataset.sigId;
    const field = sigInput.dataset.field;
    if (!sigId || !field) return;

    const key = `${sigId}-${field}`;
    if (inputDebounceTimers.has(key)) clearTimeout(inputDebounceTimers.get(key));
    inputDebounceTimers.set(key, setTimeout(async () => {
      inputDebounceTimers.delete(key);
      const ok = await updateSignatoryAnswer(sigId, field, sigInput.value.trim());
      if (ok) flashSavedIndicator(sigId);
    }, 600));
  });

  // Single delegated click listener for filters, slambook export, resets, and QR code generation
  container.addEventListener('click', async (e) => {
    if (e.target.closest('#exportSlambookPdfBtn')) {
      await exportApplicantSlambookPdf();
      return;
    }

    const statusBtn = e.target.closest('.sig-status-filter-btn');
    if (statusBtn) {
      activeStatusFilter = statusBtn.dataset.status;
      container.querySelectorAll('.sig-status-filter-btn').forEach(b => {
        b.classList.remove('btn-checkin');
        b.classList.add('btn-secondary');
      });
      statusBtn.classList.remove('btn-secondary');
      statusBtn.classList.add('btn-checkin');
      applySignatoryFilters(container);
      return;
    }

    const filterBtn = e.target.closest('.committee-filter-btn');
    if (filterBtn) {
      activeCategory = filterBtn.dataset.category;
      container.querySelectorAll('.committee-filter-btn').forEach(b => {
        b.classList.remove('btn-checkin');
        b.classList.add('btn-secondary');
      });
      filterBtn.classList.remove('btn-secondary');
      filterBtn.classList.add('btn-checkin');
      applySignatoryFilters(container);
      return;
    }

    const clearBtn = e.target.closest('.clear-task-btn');
    if (clearBtn) {
      const sigId = clearBtn.dataset.sigId;
      if (sigId) {
        await selectTaskForSignatory(sigId, null);
        showToast('Task selection cleared.', 'info');
        await renderSignatoriesTab(container);
      }
      return;
    }

    const codeBtn = e.target.closest('.trigger-sig-code-btn');
    if (codeBtn) {
      const sigId = codeBtn.dataset.sigId;
      if (!sigId || sigId === 'null') {
        showToast('Signatory record not initialized.', 'error');
        return;
      }

      // Flush any inputs on this card immediately before generating the code
      const parentCard = codeBtn.closest('.sig-item-card') || codeBtn.closest('.card');
      if (parentCard) {
        const inputs = Array.from(parentCard.querySelectorAll('.sig-input'));
        await Promise.all(inputs.map(inp => {
          const field = inp.dataset.field;
          const key = `${sigId}-${field}`;
          if (inputDebounceTimers.has(key)) {
            clearTimeout(inputDebounceTimers.get(key));
            inputDebounceTimers.delete(key);
          }
          return field ? updateSignatoryAnswer(sigId, field, inp.value.trim()) : Promise.resolve();
        }));
        flashSavedIndicator(sigId);
      }

      const code = await generateApplicantShortCode(sigId, 'SIGNATORY');
      if (!code) {
        showToast('Failed to generate verification code.', 'error');
        return;
      }

      const qrModal = document.getElementById('qrDisplayContainer');
      const textElem = document.getElementById('applicantShortCodeText');
      const canvasElem = document.getElementById('qrcodeCanvas');

      if (textElem) textElem.textContent = code;
      const verifyUrl = `${window.location.origin}${window.location.pathname}?verifyCode=${code}`;

      if (canvasElem) {
        canvasElem.innerHTML = `
          <div style="margin-bottom: 8px;">
            <span class="badge" style="background: var(--brand-forest); color: #ffffff;">Signatory Code</span>
          </div>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(verifyUrl)}" 
               alt="Signatory QR" width="160" height="160" style="border-radius: 6px;" />
        `;
      }

      startQrCodeCountdown('SIGNATORY', sigId);

      if (qrModal) {
        qrModal.style.display = 'block';
        const tambayTabBtn = document.querySelector('#applicantTabNav [data-tab="tab-tambay"]');
        if (tambayTabBtn) tambayTabBtn.click();
        qrModal.scrollIntoView({ behavior: 'smooth' });
      }

      showToast(`Verification code generated: ${code}`, 'success');
    }
  });

  // Single delegated change listener for task pool selects & text inputs
  container.addEventListener('change', async (e) => {
    const taskSelect = e.target.closest('.sig-task-select');
    if (taskSelect) {
      const val = taskSelect.value;
      const sigId = taskSelect.dataset.sigId;
      if (sigId) {
        await selectTaskForSignatory(sigId, val || null);
        showToast(val ? 'Task selected.' : 'Task reset.', 'info');
        await renderSignatoriesTab(container);
      }
      return;
    }

    const sigInput = e.target.closest('.sig-input');
    if (sigInput) {
      const sigId = sigInput.dataset.sigId;
      const field = sigInput.dataset.field;
      const val = sigInput.value.trim();
      if (sigId && field) {
        const key = `${sigId}-${field}`;
        if (inputDebounceTimers.has(key)) {
          clearTimeout(inputDebounceTimers.get(key));
          inputDebounceTimers.delete(key);
        }
        const ok = await updateSignatoryAnswer(sigId, field, val);
        if (ok) flashSavedIndicator(sigId);
      }
    }
  });
}

export async function renderSignatoriesTab(container) {
  if (!container) return;
  attachSignatoryDelegation(container);

  const [signatories, membersList, fallbackTasksPool, directory, sigCounts, settings] = await Promise.all([
    getSignatories(),
    getAllMembersList(),
    getAvailableTasksPool(),
    getCommitteeDirectory(),
    getMemberSignatureCounts(),
    getGlobalSettings()
  ]);

  const sigLimitEnabled = settings.memberSigLimitEnabled;

  const PES_LIST = directory.filter(d => d.role_type === 'PES').map(p => ({
    roleKey: p.role_key,
    title: p.title,
    fullName: p.full_name,
    email: p.email,
    photo: p.photo_url
  }));

  const COMMITTEES_LIST = directory.filter(d => d.role_type === 'VP').map(c => ({
    name: c.committee_name,
    vpTitle: c.title,
    vp: c.full_name,
    vpEmail: c.email,
    photo: c.photo_url
  }));

  const total = signatories.length || 21;
  const completed = signatories.filter(s => s.completed).length;

  const pesTasks = signatories.filter(s => 
    s.role === 'PES' || s.type === 'PES' || (s.committee_name || '').toUpperCase() === 'PES'
  );
  const committeeTasks = signatories.filter(s => !pesTasks.includes(s));

  const allCommitteesCompleted = committeeTasks.length > 0 && committeeTasks.every(s => s.completed);

  const oaTasks = committeeTasks.filter(s =>
    ['O.A', 'ALUMNI', 'OTHER MEMBER'].includes((s.committee_name || '').toUpperCase()) ||
    ['O.A', 'ALUMNI', 'OTHER MEMBER'].includes((s.role || '').toUpperCase())
  );

  const completedTasksSet = new Set(
    signatories
      .filter(s => s.completed && s.selected_task)
      .map(s => s.selected_task.trim())
  );

  const categories = [
    { label: `All (${committeeTasks.length})`, value: 'ALL' },
    { label: 'Academics', value: 'Academics' },
    { label: 'Publicity', value: 'Publicity' },
    { label: 'RAComm', value: 'RAComm' },
    { label: 'Internal', value: 'Internal' },
    { label: 'External', value: 'External' },
    { label: 'Finance', value: 'Finance' },
    { label: 'O.A', value: 'O.A' }
  ];

  const pesHtml = PES_LIST.map(pes => {
    const task = pesTasks.find(s => 
      (s.member_name || '').toLowerCase() === pes.fullName.toLowerCase() ||
      (s.task || '').toLowerCase() === pes.title.toLowerCase()
    ) || { id: null, completed: false, nickname: '', favorite_tradition: '', top_field_role: '', unique_fact: '', signed_by: null };

    const isCompleted = !!task.completed;
    const isUnlocked = allCommitteesCompleted;
    const disabledAttr = (!isUnlocked || !task.id) ? 'disabled' : '';
    const btnDisabledAttr = (!isUnlocked || !task.id) ? 'disabled style="opacity: 0.55; cursor: not-allowed;"' : '';

    const contentHtml = !isCompleted ? `
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 10px;">
        <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="nickname" placeholder="Nickname" value="${task.nickname || ''}" ${disabledAttr} style="font-size: 0.8rem; padding: 6px;" />
        <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="favorite_tradition" placeholder="Favorite Tradition" value="${task.favorite_tradition || ''}" ${disabledAttr} style="font-size: 0.8rem; padding: 6px;" />
        <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="top_field_role" placeholder="Top Field Role" value="${task.top_field_role || ''}" ${disabledAttr} style="font-size: 0.8rem; padding: 6px;" />
        <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="unique_fact" placeholder="Unique Fact" value="${task.unique_fact || ''}" ${disabledAttr} style="font-size: 0.8rem; padding: 6px;" />
      </div>
      <button class="btn btn-checkin trigger-sig-code-btn" data-sig-id="${task.id}" ${btnDisabledAttr} style="width: 100%; min-height: 38px;">
        ${isUnlocked ? 'Generate Verification Code' : 'Unlock After All Committees'}
      </button>
    ` : `<div class="sig-endorsement-stamp">Signed by kasama <strong>${task.signed_by || pes.fullName}</strong></div>`;

    const searchBlob = `${pes.title} ${pes.fullName} ${pes.email} ${task.signed_by || ''} PES`.replace(/"/g, '');

    return `
      <div class="sig-item-card pes-tile ${isCompleted ? 'is-completed' : ''}" data-completed="${isCompleted ? 'true' : 'false'}" data-search="${searchBlob}">
        <div class="pes-tile-top">
          <span class="pes-role-badge">${pes.title}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="sig-save-status" data-sig-id="${task.id}" style="font-size: 0.72rem; color: var(--text-muted); opacity: 0; transition: opacity 0.25s ease;"></span>
            <span class="sig-status-indicator ${isCompleted ? 'status-done' : (isUnlocked ? 'status-open' : 'status-locked')}">
              ${isCompleted ? '✓ Signed' : (isUnlocked ? 'Unlocked' : 'Locked')}
            </span>
          </div>
        </div>
        <div class="pes-tile-identity">
          <img src="${pes.photo}" alt="${pes.fullName}" loading="lazy" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(pes.fullName)}&background=1b382b&color=fff';" class="pes-avatar" />
          <div style="min-width: 0;">
            <strong class="pes-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${pes.fullName}</strong>
            <span class="pes-email" style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${pes.email}</span>
          </div>
        </div>
        <div class="pes-tile-body">
          ${contentHtml}
        </div>
      </div>
    `;
  }).join('');

  const committeesHtml = COMMITTEES_LIST.map(comm => {
    const commSigs = committeeTasks.filter(s => (s.committee_name || '').toLowerCase() === comm.name.toLowerCase());
    const vpTask = commSigs.find(s => s.role === 'VP' || s.type === 'VP');
    const memberTasks = commSigs.filter(s => s !== vpTask);
    const membersDone = memberTasks.length > 0 && memberTasks.every(s => s.completed);

    let vpTaskHtml = '';
    if (vpTask) {
      const disabledAttr = !membersDone ? 'disabled' : '';
      const btnDisabledAttr = !membersDone ? 'disabled style="opacity: 0.6; cursor: not-allowed;"' : '';

      const vpContentHtml = !vpTask.completed ? `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 10px;">
          <input type="text" class="sig-input" data-sig-id="${vpTask.id}" data-field="nickname" placeholder="Nickname" value="${vpTask.nickname || ''}" ${disabledAttr} style="font-size: 0.8rem; padding: 6px;" />
          <input type="text" class="sig-input" data-sig-id="${vpTask.id}" data-field="favorite_tradition" placeholder="Favorite Tradition" value="${vpTask.favorite_tradition || ''}" ${disabledAttr} style="font-size: 0.8rem; padding: 6px;" />
          <input type="text" class="sig-input" data-sig-id="${vpTask.id}" data-field="top_field_role" placeholder="Top Field Role" value="${vpTask.top_field_role || ''}" ${disabledAttr} style="font-size: 0.8rem; padding: 6px;" />
          <input type="text" class="sig-input" data-sig-id="${vpTask.id}" data-field="unique_fact" placeholder="Unique Fact" value="${vpTask.unique_fact || ''}" ${disabledAttr} style="font-size: 0.8rem; padding: 6px;" />
        </div>
        <button class="btn btn-checkin trigger-sig-code-btn" data-sig-id="${vpTask.id}" ${btnDisabledAttr} style="width: 100%; min-height: 38px;">
          ${membersDone ? 'Generate Verification Code' : 'Complete Member Tasks to Unlock'}
        </button>
      ` : `<div class="sig-endorsement-stamp">Signed by kasama <strong>${vpTask.signed_by || comm.vp}</strong></div>`;

      const vpSearchBlob = `${comm.name} ${comm.vp} ${comm.vpTitle} ${comm.vpEmail} VP`.replace(/"/g, '');

      vpTaskHtml = `
        <div class="sig-item-card sig-vp-waypoint ${vpTask.completed ? 'is-completed' : ''}" data-completed="${vpTask.completed ? 'true' : 'false'}" data-search="${vpSearchBlob}" style="margin-bottom: 14px;">
          <div class="sig-waypoint-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <img src="${comm.photo}" alt="${comm.vp}" loading="lazy" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(comm.vp)}&background=1b382b&color=fff';" class="vp-avatar" />
              <div>
                <span class="pes-role-badge">VP Check-in • ${comm.vpTitle}</span>
                <strong class="vp-name">${comm.vp}</strong>
                <span class="vp-email">${comm.vpEmail}</span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="sig-save-status" data-sig-id="${vpTask.id}" style="font-size: 0.72rem; color: var(--text-muted); opacity: 0; transition: opacity 0.25s ease;"></span>
              <span class="sig-status-indicator ${vpTask.completed ? 'status-done' : (membersDone ? 'status-open' : 'status-locked')}">
                ${vpTask.completed ? '✓ Signed' : (membersDone ? 'Ready for VP' : 'Locked')}
              </span>
            </div>
          </div>
          <div style="margin-top: 10px;">
            ${vpContentHtml}
          </div>
        </div>
      `;
    }

    const membersHtml = memberTasks.map((task, idx) => {
      const rawTrait = task.trait || task.trait_description || task.task || 'Committee Member';
      const cleanedTrait = cleanTraitText(rawTrait);
      const rawPool = (task.task_pool && task.task_pool.length > 0) ? task.task_pool : fallbackTasksPool;
      const pool = rawPool.filter(t => {
        if (task.selected_task && t === task.selected_task) return true;
        return !completedTasksSet.has(t.trim());
      });

      let poolDropdownHtml = '';
      if (!task.completed && pool.length > 0) {
        const options = pool.map(t => `<option value="${t}" ${task.selected_task === t ? 'selected' : ''}>${t}</option>`).join('');
        const resetBtn = task.selected_task ? `<button type="button" class="clear-task-btn" data-sig-id="${task.id}" style="background: none; border: none; color: var(--brand-forest); font-size: 0.75rem; cursor: pointer; text-decoration: underline;">Reset</button>` : '';
        poolDropdownHtml = `
          <div style="margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted);">${task.selected_task ? 'Selected Task:' : 'Assign a Task:'}</label>
              ${resetBtn}
            </div>
            <select class="sig-task-select" data-sig-id="${task.id}" style="width: 100%; font-size: 0.82rem; padding: 6px;">
              <option value="">-- Choose a task from pool --</option>
              ${options}
            </select>
          </div>
        `;
      } else if (task.completed) {
        poolDropdownHtml = `
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 8px;">
            <strong>Task:</strong> ${task.selected_task || task.task}
          </div>
        `;
      }

      let taskContentHtml = '';
      if (!task.completed) {
        const membersOptions = membersList.map(m => {
          const used = sigCounts[m.full_name] || 0;
          const remaining = Math.max(0, 4 - used);
          const isFull = sigLimitEnabled && remaining === 0;
          const isSelected = task.member_name === m.full_name;
          const quotaText = sigLimitEnabled
            ? (isFull ? ' (FULL - 4/4)' : ` (${remaining}/4 left)`)
            : ` (${used} signed)`;
          const disabledOpt = (isFull && !isSelected) ? 'disabled' : '';
          return `<option value="${m.full_name}" ${isSelected ? 'selected' : ''} ${disabledOpt}>${m.full_name}${quotaText}</option>`;
        }).join('');

        taskContentHtml = `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 10px;">
            <select class="sig-input" data-sig-id="${task.id}" data-field="member_name" style="font-size: 0.8rem; padding: 6px;">
              <option value="">-- Select Member --</option>
              ${membersOptions}
            </select>
            <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="nickname" placeholder="Nickname" value="${task.nickname || ''}" style="font-size: 0.8rem; padding: 6px;" />
            <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="favorite_tradition" placeholder="Favorite Tradition" value="${task.favorite_tradition || ''}" style="font-size: 0.8rem; padding: 6px;" />
            <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="top_field_role" placeholder="Top Field Role" value="${task.top_field_role || ''}" style="font-size: 0.8rem; padding: 6px;" />
            <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="unique_fact" placeholder="Unique Fact" value="${task.unique_fact || ''}" style="font-size: 0.8rem; padding: 6px;" />
          </div>
          <button class="btn btn-checkin trigger-sig-code-btn" data-sig-id="${task.id}" style="width: 100%; min-height: 38px;">
            Generate Verification Code
          </button>
        `;
      } else {
        taskContentHtml = `<div class="sig-endorsement-stamp">Signed by <strong>${task.signed_by || 'Verified Member'}</strong></div>`;
      }

      const memSearchBlob = `${comm.name} ${cleanedTrait} ${task.member_name || ''} ${task.signed_by || ''} ${task.selected_task || ''}`.replace(/"/g, '');

      return `
        <div class="sig-item-card sig-waypoint-row ${task.completed ? 'is-completed' : ''}" data-completed="${task.completed ? 'true' : 'false'}" data-search="${memSearchBlob}">
          <div class="sig-waypoint-header">
            <div class="sig-waypoint-trait-wrap">
              <span class="sig-num-tag">#${idx + 1}</span>
              <strong class="sig-trait-title">${cleanedTrait}</strong>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="sig-save-status" data-sig-id="${task.id}" style="font-size: 0.72rem; color: var(--text-muted); opacity: 0; transition: opacity 0.25s ease;"></span>
              <span class="sig-status-indicator ${task.completed ? 'status-done' : 'status-pending'}">
                ${task.completed ? '✓ Signed' : 'Pending'}
              </span>
            </div>
          </div>
          ${poolDropdownHtml}
          ${taskContentHtml}
        </div>
      `;
    }).join('');

    return `
      <div class="committee-card" data-committee="${comm.name}">
        <div class="committee-section-header">
          <h3 class="committee-section-title">
            ${comm.name} Committee
          </h3>
          <span class="subtext" style="font-size: 0.78rem;">${commSigs.filter(s => s.completed).length}/${commSigs.length} Done</span>
        </div>
        ${vpTaskHtml}
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${membersHtml}
        </div>
      </div>
    `;
  }).join('');

  const oaCardsHtml = oaTasks.length === 0
    ? '<p class="subtext">No O.A signature tasks have been assigned in the database yet.</p>'
    : oaTasks.map(task => {
        const rawTrait = task.trait || task.trait_description || task.task || 'O.A Signature';
        const cleanedTrait = cleanTraitText(rawTrait);
        const topBadgeText = task.task === 'GEOP Alum' || task.task === 'Other Member' ? task.task : 'O.A Task';

        const taskContentHtml = !task.completed ? `
          <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
            <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="member_name" placeholder="Name" value="${task.member_name || ''}" style="font-size: 0.8rem; padding: 6px;" />
            <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="geop_batch" placeholder="GEOP Batch" value="${task.geop_batch || ''}" style="font-size: 0.8rem; padding: 6px;" />
            <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="favorite_flagship_event" placeholder="Favorite Flagship Event" value="${task.favorite_flagship_event || ''}" style="font-size: 0.8rem; padding: 6px;" />
            <textarea class="sig-input" data-sig-id="${task.id}" data-field="favorite_geop_memory" placeholder="Favorite GEOP memory:" rows="2" style="font-size: 0.8rem; padding: 6px; resize: vertical;">${task.favorite_geop_memory || ''}</textarea>
          </div>
          <button class="btn btn-checkin trigger-sig-code-btn" data-sig-id="${task.id}" style="width: 100%; min-height: 38px;">
            Generate Signatory Code
          </button>
        ` : `<div class="sig-endorsement-stamp">Signed by <strong>${task.signed_by || task.member_name}</strong></div>`;

        const oaSearchBlob = `O.A ${cleanedTrait} ${task.member_name || ''} ${task.signed_by || ''} ${task.geop_batch || ''}`.replace(/"/g, '');

        return `
          <div class="sig-item-card sig-waypoint-row ${task.completed ? 'is-completed' : ''}" data-completed="${task.completed ? 'true' : 'false'}" data-search="${oaSearchBlob}">
            <div class="sig-waypoint-header">
              <div class="sig-waypoint-trait-wrap">
                <span class="sig-num-tag">${topBadgeText}</span>
                <strong class="sig-trait-title">${cleanedTrait}</strong>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="sig-save-status" data-sig-id="${task.id}" style="font-size: 0.72rem; color: var(--text-muted); opacity: 0; transition: opacity 0.25s ease;"></span>
                <span class="sig-status-indicator ${task.completed ? 'status-done' : 'status-pending'}">
                  ${task.completed ? '✓ Signed' : 'Pending'}
                </span>
              </div>
            </div>
            ${taskContentHtml}
          </div>
        `;
      }).join('');

  const isOaVisible = oaTasks.length > 0 || activeCategory === 'O.A' ? 'block' : 'none';
  const filterPillsHtml = categories.map(cat => `
    <button type="button" class="btn committee-filter-btn ${activeCategory === cat.value ? 'btn-checkin' : 'btn-secondary'}" data-category="${cat.value}" style="min-height: 38px; padding: 6px 14px; font-size: 0.82rem; white-space: nowrap;">
      ${cat.label}
    </button>
  `).join('');

  const pendingCount = total - completed;

  container.innerHTML = `
    <div class="signatories-view-wrap">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
        <div>
          <h2 style="font-family: var(--font-display); font-size: 1.4rem; color: var(--text-heading); margin-bottom: 2px;">Signatories Map</h2>
          <p class="subtext">Get to know your kasama, and complete committee tasks.</p>
        </div>
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <button type="button" id="exportSlambookPdfBtn" class="btn btn-secondary" style="min-height: 34px; padding: 4px 12px; font-size: 0.8rem;">
            Export Slambook (PDF)
          </button>
          <span class="sig-status-indicator status-done" style="font-size: 0.82rem; padding: 4px 12px;">
            ${completed} / ${total} Signed
          </span>
        </div>
      </div>

      <!-- PES EXECUTIVE APPOINTMENTS (PINNED TO TOP) -->
      <div class="pes-banner">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <h3 style="font-family: var(--font-display); color: var(--text-heading); font-size: 1.15rem; margin-bottom: 2px;">
              PES
            </h3>
            <p class="subtext" style="font-size: 0.78rem;">President • Executive Vice President • Secretary-General</p>
          </div>
          <span class="sig-status-indicator ${allCommitteesCompleted ? 'status-open' : 'status-locked'}">
            ${allCommitteesCompleted ? 'Unlocked' : 'Locked (Finish All Committee Tasks)'}
          </span>
        </div>
        <div class="pes-grid">
          ${pesHtml}
        </div>
      </div>

      <div style="background: var(--surface-subtle); border: 1px solid var(--border-subtle); padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 20px;">
        <small style="color: var(--text-muted); line-height: 1.4; display: block;">
          Heads up: each resident member can personally sign up to 4 signatory tasks. Spread yours across different members.
        </small>
      </div>

      <!-- SEARCH & PENDING/COMPLETED STATUS FILTER BAR -->
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px;">
        <input type="text" id="signatorySearchInput" value="${activeSearchQuery}" placeholder="Search trait, committee, or member name..." style="flex: 1; min-width: 240px; font-size: 0.82rem; padding: 8px 14px;" />
        <div style="display: flex; gap: 6px;">
          <button type="button" class="btn sig-status-filter-btn ${activeStatusFilter === 'ALL' ? 'btn-checkin' : 'btn-secondary'}" data-status="ALL" style="min-height: 34px; padding: 4px 12px; font-size: 0.78rem;">
            All (${total})
          </button>
          <button type="button" class="btn sig-status-filter-btn ${activeStatusFilter === 'PENDING' ? 'btn-checkin' : 'btn-secondary'}" data-status="PENDING" style="min-height: 34px; padding: 4px 12px; font-size: 0.78rem;">
            Pending (${pendingCount})
          </button>
          <button type="button" class="btn sig-status-filter-btn ${activeStatusFilter === 'COMPLETED' ? 'btn-checkin' : 'btn-secondary'}" data-status="COMPLETED" style="min-height: 34px; padding: 4px 12px; font-size: 0.78rem;">
            Signed (${completed})
          </button>
        </div>
      </div>

      <!-- COMMITTEE FILTER PILLS -->
      <div id="committeeFilterBar" style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 10px; margin-bottom: 24px;">
        ${filterPillsHtml}
      </div>

      <!-- COMMITTEE CARDS MATRIX -->
      <div id="committeesDisplayContainer" class="committees-layout-grid">
        ${committeesHtml}
        
        <!-- O.A CUSTOM CARD -->
        <div class="committee-card" data-committee="O.A" style="display: ${isOaVisible};">
          <div class="committee-section-header">
            <h3 class="committee-section-title">
              O.A Signatures
            </h3>
            <span class="subtext" style="font-size: 0.78rem;">${oaTasks.filter(s => s.completed).length}/${oaTasks.length} Done</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${oaCardsHtml}
          </div>
        </div>
      </div>
    </div>
  `;

  applySignatoryFilters(container);
}
