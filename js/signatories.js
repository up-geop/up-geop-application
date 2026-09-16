import { COMMITTEES_LIST } from './config.js';
import {
  getSignatories,
  getAllMembersList,
  selectTaskForSignatory,
  updateSignatoryAnswer,
  generateApplicantShortCode
} from './storage.js';
import { showToast } from './app.js';

let activeCategory = 'ALL';

function cleanTraitText(text) {
  if (!text) return '';
  let cleaned = text
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/^find\s+(an?|the|another|other)?\s*(member|person|someone)?\s*(who|na|that)?\s*/i, '')
    .replace(/^(another|other)?\s*member\s*(who|na|that)?\s*/i, '')
    .replace(/^(who|na|that)\s+/i, '')
    .trim();

  if (cleaned.length === 0) return text;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export async function renderSignatoriesTab(container) {
  if (!container) return;
  const [signatories, membersList] = await Promise.all([
    getSignatories(),
    getAllMembersList()
  ]);

  const total = signatories.length || 18;
  const completed = signatories.filter(s => s.completed).length;

  const categories = [
    { label: `All (${total})`, value: 'ALL' },
    { label: 'Academics', value: 'Academics' },
    { label: 'Publicity', value: 'Publicity' },
    { label: 'RAComm', value: 'RAComm' },
    { label: 'Internal', value: 'Internal' },
    { label: 'External', value: 'External' },
    { label: 'Finance', value: 'Finance' }
  ];

  container.innerHTML = `
    <section class="card">
      <div class="card-header">
        <div>
          <h2>Signatories Matrix</h2>
          <p class="subtext">Fulfill member tasks and receive official VP endorsements.</p>
        </div>
        <span class="badge" style="background: var(--brand-forest); color: white; font-weight: 700;">
          ${completed} / ${total} Signed
        </span>
      </div>

      <div style="background: var(--surface-subtle); border-left: 4px solid var(--brand-clay); padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 20px;">
        <small style="color: var(--text-muted); line-height: 1.4; display: block;">
          Heads up: each resident member can personally sign up to 4 signatory tasks. Spread yours across different members.
        </small>
      </div>

      <!-- Committee Filter Pills -->
      <div id="committeeFilterBar" style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 12px; margin-bottom: 20px;">
        ${categories.map(cat => `
          <button type="button" 
                  class="btn committee-filter-btn ${activeCategory === cat.value ? 'btn-checkin' : 'btn-secondary'}" 
                  data-category="${cat.value}" 
                  style="min-height: 38px; padding: 6px 14px; font-size: 0.82rem; white-space: nowrap;">
            ${cat.label}
          </button>
        `).join('')}
      </div>

      <div id="committeesDisplayContainer" style="display: flex; flex-direction: column; gap: 20px;">
        ${COMMITTEES_LIST.map(comm => {
          const commSigs = signatories.filter(s => (s.committee_name || '').toLowerCase() === comm.name.toLowerCase());
          const vpTask = commSigs.find(s => s.role === 'VP' || s.type === 'VP');
          const memberTasks = commSigs.filter(s => s !== vpTask);
          const membersDone = memberTasks.length > 0 && memberTasks.every(s => s.completed);

          return `
            <div class="card committee-card" data-committee="${comm.name}" style="margin: 0; padding: 20px;">
              <h2 style="font-family: var(--font-display); color: var(--brand-forest); margin-bottom: 16px;">
                ${comm.name} Committee
              </h2>

              <!-- VP Endorsement Task with Photo and Pre-filled Name -->
              ${vpTask ? `
                <div class="card" style="margin-bottom: 16px; border-color: ${vpTask.completed ? 'var(--brand-mint)' : 'var(--border-medium)'}; background: ${vpTask.completed ? 'var(--brand-mint-subtle)' : 'var(--surface)'};">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <span class="badge" style="background: var(--surface-subtle); color: var(--text-muted); font-weight: 600;">VP Endorsement</span>
                    <span class="badge" style="background: ${vpTask.completed ? 'var(--brand-mint)' : 'var(--surface-subtle)'}; color: ${vpTask.completed ? '#fff' : 'inherit'};">
                      ${vpTask.completed ? 'Completed' : (membersDone ? 'Unlocked' : 'Locked')}
                    </span>
                  </div>

                  <div style="display: flex; gap: 14px; align-items: center; margin-bottom: 14px;">
                    <img src="${comm.photo}" 
                         alt="${comm.vp}" 
                         onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(comm.vp)}&background=1b382b&color=fff';"
                         style="width: 58px; height: 58px; border-radius: 50%; object-fit: cover; border: 2px solid var(--brand-forest); flex-shrink: 0;" />
                    <div>
                      <strong style="font-size: 1rem; color: var(--brand-forest); display: block;">${comm.vp}</strong>
                      <small style="color: var(--text-muted);">${comm.vpTitle}</small>
                      <div><small style="font-size: 0.75rem; color: var(--brand-clay-deep);">${comm.vpEmail}</small></div>
                    </div>
                  </div>

                  ${!vpTask.completed ? `
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 12px;">
                      <input type="text" class="sig-input" data-sig-id="${vpTask.id}" data-field="nickname" placeholder="Nickname" value="${vpTask.nickname || ''}" ${!membersDone ? 'disabled' : ''} style="font-size: 0.8rem; padding: 6px;" />
                      <input type="text" class="sig-input" data-sig-id="${vpTask.id}" data-field="favorite_spot" placeholder="Favorite Spot" value="${vpTask.favorite_spot || ''}" ${!membersDone ? 'disabled' : ''} style="font-size: 0.8rem; padding: 6px;" />
                      <input type="text" class="sig-input" data-sig-id="${vpTask.id}" data-field="least_liked_sub" placeholder="Least Liked Sub" value="${vpTask.least_liked_sub || ''}" ${!membersDone ? 'disabled' : ''} style="font-size: 0.8rem; padding: 6px;" />
                    </div>
                    <button class="btn btn-checkin trigger-sig-code-btn" data-sig-id="${vpTask.id}" ${!membersDone ? 'disabled style="opacity: 0.6; cursor: not-allowed;"' : ''} style="width: 100%;">
                      ${membersDone ? 'Generate Signatory Code' : 'Complete Member Tasks to Unlock'}
                    </button>
                  ` : `
                    <small style="color: var(--brand-forest); font-weight: 600;">Officially endorsed by ${vpTask.signed_by || comm.vp}</small>
                  `}
                </div>
              ` : ''}

              <!-- Member Tasks with Dropdown -->
              <div style="display: flex; flex-direction: column; gap: 12px;">
                ${memberTasks.map((task, idx) => {
                  const rawTrait = task.trait_description || task.task || 'Committee Member';
                  const cleanedTrait = cleanTraitText(rawTrait);

                  return `
                    <div class="card" style="margin: 0; border-color: ${task.completed ? 'var(--brand-mint)' : 'var(--border-subtle)'}; background: ${task.completed ? 'var(--brand-mint-subtle)' : 'var(--surface)'};">
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span class="badge" style="background: var(--surface-subtle); color: var(--text-muted); font-weight: 600;">Member Task #${idx + 1}</span>
                        <span class="badge" style="background: ${task.completed ? 'var(--brand-mint)' : 'var(--surface-subtle)'}; color: ${task.completed ? '#fff' : 'inherit'};">
                          ${task.completed ? 'Completed' : 'Pending'}
                        </span>
                      </div>

                      <div style="margin-bottom: 10px;">
                        <strong style="display: block; font-size: 0.92rem; color: var(--brand-forest); margin-bottom: 4px;">
                          ${cleanedTrait}
                        </strong>
                        ${task.selected_task ? `
                          <div style="font-size: 0.82rem; color: var(--text-muted); background: var(--surface-subtle); padding: 6px 10px; border-radius: 4px; margin-top: 4px;">
                            <strong>Selected Task:</strong> ${task.selected_task}
                          </div>
                        ` : ''}
                      </div>

                      ${task.task_pool && task.task_pool.length > 0 && !task.selected_task && !task.completed ? `
                        <div style="margin-bottom: 10px;">
                          <label style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 4px;">Assign a Task:</label>
                          <select class="sig-task-select" data-sig-id="${task.id}" style="width: 100%; font-size: 0.82rem; padding: 6px;">
                            <option value="">-- Choose a task from pool --</option>
                            ${task.task_pool.map(t => `<option value="${t}">${t}</option>`).join('')}
                          </select>
                        </div>
                      ` : ''}

                      ${!task.completed ? `
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 10px;">
                          <!-- Member Name Dropdown -->
                          <select class="sig-input" data-sig-id="${task.id}" data-field="member_name" style="font-size: 0.8rem; padding: 6px;">
                            <option value="">-- Select Member --</option>
                            ${membersList.map(m => `
                              <option value="${m.full_name}" ${task.member_name === m.full_name ? 'selected' : ''}>
                                ${m.full_name}
                              </option>
                            `).join('')}
                          </select>

                          <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="nickname" placeholder="Nickname" value="${task.nickname || ''}" style="font-size: 0.8rem; padding: 6px;" />
                          <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="favorite_spot" placeholder="Favorite Spot" value="${task.favorite_spot || ''}" style="font-size: 0.8rem; padding: 6px;" />
                          <input type="text" class="sig-input" data-sig-id="${task.id}" data-field="least_liked_sub" placeholder="Least Liked Sub" value="${task.least_liked_sub || ''}" style="font-size: 0.8rem; padding: 6px;" />
                        </div>
                        <button class="btn btn-checkin trigger-sig-code-btn" data-sig-id="${task.id}" style="width: 100%;">
                          Generate Signatory Code
                        </button>
                      ` : `
                        <small style="color: var(--brand-forest); font-weight: 600;">Signed by ${task.signed_by || 'Verified Member'}</small>
                      `}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;

  filterCommitteeCards(activeCategory);

  const filterBar = container.querySelector('#committeeFilterBar');
  if (filterBar) {
    filterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.committee-filter-btn');
      if (!btn) return;

      activeCategory = btn.dataset.category;

      filterBar.querySelectorAll('.committee-filter-btn').forEach(b => {
        b.classList.remove('btn-checkin');
        b.classList.add('btn-secondary');
      });
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-checkin');

      filterCommitteeCards(activeCategory);
    });
  }

  function filterCommitteeCards(cat) {
    const cards = container.querySelectorAll('.committee-card');
    cards.forEach(card => {
      if (cat === 'ALL' || card.dataset.committee.toLowerCase() === cat.toLowerCase()) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  }

  container.querySelectorAll('.sig-task-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const val = e.target.value;
      const sigId = e.target.dataset.sigId;
      if (val && sigId) {
        await selectTaskForSignatory(sigId, val);
        showToast('Task assigned!', 'info');
        await renderSignatoriesTab(container);
      }
    });
  });

  container.querySelectorAll('.sig-input').forEach(inp => {
    inp.addEventListener('change', async (e) => {
      const sigId = e.target.dataset.sigId;
      const field = e.target.dataset.field;
      const val = e.target.value.trim();
      if (sigId && field) {
        await updateSignatoryAnswer(sigId, field, val);
      }
    });
  });

  container.querySelectorAll('.trigger-sig-code-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const sigId = e.target.dataset.sigId;
      if (!sigId) return;

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

      if (qrModal) {
        qrModal.style.display = 'block';
        const tambayTabBtn = document.querySelector('#applicantTabNav [data-tab="tab-tambay"]');
        if (tambayTabBtn) tambayTabBtn.click();
        qrModal.scrollIntoView({ behavior: 'smooth' });
      }

      showToast(`Verification code generated: ${code}`, 'success');
    });
  });
}
