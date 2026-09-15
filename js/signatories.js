import { 
  getSignatories, 
  selectTaskForSignatory, 
  generateApplicantShortCode, 
  COMMITTEES_LIST,
  updateSignatoryAnswer
} from './storage.js';

export async function renderSignatoriesTab(container) {
  const signatories = await getSignatories();
  const completedCount = signatories.filter(s => s.completed).length;
  const totalCount = signatories.length || 18;

  const usedTasks = new Set(
    signatories.map(s => s.selected_task).filter(t => t && t.trim().length > 0)
  );

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2>Signatories Matrix</h2>
          <p class="subtext" style="margin-bottom:0;">Fulfill member traits and obtain VP endorsements.</p>
        </div>
        <span class="badge" style="background: var(--brand-forest); color: white;">${completedCount} / ${totalCount} Signed</span>
      </div>

      <div style="background: var(--surface-subtle); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 16px; font-size: 0.8rem; color: var(--text-muted);">
        Notice: Each resident member may sign a maximum of 4 tasks. Spread interviews across different members.
      </div>

      <div class="tab-nav" style="margin-bottom: 16px;">
        <button class="tab-btn comm-filter-btn active" data-filter="ALL">All (${totalCount})</button>
        ${COMMITTEES_LIST.map(c => `<button class="tab-btn comm-filter-btn" data-filter="${c.name}">${c.name}</button>`).join('')}
      </div>

      <div id="committeesContainer">
        ${COMMITTEES_LIST.map(comm => {
          const commSigs = signatories.filter(s => s.committee_name?.toLowerCase() === comm.name.toLowerCase());
          return renderCommitteeGroup(comm, commSigs, usedTasks);
        }).join('')}
      </div>
    </section>

    <!-- Accessible Modal Container -->
    <div id="verifyModal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="verifyModalTitle">
      <div class="modal-box" style="text-align: center;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h3 id="verifyModalTitle" style="font-size: 1.1rem; color: var(--brand-forest);">Signatory Verification</h3>
          <button id="closeVerifyModalBtn" aria-label="Close modal" style="background:none; border:none; font-size: 1.4rem; cursor:pointer;">&times;</button>
        </div>
        <p class="subtext">Present this QR code or 6-character code to the signatory.</p>
        <div id="modalQrCode" style="display: flex; justify-content: center; margin-bottom: 12px;"></div>
        <div id="modalShortCode" style="font-family: var(--font-mono); font-size: 1.6rem; font-weight: 700; letter-spacing: 4px; padding: 10px; background: var(--surface-subtle); border-radius: var(--radius-sm); margin-bottom: 12px;">------</div>
        <button id="doneVerifyModalBtn" class="btn btn-secondary" style="width: 100%;">Close</button>
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
    <div class="committee-group" data-committee="${comm.name}">
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

  return `
    <div class="sig-card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span class="badge">${isVP ? 'VP Endorsement' : `Member Task #${index + 1}`}</span>
        <span class="badge" style="background: ${isCompleted ? 'var(--brand-mint-subtle)' : 'var(--surface-subtle)'}; color: ${isCompleted ? 'var(--brand-mint)' : 'var(--text-muted)'};">
          ${isCompleted ? '✓ Signed' : (isLocked ? 'Locked' : 'Pending')}
        </span>
      </div>
      <p style="font-size: 0.9rem; font-weight: 600; margin-bottom: 10px;">${sig.trait_description || sig.task}</p>

      ${!isVP ? `
        <div style="margin-bottom: 10px;">
          <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 4px;">Select Task Requirement:</label>
          <select class="task-select" data-id="${sig.id}" ${isCompleted || isLocked ? 'disabled' : ''} style="width: 100%;">
            <option value="">-- Choose Task --</option>
            ${taskPool.map(task => {
              const isSelected = sig.selected_task === task;
              const isUsed = usedTasks.has(task) && !isSelected;
              return `<option value="${task}" ${isSelected ? 'selected' : ''} ${isUsed ? 'disabled' : ''}>${task} ${isUsed ? '(Taken)' : ''}</option>`;
            }).join('')}
          </select>
        </div>
      ` : ''}

      <div class="qa-grid">
        <div class="qa-field">
          <label>Member Name:</label>
          <input type="text" class="qa-input" data-sig-id="${sig.id}" data-field="member_name" value="${sig.member_name || ''}" ${isCompleted || isLocked ? 'disabled' : ''} />
        </div>
        <div class="qa-field">
          <label>Nickname:</label>
          <input type="text" class="qa-input" data-sig-id="${sig.id}" data-field="nickname" value="${sig.nickname || ''}" ${isCompleted || isLocked ? 'disabled' : ''} />
        </div>
        <div class="qa-field">
          <label>Favorite UP Spot:</label>
          <input type="text" class="qa-input" data-sig-id="${sig.id}" data-field="fav_spot" value="${sig.fav_spot || ''}" ${isCompleted || isLocked ? 'disabled' : ''} />
        </div>
        <div class="qa-field">
          <label>Least Liked Sub:</label>
          <input type="text" class="qa-input" data-sig-id="${sig.id}" data-field="least_sub" value="${sig.least_sub || ''}" ${isCompleted || isLocked ? 'disabled' : ''} />
        </div>
      </div>

      ${!isCompleted ? `
        <button class="btn btn-checkin request-sign-btn" data-id="${sig.id}" ${isLocked ? 'disabled' : ''} style="width: 100%; margin-top: 8px;">
          ${isLocked ? 'Complete Member Tasks to Unlock' : 'Request Signature'}
        </button>
      ` : `
        <div style="font-size: 0.8rem; color: var(--brand-mint); padding: 8px; background: var(--brand-mint-subtle); border-radius: var(--radius-sm); margin-top: 8px;">
          Verified by: <strong>${sig.signed_by || 'Member'}</strong>
        </div>
      `}
    </div>
  `;
}

function attachSignatoryEvents(container, signatories) {
  const verifyModal = container.querySelector('#verifyModal');
  const closeModal = () => { if (verifyModal) verifyModal.style.display = 'none'; };

  container.querySelector('#closeVerifyModalBtn')?.addEventListener('click', closeModal);
  container.querySelector('#doneVerifyModalBtn')?.addEventListener('click', closeModal);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && verifyModal?.style.display === 'flex') closeModal();
  });

  container.querySelectorAll('.comm-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.comm-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      container.querySelectorAll('.committee-group').forEach(group => {
        group.style.display = (filter === 'ALL' || group.dataset.committee === filter) ? 'block' : 'none';
      });
    });
  });

  container.querySelectorAll('.task-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      await selectTaskForSignatory(e.target.dataset.id, e.target.value);
      renderSignatoriesTab(container);
    });
  });

  container.querySelectorAll('.qa-input').forEach(input => {
    input.addEventListener('blur', async (e) => {
      await updateSignatoryAnswer(e.target.dataset.sigId, e.target.dataset.field, e.target.value.trim());
    });
  });

  container.querySelectorAll('.request-sign-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const sigId = btn.dataset.id;
      const code = await generateApplicantShortCode(sigId, 'SIGNATORY');
      if (!code) return;

      container.querySelector('#modalShortCode').textContent = code;
      const url = `${window.location.origin}${window.location.pathname}?verifyCode=${code}`;
      container.querySelector('#modalQrCode').innerHTML = `
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}" alt="QR Code" width="160" height="160" />
      `;
      verifyModal.style.display = 'flex';
    });
  });
}
