import { 
  getSignatories, 
  selectTaskForSignatory, 
  generateApplicantShortCode, 
  verifySignatoryDirectly,
  getApplicantIdByShortCode,
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
      .sig-matrix-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; font-family: system-ui, -apple-system, sans-serif; color: #1e293b; }
      .sig-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
      .sig-title { font-size: 1.5rem; font-weight: 700; color: #064e3b; margin: 0; }
      .sig-badge { background: #ecfdf5; color: #047857; font-size: 0.85rem; font-weight: 600; padding: 6px 16px; border-radius: 9999px; border: 1px solid #a7f3d0; }
      .filter-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
      .filter-btn { background: #f8fafc; border: 1px solid #e2e8f0; color: #475569; font-size: 0.78rem; font-weight: 600; padding: 6px 14px; border-radius: 9999px; cursor: pointer; transition: all 0.2s ease; }
      .filter-btn.active { background: #064e3b; color: #ffffff; border-color: #064e3b; }
      .committee-group { border: 1px solid #e2e8f0; background: #fafafa; border-radius: 14px; padding: 20px; margin-bottom: 20px; }
      .committee-title { font-size: 1.1rem; font-weight: 700; color: #065f46; margin-top: 0; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #a7f3d0; }
      .sig-card { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      .sig-card.completed { border-color: #34d399; background: #f0fdf4; }
      .sig-card.locked { opacity: 0.6; background: #f8fafc; border-color: #e2e8f0; }
      .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
      .type-tag { display: inline-block; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; margin-bottom: 4px; }
      .type-member { background: #dbeafe; color: #1e40af; }
      .type-vp { background: #fef3c7; color: #92400e; }
      .status-pill { font-size: 0.75rem; font-weight: 600; padding: 4px 10px; border-radius: 9999px; }
      .status-pending { background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5; }
      .status-signed { background: #d1fae5; color: #065f46; }
      .status-locked { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }
      .dropdown-label { font-size: 0.75rem; font-weight: 600; color: #475569; display: block; margin-bottom: 4px; }
      .custom-select { width: 100%; padding: 8px 12px; font-size: 0.8rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #ffffff; color: #1e293b; outline: none; margin-bottom: 12px; cursor: pointer; }
      .qa-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
      .qa-box-header { font-size: 0.75rem; font-weight: 700; color: #334155; margin-bottom: 8px; display: block; }
      .qa-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
      .qa-field label { display: block; font-size: 0.7rem; color: #64748b; margin-bottom: 2px; }
      .qa-field input { width: 100%; padding: 6px 10px; font-size: 0.78rem; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
      .action-btn { width: 100%; background: #064e3b; color: #ffffff; font-size: 0.82rem; font-weight: 600; padding: 10px; border: none; border-radius: 8px; cursor: pointer; transition: background 0.2s ease; }
      .action-btn:disabled { background: #94a3b8; cursor: not-allowed; }
      .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 999; display: flex; align-items: center; justify-content: center; padding: 16px; }
      .modal-box { background: #ffffff; border-radius: 16px; max-width: 400px; width: 100%; padding: 24px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }
      .code-display { background: #ecfdf5; border: 1px dashed #059669; color: #064e3b; font-family: monospace; font-size: 1.8rem; font-weight: 700; padding: 12px; border-radius: 8px; letter-spacing: 4px; margin: 12px 0; }
    </style>

    <div class="sig-matrix-card">
      <div class="sig-header">
        <div>
          <h2 class="sig-title">Signatories Matrix</h2>
          <p style="font-size: 0.85rem; color: #64748b; margin: 4px 0 0 0;">Fulfill member tasks and receive official endorsement signatures from VPs.</p>
        </div>
        <div class="sig-badge">${completedCount} / ${totalCount} Signed</div>
      </div>

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

    <!-- Signatory Verification Modal -->
    <div id="verifyModal" class="modal-backdrop" style="display: none;">
      <div class="modal-box">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 style="margin: 0; font-size: 1.1rem; color: #0f172a;">Signatory Verification</h3>
          <button id="closeModalBtn" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #94a3b8;">&times;</button>
        </div>
        <p style="font-size: 0.8rem; color: #64748b; margin-bottom: 16px;">Show this QR code or 6-digit code to the member/VP to verify this task!</p>
        
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: center;">
          <div id="qrcode"></div>
        </div>

        <div class="code-display" id="modalShortCode">------</div>

        <!-- Direct Email Sign-off -->
        <div style="margin-top: 12px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
          <input type="email" id="verifierEmailInput" placeholder="Member Email to Sign" style="width:100%; padding:8px; font-size:0.8rem; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:6px; box-sizing:border-box;" />
          <button id="confirmDirectSignBtn" class="action-btn" style="background:#0284c7;">Sign Task Now</button>
        </div>

        <button id="doneVerifyBtn" class="action-btn" style="margin-top: 8px; background:#64748b;">Close</button>
      </div>
    </div>
  `;

  attachSignatoryEvents(container, signatories);
}

function renderCommitteeGroup(comm, sigs, usedTasks) {
  const vpSig = sigs.find(s => s.type === 'VP');
  const memberSigs = sigs.filter(s => s.type !== 'VP');

  // Lock rule: VP unlocked ONLY IF both member tasks are completed
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
  let activeSigIdForModal = null;

  // Filter tabs
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

  // Task selection dropdown
  container.querySelectorAll('.task-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const sigId = e.target.dataset.id;
      const selectedTask = e.target.value;
      await selectTaskForSignatory(sigId, selectedTask);
      renderSignatoriesTab(container);
    });
  });

  // Save Q&A inputs
  container.querySelectorAll('.qa-input').forEach(input => {
    input.addEventListener('blur', async (e) => {
      const sigId = e.target.dataset.sigId;
      const field = e.target.dataset.field;
      const val = e.target.value.trim();

      await supabase.from('signatories').update({ [field]: val }).eq('id', sigId);
    });
  });

  // Verification Modal
  const verifyModal = container.querySelector('#verifyModal');
  const closeModalBtn = container.querySelector('#closeModalBtn');
  const doneVerifyBtn = container.querySelector('#doneVerifyBtn');
  const modalShortCode = container.querySelector('#modalShortCode');
  const confirmDirectSignBtn = container.querySelector('#confirmDirectSignBtn');
  const verifierEmailInput = container.querySelector('#verifierEmailInput');

  container.querySelectorAll('.request-sign-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (btn.disabled) return;

      activeSigIdForModal = btn.dataset.id;
      const sigCard = e.target.closest('.sig-card');
      const selectElem = sigCard?.querySelector('.task-select');

      if (selectElem && !selectElem.value) {
        alert('Please choose 1 task from your dropdown pool before requesting a signature!');
        return;
      }

      const code = await generateApplicantShortCode();
      if (!code) {
        alert('Error generating verification code.');
        return;
      }

      modalShortCode.textContent = code;

      const baseUrl = window.location.origin + window.location.pathname;
      const qrData = `${baseUrl}?verifySig=${activeSigIdForModal}&code=${code}`;

      const qrContainer = container.querySelector('#qrcode');
      qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(qrData)}" alt="Verification QR Code" style="width:140px; height:140px; border-radius:8px;" />`;

      verifyModal.style.display = 'flex';
    });
  });

  confirmDirectSignBtn?.addEventListener('click', async () => {
    const inputVal = verifierEmailInput?.value?.trim();
    if (!inputVal) {
      alert('Please enter member email or 6-digit code to sign.');
      return;
    }

    if (!activeSigIdForModal) return;

    // Support entering short code or member email
    if (inputVal.length === 6 && !inputVal.includes('@')) {
      const applicantId = await getApplicantIdByShortCode(inputVal);
      if (!applicantId) {
        alert('Invalid or expired 6-digit verification code.');
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const currentEmail = session?.user?.email || 'Resident Member';
      const res = await verifySignatoryDirectly(activeSigIdForModal, currentEmail);
      alert(res.message);
      if (res.success) {
        verifyModal.style.display = 'none';
        renderSignatoriesTab(container);
      }
    } else {
      const res = await verifySignatoryDirectly(activeSigIdForModal, inputVal);
      alert(res.message);
      if (res.success) {
        verifyModal.style.display = 'none';
        renderSignatoriesTab(container);
      }
    }
  });

  closeModalBtn?.addEventListener('click', () => verifyModal.style.display = 'none');
  doneVerifyBtn?.addEventListener('click', () => verifyModal.style.display = 'none');
}
