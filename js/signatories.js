import { 
  getSignatories, 
  selectTaskForSignatory, 
  generateApplicantShortCode, 
  COMMITTEES_LIST,
  supabase 
} from './storage.js';

export async function renderSignatoriesTab(container) {
  const signatories = await getSignatories();

  const completedCount = signatories.filter(s => s.completed).length;
  const totalCount = signatories.length || 18;

  const usedTasks = new Set(
    signatories
      .map(s => s.selected_task)
      .filter(t => t && t.trim().length > 0)
  );

  container.innerHTML = `
    <style>
      .sig-matrix-card { background: var(--surface-white, #fffdf8); border: 2px solid var(--ink, var(--brand-forest, #1b382b)); border-radius: var(--radius-md, 14px); padding: 24px; font-family: var(--font-body, system-ui, sans-serif); color: var(--text-body, #3d3327); }
      .sig-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--border-subtle, #e9dfc9); padding-bottom: 16px; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
      .sig-title { font-family: var(--font-display, Georgia, serif); font-size: 1.6rem; font-weight: 700; letter-spacing: -0.4px; color: var(--brand-forest, #1b382b); margin: 0; }
      .sig-badge { background: var(--brand-clay, #b5702f); color: #fffdf8; font-size: 0.85rem; font-weight: 700; padding: 6px 16px; border-radius: 9999px; border: 2px solid var(--ink, var(--brand-forest, #1b382b)); box-shadow: 2px 2px 0 var(--ink, var(--brand-forest, #1b382b)); }
      .sig-limit-note { font-size: 0.78rem; color: var(--text-muted, #7d6c56); background: var(--surface-subtle, #f3ecdd); border: 2px solid var(--border-medium, #d8c8a8); border-radius: 10px; padding: 8px 14px; margin-bottom: 18px; }
      .filter-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
      .filter-btn { background: var(--surface-white, #fffdf8); border: 2px solid var(--border-medium, #d8c8a8); color: var(--text-muted, #7d6c56); font-size: 0.78rem; font-weight: 700; padding: 6px 14px; border-radius: 9999px; cursor: pointer; transition: all 0.22s cubic-bezier(0.22,1,0.36,1); }
      .filter-btn:hover { border-color: var(--brand-clay, #b5702f); color: var(--brand-clay-deep, #8f5322); }
      .filter-btn.active { background: var(--brand-forest, #1b382b); color: #ffffff; border-color: var(--ink, var(--brand-forest, #1b382b)); box-shadow: 2px 2px 0 var(--brand-clay, #b5702f); }
      .committee-group { border: 2px solid var(--border-medium, #d8c8a8); background: var(--surface-bg, #faf5ea); border-radius: 14px; padding: 20px; margin-bottom: 20px; animation: sigFadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both; }
      .committee-title { font-family: var(--font-display, Georgia, serif); font-size: 1.15rem; font-weight: 700; color: var(--brand-forest, #1b382b); margin-top: 0; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid var(--brand-clay-light, #f4e6d2); }
      .sig-card { background: var(--surface-white, #fffdf8); border: 2px solid var(--border-medium, #d8c8a8); border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 3px 3px 0 rgba(27,56,43,0.12); transition: transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s ease; animation: sigFadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both; }
      .sig-card:hover { transform: translate(-2px, -2px); box-shadow: 5px 5px 0 var(--brand-clay, #b5702f); }
      .sig-card.completed { border-color: var(--brand-clay, #b5702f); background: var(--brand-clay-light, #f4e6d2); }
      .sig-card.locked { opacity: 0.65; background: var(--surface-subtle, #f3ecdd); border-color: var(--border-subtle, #e9dfc9); }
      .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
      .type-tag { display: inline-block; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; margin-bottom: 4px; }
      .type-member { background: var(--brand-mint-subtle, #eef3ea); color: var(--brand-forest, #1b382b); }
      .type-vp { background: #fef3c7; color: #92400e; }
      .status-pill { font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 9999px; transition: transform 0.2s ease; }
      .status-pending { background: #fff3e6; color: var(--brand-clay-deep, #8f5322); border: 2px solid var(--brand-clay-light, #f4e6d2); }
      .status-signed { background: var(--brand-clay, #b5702f); color: #fffdf8; border: 2px solid var(--ink, var(--brand-forest, #1b382b)); animation: sigPulse 1.8s cubic-bezier(0.22,1,0.36,1) infinite; }
      .status-locked { background: var(--surface-subtle, #f3ecdd); color: var(--text-muted, #7d6c56); border: 2px solid var(--border-subtle, #e9dfc9); }
      .dropdown-label { font-size: 0.75rem; font-weight: 600; color: var(--text-muted, #7d6c56); display: block; margin-bottom: 4px; }
      .custom-select { width: 100%; padding: 8px 12px; font-size: 0.8rem; border: 2px solid var(--border-medium, #d8c8a8); border-radius: 8px; background: var(--surface-white, #fffdf8); color: var(--text-body, #3d3327); outline: none; margin-bottom: 12px; cursor: pointer; transition: border-color 0.2s ease; }
      .custom-select:focus { border-color: var(--brand-clay, #b5702f); }
      .qa-box { background: var(--surface-subtle, #f3ecdd); border: 2px solid var(--border-subtle, #e9dfc9); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
      .qa-box-header { font-size: 0.75rem; font-weight: 700; color: var(--text-body, #3d3327); margin-bottom: 8px; display: block; }
      .qa-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
      .qa-field label { display: block; font-size: 0.7rem; color: var(--text-muted, #7d6c56); margin-bottom: 2px; }
      .qa-field input { width: 100%; padding: 6px 10px; font-size: 0.78rem; border: 2px solid var(--border-medium, #d8c8a8); border-radius: 6px; box-sizing: border-box; transition: border-color 0.2s ease; }
      .qa-field input:focus { border-color: var(--brand-clay, #b5702f); outline: none; }
      .action-btn { width: 100%; background: var(--brand-forest, #1b382b); color: #ffffff; font-size: 0.82rem; font-weight: 700; padding: 10px; border: 2px solid var(--ink, var(--brand-forest, #1b382b)); border-radius: 8px; cursor: pointer; box-shadow: 3px 3px 0 var(--ink, var(--brand-forest, #1b382b)); transition: background 0.22s ease, transform 0.15s ease, box-shadow 0.15s ease; }
      .action-btn:hover:not(:disabled) { background: var(--brand-forest-light, #2d5442); transform: translate(-2px, -2px); box-shadow: 5px 5px 0 var(--brand-clay, #b5702f); }
      .action-btn:active:not(:disabled) { transform: translate(0, 0); box-shadow: 1px 1px 0 var(--ink, var(--brand-forest, #1b382b)); }
      .action-btn:disabled { background: var(--border-medium, #d8c8a8); border-color: var(--border-medium, #d8c8a8); box-shadow: none; cursor: not-allowed; }
      .modal-backdrop { position: fixed; inset: 0; background: rgba(30, 22, 12, 0.55); backdrop-filter: blur(4px); z-index: 999; display: flex; align-items: center; justify-content: center; padding: 16px; animation: sigFadeUp 0.25s ease both; }
      .modal-box { background: var(--surface-white, #fffdf8); border: 2px solid var(--ink, var(--brand-forest, #1b382b)); border-radius: 16px; max-width: 400px; width: 100%; padding: 24px; text-align: center; box-shadow: 6px 6px 0 var(--brand-clay, #b5702f); animation: sigPopIn 0.3s cubic-bezier(0.22,1,0.36,1) both; }
      .code-display { background: var(--brand-clay-light, #f4e6d2); border: 2px dashed var(--brand-clay, #b5702f); color: var(--brand-clay-deep, #8f5322); font-family: monospace; font-size: 1.8rem; font-weight: 700; padding: 12px; border-radius: 8px; letter-spacing: 4px; margin: 12px 0; }
      #committeesContainer .committee-group:nth-of-type(1) { animation-delay: 0.04s; }
      #committeesContainer .committee-group:nth-of-type(2) { animation-delay: 0.08s; }
      #committeesContainer .committee-group:nth-of-type(3) { animation-delay: 0.12s; }
      #committeesContainer .committee-group:nth-of-type(4) { animation-delay: 0.16s; }
      #committeesContainer .committee-group:nth-of-type(5) { animation-delay: 0.2s; }
      #committeesContainer .committee-group:nth-of-type(n+6) { animation-delay: 0.24s; }
      .sig-card:nth-of-type(1) { animation-delay: 0.05s; }
      .sig-card:nth-of-type(2) { animation-delay: 0.1s; }
      .sig-card:nth-of-type(3) { animation-delay: 0.15s; }
      @keyframes sigFadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes sigPopIn { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
      @keyframes sigPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(181,112,47,0.4); } 50% { box-shadow: 0 0 0 5px rgba(181,112,47,0); } }
      @media (prefers-reduced-motion: reduce) {
        .sig-card, .committee-group, .modal-backdrop, .modal-box, .status-signed { animation: none !important; }
      }
    </style>

    <div class="sig-matrix-card">
      <div class="sig-header">
        <div>
          <h2 class="sig-title">Signatories Matrix</h2>
          <p style="font-size: 0.85rem; color: #64748b; margin: 4px 0 0 0;">Fulfill member tasks and receive official endorsement signatures from VPs.</p>
        </div>
        <div class="sig-badge">${completedCount} / ${totalCount} Signed</div>
      </div>

      <p class="sig-limit-note">💡 Heads up: each resident member can personally sign up to <strong>4</strong> signatory tasks — spread yours across different members instead of relying on one. (This limit doesn't apply to tambay hour verification.)</p>

      <div class="filter-bar">
        <button class="filter-btn comm-filter-btn active" data-filter="ALL">All (${totalCount})</button>
        ${COMMITTEES_LIST.map(c => `<button class="filter-btn comm-filter-btn" data-filter="${c.name}">${c.name}</button>`).join('')}
      </div>

      <div id="committeesContainer">
        ${COMMITTEES_LIST.map(comm => {
          const commSigs = signatories.filter(s => s.committee_name?.toLowerCase() === comm.name.toLowerCase());
          return renderCommitteeGroup(comm, commSigs, usedTasks);
        }).join('')}
      </div>
    </div>

    <!-- Verification Modal for Applicants -->
    <div id="verifyModal" class="modal-backdrop" style="display: none;">
      <div class="modal-box">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="margin: 0; font-size: 1.1rem; color: #0f172a;">Signatory Verification</h3>
          <button id="closeModalBtn" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #94a3b8;">&times;</button>
        </div>
        <p style="font-size: 0.8rem; color: #64748b; margin-bottom: 16px;">Show this QR code or 6-character code to a resident member or VP to sign this task!</p>
        
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: center;">
          <div id="qrcode"></div>
        </div>

        <div class="code-display" id="modalShortCode">------</div>
        <button type="button" class="copy-btn" data-copy-target="modalShortCode" title="Copy code" aria-label="Copy code" style="margin-bottom: 8px;">📋 Copy Code</button>

        <button id="doneVerifyBtn" class="action-btn" style="margin-top: 8px; background:#064e3b;">Close Window</button>
      </div>
    </div>
  `;

  attachSignatoryEvents(container, signatories);
}

function renderCommitteeGroup(comm, sigs, usedTasks) {
  const vpSig = sigs.find(s => s.type === 'VP');
  const memberSigs = sigs.filter(s => s.type !== 'VP');

  const allMembersCompleted = memberSigs.length > 0 && memberSigs.every(m => m.completed);

  const sortedSigs = [];
  if (vpSig) sortedSigs.push({ ...vpSig, isLocked: !allMembersCompleted });
  memberSigs.forEach(m => sortedSigs.push({ ...m, isLocked: false }));

  return `
    <div class="committee-group committee-card" data-committee="${comm.name}">
      <h3 class="committee-title">${comm.name} Committee</h3>
      <div>
        ${sortedSigs.map((sig, idx) => renderSignatoryCard(sig, idx, usedTasks)).join('')}
      </div>
    </div>
  `;
}

function renderSignatoryCard(sig, index, usedTasks) {
  const isVP = sig.type === 'VP';
  const isCompleted = sig.completed;
  const isLocked = sig.isLocked;
  const taskPool = sig.task_pool || [];

  let cleanTrait = sig.trait_description || sig.task || '';
  if (cleanTrait.toLowerCase().includes('trait ') || cleanTrait.toLowerCase().includes('task ')) {
    cleanTrait = isVP 
      ? `Official Endorsement by ${sig.committee_name} VP`
      : `Find a member from ${sig.committee_name} Committee`;
  }

  return `
    <div class="sig-card ${isCompleted ? 'completed' : ''} ${isLocked ? 'locked' : ''}">
      <div class="card-top">
        <div>
          <span class="type-tag ${isVP ? 'type-vp' : 'type-member'}">
            ${isVP ? 'VP Endorsement' : `Member Task #${index}`}
          </span>
          <h4 style="margin: 4px 0 0 0; font-size: 0.9rem; color: #1e293b;">${cleanTrait}</h4>
        </div>
        <span class="status-pill ${isCompleted ? 'status-signed' : (isLocked ? 'status-locked' : 'status-pending')}">
          ${isCompleted ? '✓ Signed' : (isLocked ? '🔒 Locked' : 'Pending Sign')}
        </span>
      </div>

      ${!isVP ? `
        <div>
          <label class="dropdown-label">Choose 1 Task from your 25-Task Pool:</label>
          <select class="custom-select task-select" data-id="${sig.id}" ${isCompleted || isLocked ? 'disabled' : ''}>
            <option value="">-- Select a Task --</option>
            ${taskPool.map(task => {
              const isSelectedByThisCard = sig.selected_task === task;
              const isUsedElsewhere = usedTasks.has(task) && !isSelectedByThisCard;
              
              return `
                <option value="${task}" ${isSelectedByThisCard ? 'selected' : ''} ${isUsedElsewhere ? 'disabled' : ''}>
                  ${task} ${isUsedElsewhere ? ' (Already Claimed)' : ''}
                </option>
              `;
            }).join('')}
          </select>
        </div>
      ` : ''}

      <!-- Q&A Inputs -->
      <div class="qa-box">
        <span class="qa-box-header">Interview Details & Answers:</span>
        <div class="qa-grid">
          <div class="qa-field">
            <label>Member/VP Name:</label>
            <input type="text" class="qa-input" placeholder="e.g. Juan Dela Cruz" data-sig-id="${sig.id}" data-field="member_name" value="${sig.member_name || ''}" ${isCompleted || isLocked ? 'disabled' : ''} />
          </div>
          <div class="qa-field">
            <label>Nickname:</label>
            <input type="text" class="qa-input" placeholder="e.g. Juan" data-sig-id="${sig.id}" data-field="nickname" value="${sig.nickname || ''}" ${isCompleted || isLocked ? 'disabled' : ''} />
          </div>
          <div class="qa-field">
            <label>Favorite Spot in UP:</label>
            <input type="text" class="qa-input" placeholder="e.g. Sunken Garden / CS Lib" data-sig-id="${sig.id}" data-field="fav_spot" value="${sig.fav_spot || ''}" ${isCompleted || isLocked ? 'disabled' : ''} />
          </div>
          <div class="qa-field">
            <label>Least Liked Major Sub:</label>
            <input type="text" class="qa-input" placeholder="e.g. GE 10 / Math 21" data-sig-id="${sig.id}" data-field="least_sub" value="${sig.least_sub || ''}" ${isCompleted || isLocked ? 'disabled' : ''} />
          </div>
        </div>
      </div>

      ${!isCompleted ? `
        <button class="action-btn request-sign-btn" data-id="${sig.id}" ${isLocked ? 'disabled' : ''}>
          ${isLocked ? '🔒 Complete Both Member Tasks First' : 'Request Signature (Show QR / Code)'}
        </button>
      ` : `
        <div style="font-size: 0.78rem; color: #065f46; background: #e6f4ea; padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between;">
          <span>Signed by: <strong>${sig.signed_by || 'Verified Member'}</strong></span>
          <span>${sig.signed_at ? new Date(sig.signed_at).toLocaleDateString() : 'Verified'}</span>
        </div>
      `}
    </div>
  `;
}

function attachSignatoryEvents(container, signatories) {
  const filterBtns = container.querySelectorAll('.comm-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      container.querySelectorAll('.committee-card').forEach(card => {
        if (filter === 'ALL' || card.dataset.committee === filter) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });

  container.querySelectorAll('.task-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const sigId = e.target.dataset.id;
      const selectedTask = e.target.value;
      await selectTaskForSignatory(sigId, selectedTask);
      renderSignatoriesTab(container);
    });
  });

  container.querySelectorAll('.qa-input').forEach(input => {
    input.addEventListener('blur', async (e) => {
      const sigId = e.target.dataset.sigId;
      const field = e.target.dataset.field;
      const val = e.target.value.trim();

      await supabase.from('signatories').update({ [field]: val }).eq('id', sigId);
    });
  });

  const verifyModal = container.querySelector('#verifyModal');
  const closeModalBtn = container.querySelector('#closeModalBtn');
  const doneVerifyBtn = container.querySelector('#doneVerifyBtn');
  const modalShortCode = container.querySelector('#modalShortCode');

  container.querySelectorAll('.request-sign-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (btn.disabled) return;

      const sigId = btn.dataset.id;
      const sigCard = e.target.closest('.sig-card');
      const selectElem = sigCard?.querySelector('.task-select');

      if (selectElem && !selectElem.value) {
        alert('Please choose 1 task from your dropdown pool before requesting a signature!');
        return;
      }

      // Generate universal code flagged for SIGNATORY
      const code = await generateApplicantShortCode(sigId, 'SIGNATORY');
      if (!code) {
        alert('Error generating verification code.');
        return;
      }

      modalShortCode.textContent = code;

      const baseUrl = window.location.origin + window.location.pathname;
      const qrData = `${baseUrl}?verifyCode=${code}`;

      const qrContainer = container.querySelector('#qrcode');
      qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}" alt="Verification QR Code" style="width:140px; height:140px; border-radius:8px;" />`;

      verifyModal.style.display = 'flex';
    });
  });

  closeModalBtn?.addEventListener('click', () => verifyModal.style.display = 'none');
  doneVerifyBtn?.addEventListener('click', () => verifyModal.style.display = 'none');
}
