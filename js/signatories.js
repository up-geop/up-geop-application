import {
  getSignatories,
  selectTaskForSignatory,
  generateApplicantShortCode,
  updateSignatoryAnswer,
  COMMITTEES_LIST
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
          <p class="subtext" style="margin-bottom: 0;">Fulfill member tasks and receive official VP endorsements.</p>
        </div>
        <span class="badge" style="background: var(--brand-forest); color: white;">${completedCount} / ${totalCount} Signed</span>
      </div>

      <div style="background: var(--surface-subtle); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 16px; font-size: 0.8rem; color: var(--text-muted);">
        Heads up: each resident member can personally sign up to 4 signatory tasks. Spread yours across different members.
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

    <div id="verifyModal" class="modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal-box" style="text-align: center;">
        <h3 style="margin-bottom: 8px;">Signatory Verification</h3>
        <p class="subtext">Ask a resident member or VP to scan this QR code or input the 6-character code.</p>
        <div id="modalQrCode" style="display: flex; justify-content: center; margin-bottom: 12px;"></div>
        <div id="modalShortCode" style="font-family: var(--font-mono); font-size: 1.6rem; font-weight: 700; letter-spacing: 4px; padding: 10px; background: var(--surface-subtle); border-radius: var(--radius-sm); margin-bottom: 12px;">------</div>
        <button type="button" class="copy-btn btn btn-secondary" data-copy-target="modalShortCode" style="min-height: 36px; padding: 4px 10px; margin-bottom: 12px;">Copy Code</button>
        <button id="closeVerifyModalBtn" class="btn btn-secondary" style="width: 100%;">Close</button>
      </div>
    </div>
  `;

  attachSignatoryEvents(container);
}

function renderCommitteeGroup(comm, sigs, usedTasks) {
  const vpSig = sigs.find(s => s.type === 'VP');
  const memberSigs = sigs.filter(s => s.type !== 'VP');
  const allCompleted = memberSigs.length > 0 && memberSigs.every(m => m.completed);

  const sorted = [];
  if (vpSig) sorted.push({ ...vpSig, isLocked: !allCompleted });
  memberSigs.forEach(m => sorted.push({ ...m, isLocked: false }));

  return `
    <div class="card committee-group" data-committee="${comm.name}">
      <h3 style="font-family: var(--font-display); font-size: 1.15rem; color: var(--brand-forest); margin-bottom: 12px; border-bottom: 1px solid var(--border-medium); padding-bottom: 4px;">
        ${comm.name} Committee
      </h3>
      <div>
        ${sorted.map((sig, idx) => renderSignatoryCard(sig, idx, usedTasks)).join('')}
      </div>
    </div>
  `;
}

function renderSignatoryCard(sig, idx, usedTasks) {
  const isVP = sig.type === 'VP';
  const isCompleted = sig.completed;
  const isLocked = sig.isLocked;
  const pool = sig.task_pool || [];

  return `
    <div class="card" style="margin-bottom: 12px; background: ${isCompleted ? 'var(--brand-mint-subtle)' : 'var(--surface-white)'};">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span class="badge">${isVP ? 'VP Endorsement' : `Member Task #${idx + 1}`}</span>
        <span class="badge" style="background: ${isCompleted ? 'var(--brand-mint)' : 'var(--surface-subtle)'}; color: ${isCompleted ? '#fff' : 'inherit'};">
          ${isCompleted ? '✓ Signed' : (isLocked ? 'Locked' : 'Pending')}
        </span>
      </div>

      <p style="font-size: 0.9rem; font-weight: 600; margin-bottom: 10px;">${sig.trait_description || sig.task}</p>

      ${!isVP ? `
        <div style="margin-bottom: 12px;">
          <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 4px;">Choose Task:</label>
          <select class="task-select" data-id="${sig.id}" ${isCompleted || isLocked ? 'disabled' : ''} style="width: 100%;">
            <option value="">-- Select a Task --</option>
            ${pool.map(task => {
              const sel = sig.selected_task === task;
              const used = usedTasks.has(task) && !sel;
              return `<option value="${task}" ${sel ? 'selected' : ''} ${used ? 'disabled' : ''}>${task} ${used ? '(Taken)' : ''}</option>`;
            }).join('')}
          </select>
        </div>
      ` : ''}

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 12px;">
        <div>
          <label style="font-size: 0.72rem; color: var(--text-muted); display: block;">Member Name:</label>
          <input type="text" class="qa-input" data-sig-id="${sig.id}" data-field="member_name" value="${sig.member_name || ''}" ${isCompleted || isLocked ? 'disabled' : ''} style="width: 100%; min-height: 36px; padding: 4px 8px; font-size: 0.8rem;" />
        </div>
        <div>
          <label style="font-size: 0.72rem; color: var(--text-muted); display: block;">Nickname:</label>
          <input type="text" class="qa-input" data-sig-id="${sig.id}" data-field="nickname" value="${sig.nickname || ''}" ${isCompleted || isLocked ? 'disabled' : ''} style="width: 100%; min-height: 36px; padding: 4px 8px; font-size: 0.8rem;" />
        </div>
        <div>
          <label style="font-size: 0.72rem; color: var(--text-muted); display: block;">Favorite Spot:</label>
          <input type="text" class="qa-input" data-sig-id="${sig.id}" data-field="fav_spot" value="${sig.fav_spot || ''}" ${isCompleted || isLocked ? 'disabled' : ''} style="width: 100%; min-height: 36px; padding: 4px 8px; font-size: 0.8rem;" />
        </div>
        <div>
          <label style="font-size: 0.72rem; color: var(--text-muted); display: block;">Least Liked Sub:</label>
          <input type="text" class="qa-input" data-sig-id="${sig.id}" data-field="least_sub" value="${sig.least_sub || ''}" ${isCompleted || isLocked ? 'disabled' : ''} style="width: 100%; min-height: 36px; padding: 4px 8px; font-size: 0.8rem;" />
        </div>
      </div>

      ${!isCompleted ? `
        <button class="btn btn-checkin request-sign-btn" data-id="${sig.id}" ${isLocked ? 'disabled' : ''} style="width: 100%;">
          ${isLocked ? 'Complete Member Tasks to Unlock' : 'Request Signature'}
        </button>
      ` : `
        <div style="font-size: 0.8rem; color: var(--brand-mint); padding: 6px; background: var(--surface-white); border-radius: 4px;">
          Signed by: <strong>${sig.signed_by || 'Verified'}</strong> on ${sig.signed_at ? new Date(sig.signed_at).toLocaleDateString() : 'Verified'}
        </div>
      `}
    </div>
  `;
}

function attachSignatoryEvents(container) {
  const modal = container.querySelector('#verifyModal');
  const closeModal = () => { if (modal) modal.style.display = 'none'; };

  container.querySelector('#closeVerifyModalBtn')?.addEventListener('click', closeModal);

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

  container.querySelectorAll('.task-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      await selectTaskForSignatory(e.target.dataset.id, e.target.value);
      await renderSignatoriesTab(container);
    });
  });

  container.querySelectorAll('.qa-input').forEach(input => {
    input.addEventListener('blur', async (e) => {
      await updateSignatoryAnswer(e.target.dataset.sigId, e.target.dataset.field, e.target.value.trim());
    });
  });

  container.querySelectorAll('.request-sign-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const code = await generateApplicantShortCode(btn.dataset.id, 'SIGNATORY');
      if (!code) return;

      container.querySelector('#modalShortCode').textContent = code;
      const url = `${window.location.origin}${window.location.pathname}?verifyCode=${code}`;
      container.querySelector('#modalQrCode').innerHTML = `
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}" alt="QR" width="150" height="150" style="border-radius: 6px;" />
      `;
      modal.style.display = 'flex';
    });
  });
}
