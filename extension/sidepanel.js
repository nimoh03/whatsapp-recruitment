
let selectedResetDays = 7
let selectedDays = 7
let requirements = [] // structured briefing requirements

// ─── TAB SWITCHING ────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.remove('active')
      c.classList.add('hidden')
    })
    tab.classList.add('active')
    const target = document.getElementById(`tab-${tab.dataset.tab}`)
    target.classList.remove('hidden')
    target.classList.add('active')
  })
})

// ─── STATS ────────────────────────────────────────────────────
function updateStats(conversations) {
  if (!conversations) return
  let screening = 0, qualified = 0, rejected = 0, attention = 0
  conversations.forEach(c => {
    if (c.status === 'screening') screening++
    else if (c.status === 'qualified') qualified++
    else if (c.status === 'rejected') rejected++
    else if (c.status === 'needs_owner') attention++
  })
  document.getElementById('statScreening').textContent = screening
  document.getElementById('statQualified').textContent = qualified
  document.getElementById('statRejected').textContent = rejected
  document.getElementById('statAttention').textContent = attention

  // Show red badge on Live Chats tab if anyone needs attention
  const badge = document.getElementById('attentionBadge')
  if (attention > 0) {
    badge.textContent = attention
    badge.classList.remove('hidden')
  } else {
    badge.classList.add('hidden')
  }
}

// ─── LOAD SETTINGS ────────────────────────────────────────────
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'geminiKey', 'groqKey', 'briefing',
    'tallyLink', 'isActive', 'triggerKeywords', 'unknownOnlyMode', 'sessionResetDays'
  ])

  if (settings.geminiKey)  document.getElementById('geminiKeyInput').value = settings.geminiKey
  if (settings.groqKey)    document.getElementById('groqKeyInput').value = settings.groqKey
 if (settings.briefing) {
    document.getElementById('briefingInput') && 
      (document.getElementById('briefingInput').value = settings.briefing)
    loadBriefingIntoForm(settings.briefing)
  }
  if (settings.tallyLink)  document.getElementById('tallyInput').value = settings.tallyLink
  if (settings.triggerKeywords) document.getElementById('keywordsInput').value = settings.triggerKeywords

  const unknownOnly = settings.unknownOnlyMode !== false
  document.getElementById('unknownOnlyToggle').checked = unknownOnly

  const resetDays = settings.sessionResetDays || 7
  document.querySelectorAll('[data-reset]').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.getAttribute('data-reset')) === resetDays)
  })

  if (settings.isActive) setBotActive(true)

  const stored = await chrome.storage.local.get(['conversations'])
  if (stored.conversations) {
    updateChatsList(stored.conversations)
    updateStats(stored.conversations)
  }

  updateUsageBar()
}
// ─── SAVE SETTINGS ────────────────────────────────────────────

// ─── ONBOARDING ───────────────────────────────────────────────
async function checkOnboarding() {
  const { geminiKey, briefing } = await chrome.storage.local.get(['geminiKey', 'briefing'])
  if (!geminiKey || !briefing) {
    document.getElementById('onboardingOverlay').classList.remove('hidden')
  }
}

document.getElementById('onboardStep1Btn').addEventListener('click', async () => {
  const key = document.getElementById('onboardGeminiKey').value.trim()
  if (!key) { alert('Please paste your Gemini API key'); return }
  await chrome.storage.local.set({ geminiKey: key })
  document.getElementById('geminiKeyInput').value = key
  document.getElementById('step1').classList.add('hidden')
  document.getElementById('step2').classList.remove('hidden')
})

document.getElementById('onboardBack1Btn').addEventListener('click', () => {
  document.getElementById('step2').classList.add('hidden')
  document.getElementById('step1').classList.remove('hidden')
})

document.getElementById('onboardStep2Btn').addEventListener('click', async () => {
  const briefing = document.getElementById('onboardBriefing').value.trim()
  if (!briefing) { alert('Please describe the job'); return }
  await chrome.storage.local.set({ briefing })
  loadBriefingIntoForm(briefing)
  document.getElementById('step2').classList.add('hidden')
  document.getElementById('step3').classList.remove('hidden')
})
document.getElementById('onboardBack2Btn').addEventListener('click', () => {
  document.getElementById('step3').classList.add('hidden')
  document.getElementById('step2').classList.remove('hidden')
})

document.getElementById('onboardActivateBtn').addEventListener('click', async () => {
  const { briefing } = await chrome.storage.local.get(['briefing'])
  await chrome.storage.local.set({ isActive: true })
  setBotActive(true)
  document.getElementById('onboardingOverlay').classList.add('hidden')
  document.getElementById('briefingHint').textContent = '✓ Bot is live. Screening candidates automatically.'
  document.getElementById('briefingHint').style.color = 'var(--accent)'
})

// ─── STRUCTURED BRIEFING ──────────────────────────────────────
function renderRequirements() {
  const list = document.getElementById('requirementsList')
  list.innerHTML = requirements.map((req, i) => `
    <div class="req-item">
      <input type="text" class="req-input field-input" value="${req}" 
        data-index="${i}" placeholder="e.g. Must own a motorcycle" />
      <button class="req-delete" data-index="${i}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `).join('')

  list.querySelectorAll('.req-input').forEach(input => {
    input.addEventListener('input', (e) => {
      requirements[parseInt(e.target.dataset.index)] = e.target.value
    })
  })

  list.querySelectorAll('.req-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      requirements.splice(parseInt(e.target.closest('.req-delete').dataset.index), 1)
      renderRequirements()
    })
  })
}

document.getElementById('addRequirementBtn').addEventListener('click', () => {
  requirements.push('')
  renderRequirements()
  // Focus the new input
  const inputs = document.querySelectorAll('.req-input')
  if (inputs.length) inputs[inputs.length - 1].focus()
})

function buildBriefingFromForm() {
  const title = document.getElementById('jobTitleInput').value.trim()
  const location = document.getElementById('jobLocationInput').value.trim()
  const reqs = requirements.filter(r => r.trim())
  const disqualify = document.getElementById('disqualifyInput').value.trim()

  let briefing = ''
  if (title) briefing += `Job Title: ${title}\n\n`
  if (location) briefing += `Location Requirement: ${location}\n\n`
  if (reqs.length) {
    briefing += `Requirements (screen in this order):\n`
    reqs.forEach((r, i) => briefing += `${i + 1}. ${r}\n`)
    briefing += '\n'
  }
  if (disqualify) briefing += `Immediately reject candidates who: ${disqualify}\n`
  return briefing.trim()
}

function loadBriefingIntoForm(briefingText) {
  // Try to parse structured briefing back into fields
  // Falls back gracefully if it's free-text
  const titleMatch = briefingText.match(/Job Title: (.+)/i)
  const locationMatch = briefingText.match(/Location Requirement: (.+)/i)
  const disqualifyMatch = briefingText.match(/Immediately reject candidates who: (.+)/i)

  if (titleMatch) document.getElementById('jobTitleInput').value = titleMatch[1]
  if (locationMatch) document.getElementById('jobLocationInput').value = locationMatch[1]
  if (disqualifyMatch) document.getElementById('disqualifyInput').value = disqualifyMatch[1]

  const reqSection = briefingText.match(/Requirements.*?:\n([\s\S]*?)(?:\n\n|$)/i)
  if (reqSection) {
    requirements = reqSection[1]
      .split('\n')
      .map(r => r.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean)
  } else {
    requirements = []
  }
  renderRequirements()
}

// ─── PASTE TO FILL ────────────────────────────────────────────
document.getElementById('pasteToggleBtn').addEventListener('click', () => {
  const area = document.getElementById('pasteArea')
  const isHidden = area.classList.contains('hidden')
  area.classList.toggle('hidden', !isHidden)
  if (isHidden) {
    document.getElementById('pasteInput').focus()
    document.getElementById('pasteToggleBtn').innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Close`
  } else {
    document.getElementById('pasteToggleBtn').innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Paste job description to auto-fill`
  }
})

document.getElementById('parseCancelBtn').addEventListener('click', () => {
  document.getElementById('pasteArea').classList.add('hidden')
  document.getElementById('pasteInput').value = ''
  document.getElementById('pasteToggleBtn').innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    Paste job description to auto-fill`
})

document.getElementById('parseDescBtn').addEventListener('click', async () => {
  const raw = document.getElementById('pasteInput').value.trim()
  if (!raw) { alert('Please paste a job description first'); return }

  const btn = document.getElementById('parseDescBtn')
  btn.textContent = 'Parsing...'
  btn.disabled = true

  try {
    const { geminiKey } = await chrome.storage.local.get(['geminiKey'])
    if (!geminiKey) {
      alert('Please save your Gemini API key in Settings first')
      btn.textContent = 'Parse & Fill Fields'
      btn.disabled = false
      return
    }

    const prompt = `Extract the following from this job description and return ONLY valid JSON, no markdown:

Job description:
"${raw}"

Return this exact JSON structure:
{
  "title": "job title or empty string",
  "location": "location requirement or empty string",
  "requirements": ["requirement 1", "requirement 2", "requirement 3"],
  "disqualify": "disqualification condition or empty string"
}

Rules:
- title: the job role name only (e.g. "Delivery Rider", "Sales Rep")
- location: where candidates must be based (e.g. "Lagos Island only")
- requirements: list of specific things candidates must have or be able to do. Each requirement should be one clear sentence.
- disqualify: hard dealbreakers that immediately disqualify a candidate (e.g. "No motorcycle, Outside Lagos")
- If something is not mentioned, use empty string or empty array
- Do not invent requirements not in the description`

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiKey}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, responseMimeType: 'application/json' }
      })
    })
    const data = await resp.json()
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!rawText) throw new Error('No response from AI')

    const cleaned = rawText.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)

    // Fill fields
    if (parsed.title) document.getElementById('jobTitleInput').value = parsed.title
    if (parsed.location) document.getElementById('jobLocationInput').value = parsed.location
    if (parsed.disqualify) document.getElementById('disqualifyInput').value = parsed.disqualify
    if (parsed.requirements?.length) {
      requirements = parsed.requirements.filter(r => r.trim())
      renderRequirements()
    }

    // Close the paste area
    document.getElementById('pasteArea').classList.add('hidden')
    document.getElementById('pasteInput').value = ''
    document.getElementById('pasteToggleBtn').innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Paste job description to auto-fill`

    // Show success hint
    const hint = document.getElementById('briefingHint')
    hint.textContent = '✓ Fields filled from your description — review and edit if needed'
    hint.style.color = 'var(--accent)'
    setTimeout(() => {
      if (hint.textContent.includes('filled from')) hint.textContent = ''
    }, 4000)

  } catch (e) {
    alert('Could not parse the description. Try simplifying the text and try again.')
  }

  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13 2v7h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Parse & Fill Fields`
  btn.disabled = false
})

// ─── TEST API KEY ─────────────────────────────────────────────
document.getElementById('testKeyBtn').addEventListener('click', async () => {
  const geminiKey = document.getElementById('geminiKeyInput').value.trim()
  if (!geminiKey) { alert('Paste your Gemini key first'); return }

  const btn = document.getElementById('testKeyBtn')
  const result = document.getElementById('testKeyResult')
  btn.textContent = 'Testing...'
  btn.disabled = true
  result.classList.remove('hidden')
  result.style.color = 'var(--text-3)'
  result.textContent = 'Checking key...'

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiKey}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
        generationConfig: { maxOutputTokens: 5 }
      })
    })
    const data = await resp.json()
    if (data.error) {
      result.textContent = `❌ Invalid key — ${data.error.message}`
      result.style.color = 'var(--red)'
    } else {
      result.textContent = '✓ Key is valid and working'
      result.style.color = 'var(--green)'
    }
  } catch (e) {
    result.textContent = '❌ Could not connect — check your internet'
    result.style.color = 'var(--red)'
  }

  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Test API Key`
  btn.disabled = false
})

// ─── SAVE SETTINGS ────────────────────────────────────────────

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const geminiKey = document.getElementById('geminiKeyInput').value.trim()
  const groqKey   = document.getElementById('groqKeyInput').value.trim()
  const keywords  = document.getElementById('keywordsInput').value.trim()
  const unknownOnly = document.getElementById('unknownOnlyToggle').checked

 if (!geminiKey) { alert('Please paste your Gemini API key first'); return }
  await chrome.storage.local.set({
    geminiKey, groqKey,
    triggerKeywords: keywords,
    unknownOnlyMode: unknownOnly,
    sessionResetDays: selectedResetDays
  })

  const successEl = document.getElementById('saveSuccess')
  successEl.classList.remove('hidden')
  setTimeout(() => successEl.classList.add('hidden'), 3000)
})
// ─── MODEL HINT ───────────────────────────────────────────────
// ─── USAGE BAR ────────────────────────────────────────────────
const TOTAL_DAILY = 15500

async function updateUsageBar() {
  const data = await chrome.storage.local.get(['modelCounters', 'modelCounterDate'])
  const today = new Date().toDateString()
  if (!data.modelCounters || data.modelCounterDate !== today) return

  const total = Object.values(data.modelCounters).reduce((a, b) => a + b, 0)
  const pct = Math.min(Math.round((total / TOTAL_DAILY) * 100), 100)

  document.getElementById('usageCount').textContent = `${total} requests used`
  document.getElementById('usageBar').style.width = pct + '%'

  if (pct >= 100) {
    document.getElementById('usageBar').style.background = 'var(--red)'
  } else if (pct >= 80) {
    document.getElementById('usageBar').style.background = 'var(--amber)'
  }
}

// ─── ACTIVATE BOT ─────────────────────────────────────────────
document.getElementById('activateBtn').addEventListener('click', async () => {
  const briefing  = buildBriefingFromForm()
  const tallyLink = document.getElementById('tallyInput').value.trim()
  const settings  = await chrome.storage.local.get(['geminiKey'])

  if (!settings.geminiKey) {
    alert('Please go to Settings and paste your Gemini API key first')
    return
  }
  if (!briefing) {
    alert('Please fill in at least the job title or one requirement before activating')
    return
  }

await chrome.storage.local.set({ isActive: true })
  setBotActive(true)
  document.getElementById('briefingHint').textContent = '✓ Bot is live. Screening candidates automatically.'
  document.getElementById('briefingHint').style.color = 'var(--accent)'
})

// ─── DEACTIVATE BOT ───────────────────────────────────────────
document.getElementById('deactivateBtn').addEventListener('click', async () => {
  await chrome.storage.local.set({ isActive: false })
  setBotActive(false)
  document.getElementById('briefingHint').textContent = 'Bot deactivated.'
  document.getElementById('briefingHint').style.color = ''
})

// ─── TOGGLE BOT UI STATE ──────────────────────────────────────
function setBotActive(active) {
  const badge       = document.getElementById('statusBadge')
  const statusText  = badge.querySelector('.status-text')
  const activateBtn = document.getElementById('activateBtn')
  const deactivateBtn = document.getElementById('deactivateBtn')

  if (active) {
    badge.classList.add('active')
    statusText.textContent = 'Active'
    activateBtn.classList.add('hidden')
    deactivateBtn.classList.remove('hidden')
  } else {
    badge.classList.remove('active')
    statusText.textContent = 'Inactive'
    activateBtn.classList.remove('hidden')
    deactivateBtn.classList.add('hidden')
  }
}

// ─── LIVE CHATS ───────────────────────────────────────────────
function updateChatsList(conversations) {
  const chatsList = document.getElementById('chatsList')
  currentConversations = conversations || []
  updateStats(conversations)
  if (!conversations || conversations.length === 0) {
    chatsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" 
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <p>No conversations yet</p>
        <span>Activate the bot and candidates will appear here in real time</span>
      </div>
    `
    return
  }

  const statusLabel = {
    screening:   'Screening',
    qualified:   'Qualified',
    rejected:    'Rejected',
    needs_owner: 'Needs You'
  }

chatsList.innerHTML = conversations.map(convo => `
    <div class="chat-card ${convo.needsOwner ? 'needs-owner' : ''}" data-sender="${convo.sender}" style="cursor:pointer">
      <div class="chat-card-top">
        <span class="chat-name">${convo.sender}</span>
        <span class="chat-status-pill status-${convo.status}">
          ${statusLabel[convo.status] || convo.status}
        </span>
      </div>
      <div class="chat-last">
        ${convo.role === 'user' ? '👤' : '🤖'} ${convo.lastMessage}
      </div>
      <div class="chat-meta">
        <span class="chat-count">${convo.messageCount} messages</span>
        ${convo.needsOwner ? '<span class="ping-label">⚠ Needs your reply</span>' : ''}
      </div>
      <button class="btn-reset" data-sender="${convo.sender}">↺ Reset Session</button>
    </div>
  `).join('')

document.querySelectorAll('.chat-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-reset')) return // don't open viewer when clicking reset
      openConversation(card.dataset.sender)
    })
  })

  document.querySelectorAll('.btn-reset').forEach(btn => {
    btn.addEventListener('click', () => {
      const sender = btn.getAttribute('data-sender')
      if (confirm(`Reset session for ${sender}?\n\nThis clears their history so they start fresh next time they message.`)) {
        chrome.runtime.sendMessage({ type: 'RESET_CANDIDATE', sender })
      }
    })
  })
}


document.querySelectorAll('[data-reset]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-reset]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedResetDays = parseInt(btn.getAttribute('data-reset'))
  })
})


// ─── CATCH-UP: DAY PICKER ─────────────────────────────────────


document.querySelectorAll('.day-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedDays = parseInt(btn.getAttribute('data-days'))
  })
})

// ─── CATCH-UP: START SCAN ─────────────────────────────────────
document.getElementById('catchupScanBtn').addEventListener('click', async () => {
  const settings = await chrome.storage.local.get(['geminiKey'])
  if (!settings.geminiKey) {
    alert('Please go to Settings and paste your Gemini API key first.')
    return
  }
  // Show scanning state
  document.getElementById('catchupSetup').classList.add('hidden')
  document.getElementById('catchupScanning').classList.remove('hidden')
  document.getElementById('catchupScanStatus').textContent = 'Scanning chats...'
  document.getElementById('catchupScanBar').style.width = '0%'
  document.getElementById('catchupScanLabel').textContent = 'Starting...'

  // Tell content script to start scanning
chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    if (tabs.length === 0) {
      alert('Please open WhatsApp Web first.')
      showCatchupSetup()
      return
    }
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'START_CATCHUP_SCAN',
      dayWindow: selectedDays
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Catch-up send error:', chrome.runtime.lastError.message)
        // Don't alert — content script may just need a moment
        // Switch to scanning state anyway and let it proceed
      }
    })
  })
})

// ─── CATCH-UP: CONFIRM & START ────────────────────────────────
document.getElementById('catchupStartBtn').addEventListener('click', () => {
  document.getElementById('catchupConfirm').classList.add('hidden')
  document.getElementById('catchupRunning').classList.remove('hidden')
  document.getElementById('catchupRunStatus').textContent = 'Responding to candidates...'
  document.getElementById('catchupRunBar').style.width = '0%'

  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'START_CATCHUP_PROCESS' })
    }
  })
})

document.getElementById('catchupCancelBtn').addEventListener('click', () => {
  showCatchupSetup()
})

document.getElementById('catchupResetBtn').addEventListener('click', () => {
  showCatchupSetup()
})

function showCatchupSetup() {
  document.getElementById('catchupSetup').classList.remove('hidden')
  document.getElementById('catchupScanning').classList.add('hidden')
  document.getElementById('catchupConfirm').classList.add('hidden')
  document.getElementById('catchupRunning').classList.add('hidden')
  document.getElementById('catchupDone').classList.add('hidden')
}

// ─── CONVERSATION VIEWER ──────────────────────────────────────
let currentConversations = []

document.getElementById('convoBackBtn').addEventListener('click', () => {
  document.getElementById('convoViewer').classList.add('hidden')
  document.getElementById('chatsList').classList.remove('hidden')
})

function openConversation(sender) {
  const convo = currentConversations.find(c => c.sender === sender)
  if (!convo || !convo.fullHistory) return

  document.getElementById('chatsList').classList.add('hidden')
  document.getElementById('convoViewer').classList.remove('hidden')
  document.getElementById('convoViewerName').textContent = sender
  document.getElementById('convoViewerStatus').textContent = convo.status

  const statusLabel = { screening: 'Screening', qualified: 'Qualified', rejected: 'Rejected', needs_owner: 'Needs You' }
  document.getElementById('convoViewerStatus').textContent = statusLabel[convo.status] || convo.status
  document.getElementById('convoViewerStatus').className = `convo-viewer-status status-${convo.status}`

  const messagesEl = document.getElementById('convoMessages')
  messagesEl.innerHTML = convo.fullHistory.map(msg => `
    <div class="convo-msg convo-msg-${msg.role}">
      <div class="convo-msg-bubble">${msg.content}</div>
    </div>
  `).join('')
  messagesEl.scrollTop = messagesEl.scrollHeight
}

// ─── NETWORK STATUS ───────────────────────────────────────────
function setNetworkBanner(online, queueCount) {
  const banner = document.getElementById('networkBanner')
  const text = document.getElementById('networkBannerText')
  if (!online) {
    banner.classList.remove('hidden')
    text.textContent = queueCount > 0
      ? `No internet — ${queueCount} message(s) queued, will retry when back online`
      : 'No internet connection — messages will retry when back online'
  } else {
    banner.classList.add('hidden')
  }
}

// ─── LISTEN FOR MESSAGES FROM BACKGROUND ─────────────────────
chrome.runtime.onMessage.addListener((message) => {

if (message.type === 'UPDATE_CONVERSATIONS') {
    updateChatsList(message.conversations)
  }

  if (message.type === 'NETWORK_STATUS') {
    setNetworkBanner(!message.online, 0)
  }

  if (message.type === 'MESSAGE_QUEUED') {
    setNetworkBanner(false, message.count)
  }

  if (message.type === 'DAILY_LIMIT_REACHED') {
    updateUsageBar()
    const badge = document.getElementById('statusBadge')
    badge.classList.remove('active')
    badge.classList.add('limited')
    badge.querySelector('.status-text').textContent = 'Limit Reached'
  }

  if (message.type === 'PING_OWNER') {
    // Switch to Live Chats tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.remove('active')
      c.classList.add('hidden')
    })
    document.querySelector('[data-tab="chats"]').classList.add('active')
    document.getElementById('tab-chats').classList.remove('hidden')
    document.getElementById('tab-chats').classList.add('active')

    chrome.storage.local.get(['conversations'], (data) => {
      if (data.conversations) updateChatsList(data.conversations)
    })
  }

  // Catch-up: scan progress
  if (message.type === 'CATCHUP_PROGRESS') {
    const pct = Math.round((message.scanned / message.total) * 100)
    document.getElementById('catchupScanBar').style.width = pct + '%'
    document.getElementById('catchupScanLabel').textContent = `${message.scanned} / ${message.total} chats`
    document.getElementById('catchupScanStatus').textContent = `Scanning... found ${message.found} so far`
  }

  // Catch-up: scan done — show confirm screen
 if (message.type === 'CATCHUP_SCAN_DONE') {
    document.getElementById('catchupScanning').classList.add('hidden')

    if (message.count === 0) {
      document.getElementById('catchupSetup').classList.remove('hidden')
      document.getElementById('catchupScanStatus').textContent = `No unanswered conversations found in the last ${selectedDays} days.`
      // Update the hint text instead of using an alert that interrupts scanning
      const hint = document.querySelector('#catchupSetup .field-hint')
      if (hint) hint.textContent = `No unanswered conversations found in the last ${selectedDays} days. Try a longer window.`
      return
    }

    document.getElementById('catchupFoundCount').textContent = message.count
    document.getElementById('catchupConfirm').classList.remove('hidden')

const list = document.getElementById('catchupCandidateList')
      list.innerHTML = message.candidates.slice(0, 10).map((name, i) => `
        <div class="catchup-candidate-item" data-index="${i}">
          <span>${name}</span>
          <button class="catchup-remove-btn" data-name="${name}" title="Skip this contact">✕</button>
        </div>
      `).join('')

      list.querySelectorAll('.catchup-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.getAttribute('data-name')
          btn.closest('.catchup-candidate-item').remove()
          // Tell content script to remove from queue
          chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
            if (tabs.length > 0) {
              chrome.tabs.sendMessage(tabs[0].id, { type: 'CATCHUP_REMOVE', name })
            }
          })
          // Update count
          const remaining = list.querySelectorAll('.catchup-candidate-item').length
          document.getElementById('catchupFoundCount').textContent = remaining
          if (remaining === 0) showCatchupSetup()
        })
      })

    if (message.count > 10) {
      list.innerHTML += `<div class="catchup-candidate-item" style="color: var(--text-3)">+${message.count - 10} more...</div>`
    }
  }

  // Catch-up: currently processing
  if (message.type === 'CATCHUP_RUNNING') {
    const pct = Math.round((message.current / message.total) * 100)
    document.getElementById('catchupRunBar').style.width = pct + '%'
    document.getElementById('catchupRunLabel').textContent = `${message.current} / ${message.total} replied`
    document.getElementById('catchupCurrentSender').textContent = `Now: ${message.sender}`
  }

  // Catch-up: all done
  if (message.type === 'CATCHUP_COMPLETE') {
    document.getElementById('catchupRunning').classList.add('hidden')
    document.getElementById('catchupDone').classList.remove('hidden')
  }
})

// ─── START ────────────────────────────────────────────────────
loadSettings()
// checkOnboarding()