let selectedDays = 7

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active')
        c.classList.add('hidden')
      })
      tab.classList.add('active')
      const target = document.getElementById(`tab-${tab.dataset.tab}`)
      if (target) {
        target.classList.remove('hidden')
        target.classList.add('active')
      }
    })
  })
}

function setBotActive(active) {
  const badge = document.getElementById('statusBadge')
  const statusText = badge.querySelector('.status-text')
  const activateBtn = document.getElementById('activateBtn')
  const deactivateBtn = document.getElementById('deactivateBtn')
  const hint = document.getElementById('statusHint')

  if (active) {
    badge.classList.add('active')
    badge.classList.remove('limited')
    statusText.textContent = 'Active'
    activateBtn.classList.add('hidden')
    deactivateBtn.classList.remove('hidden')
    hint.textContent = 'The bot is running and will screen incoming WhatsApp candidates.'
  } else {
    badge.classList.remove('active')
    badge.classList.remove('limited')
    statusText.textContent = 'Inactive'
    activateBtn.classList.remove('hidden')
    deactivateBtn.classList.add('hidden')
    hint.textContent = 'Activate the bot to begin screening candidates on WhatsApp.'
  }
}

async function loadSettings() {
  const data = await chrome.storage.local.get(['isActive'])
  setBotActive(!!data.isActive)
}

document.getElementById('activateBtn').addEventListener('click', async () => {
  await chrome.storage.local.set({ isActive: true })
  setBotActive(true)
})

document.getElementById('deactivateBtn').addEventListener('click', async () => {
  await chrome.storage.local.set({ isActive: false })
  setBotActive(false)
})

document.querySelectorAll('.day-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedDays = parseInt(btn.getAttribute('data-days'))
  })
})

document.getElementById('catchupScanBtn').addEventListener('click', () => {
  document.getElementById('catchupSetup').classList.add('hidden')
  document.getElementById('catchupScanning').classList.remove('hidden')
  document.getElementById('catchupScanStatus').textContent = 'Scanning chats...'
  document.getElementById('catchupScanBar').style.width = '0%'
  document.getElementById('catchupScanLabel').textContent = 'Starting...'

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
      }
    })
  })
})

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

function setNetworkBanner(online, queueCount) {
  const banner = document.getElementById('networkBanner')
  const text = document.getElementById('networkBannerText')
  if (!online) {
    banner.classList.remove('hidden')
    text.textContent = queueCount > 0
      ? `No internet � ${queueCount} message(s) queued, will retry when back online`
      : 'No internet connection � actions will retry when back online'
  } else {
    banner.classList.add('hidden')
  }
}

function updateKeyBanner(profile) {
  const banner = document.getElementById('keyBanner')
  const text = document.getElementById('keyBannerText')
  if (!banner || !text) return
  if (!profile || !profile.gemini_key) {
    banner.classList.remove('hidden')
    text.textContent = 'No Gemini API key saved in Dashboard. Save keys under Bot Settings to enable AI replies.'
  } else {
    banner.classList.add('hidden')
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'NETWORK_STATUS') {
    setNetworkBanner(!message.online, 0)
  }

  if (message.type === 'MESSAGE_QUEUED') {
    setNetworkBanner(false, message.count)
  }

  if (message.type === 'CATCHUP_PROGRESS') {
    const pct = Math.round((message.scanned / message.total) * 100)
    document.getElementById('catchupScanBar').style.width = pct + '%'
    document.getElementById('catchupScanLabel').textContent = `${message.scanned} / ${message.total} chats`
    document.getElementById('catchupScanStatus').textContent = `Scanning... found ${message.found} so far`
  }

  if (message.type === 'CATCHUP_SCAN_DONE') {
    document.getElementById('catchupScanning').classList.add('hidden')

    if (message.count === 0) {
      document.getElementById('catchupSetup').classList.remove('hidden')
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
        <button class="catchup-remove-btn" data-name="${name}" title="Skip this contact">?</button>
      </div>
    `).join('')

    list.querySelectorAll('.catchup-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-name')
        btn.closest('.catchup-candidate-item').remove()
        chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
          if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'CATCHUP_REMOVE', name })
          }
        })
        const remaining = list.querySelectorAll('.catchup-candidate-item').length
        document.getElementById('catchupFoundCount').textContent = remaining
        if (remaining === 0) showCatchupSetup()
      })
    })

    if (message.count > 10) {
      list.innerHTML += `<div class="catchup-candidate-item" style="color: var(--text-3)">+${message.count - 10} more...</div>`
    }
  }

  if (message.type === 'CATCHUP_RUNNING') {
    const pct = Math.round((message.current / message.total) * 100)
    document.getElementById('catchupRunBar').style.width = pct + '%'
    document.getElementById('catchupRunLabel').textContent = `${message.current} / ${message.total} replied`
    document.getElementById('catchupCurrentSender').textContent = `Now: ${message.sender}`
  }

  if (message.type === 'CATCHUP_COMPLETE') {
    document.getElementById('catchupRunning').classList.add('hidden')
    document.getElementById('catchupDone').classList.remove('hidden')
  }

  if (message.type === 'SESSION_INFO') {
    updateKeyBanner(message.profile)
  }
})

loadSettings()
initTabs()

// ask background for current session (background responds with { session })
chrome.runtime.sendMessage({ type: 'REQUEST_SESSION' }, (resp) => {
  if (resp && resp.session) {
    updateKeyBanner(resp.session.profile)
  } else {
    updateKeyBanner(null)
  }
})
