// ─── STATE ────────────────────────────────────────────────────
let processedMessages = new Set()
let scanInterval = null
let botRunning = false
// Tracks senders who are mid-conversation.
// Persists in memory for the session; doesn't rely on DOM state.
let ongoingInterviews = new Set()

// Single unified lock — tracks the sender currently being processed.
// null = free, string = sender name being handled right now.
// Using one variable instead of isProcessing + processingChats Set
// eliminates the mismatch bug where two locks with different key strings
// would get stuck open.
let activeLock = null
let lockTimeout = null
let pendingReplies = new Set()
// ─── LOCK HELPERS ─────────────────────────────────────────────
function acquireLock(sender) {
  if (activeLock !== null) return false   // already locked
  activeLock = sender
  console.log(`WA Bot: 🔒 Lock acquired for "${sender}"`)
  // Hard safety cap: always release after 20s no matter what,
  // so a silent failure never permanently blocks the bot
  clearTimeout(lockTimeout)
 lockTimeout = setTimeout(() => {
    if (activeLock !== null) {
      console.warn(`WA Bot: ⚠️ Lock timeout reached for "${activeLock}" — force releasing`)
      releaseLock()
    }
  }, 35000)
  return true
}

function releaseLock() {
  console.log(`WA Bot: 🔓 Lock released (was: "${activeLock}")`)
  activeLock = null
  clearTimeout(lockTimeout)
  lockTimeout = null
}

// ─── BOOT ─────────────────────────────────────────────────────
function waitForWhatsApp() {
  console.log('WA Bot: Waiting for WhatsApp to load...')
  const observer = new MutationObserver(() => {
    const ready = document.querySelector('div[aria-label="Chat list"]')
      || document.querySelector('#pane-side')
    if (ready) {
      observer.disconnect()
      console.log('WA Bot: ✅ WhatsApp loaded')
      listenForActivation()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

// ─── ACTIVATION ───────────────────────────────────────────────
function listenForActivation() {
  chrome.storage.local.get(['isActive'], ({ isActive }) => {
    if (isActive) startBot()
  })
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.isActive) {
      changes.isActive.newValue ? startBot() : stopBot()
    }
  })
}

// ─── START / STOP ─────────────────────────────────────────────
function startBot() {
  if (botRunning) return
  botRunning = true
  console.log('WA Bot: ▶ Started')
  runScan()
 scanInterval = setInterval(runScan, 3000)
  document.addEventListener('visibilitychange', onVisibility)
}

function stopBot() {
  botRunning = false
  releaseLock()
  clearInterval(scanInterval)
  scanInterval = null
  document.removeEventListener('visibilitychange', onVisibility)
  console.log('WA Bot: ⏸ Stopped')
}

function onVisibility() {
  if (document.visibilityState === 'visible' && botRunning) runScan()
}

// ─── GET ALL UNPROCESSED INCOMING MESSAGES ────────────────────
// Returns messages in chronological order that haven't been
// processed yet. Handles the case where candidate sent multiple
// messages while bot was locked.
function getAllUnprocessedMessages(sender) {
  let containers = Array.from(document.querySelectorAll('.message-in [data-testid="msg-container"]'))
  if (containers.length === 0) containers = Array.from(document.querySelectorAll('.message-in'))
  if (containers.length === 0) {
    containers = Array.from(document.querySelectorAll('[data-testid="msg-container"]'))
      .filter(m => !m.closest('.message-out'))
  }

  const unprocessed = []

  for (const msg of containers) {
    const idEl = msg.closest('[data-id]')
    const msgId = idEl ? idEl.getAttribute('data-id') : null
 if (msgId && msgId.startsWith('true_')) continue
    if (msg.closest('.message-out')) continue
    if (!msgId) continue
    if (processedMessages.has(msgId)) continue

    let text = null
    const copyableText = msg.querySelector('.copyable-text')
    if (copyableText) text = copyableText.innerText?.trim()
    if (!text) {
      const selectable = msg.querySelector('[data-testid="selectable-text"]')
      if (selectable) text = selectable.innerText?.trim()
    }
    if (!text) {
      const ltrSpan = msg.querySelector('span[dir="ltr"]')
      if (ltrSpan) text = ltrSpan.innerText?.trim()
    }
    if (!text) {
      const anySpan = msg.querySelector('span')
      if (anySpan) text = anySpan.innerText?.trim()
    }
    if (!text) continue

    text = text.replace(/\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*$/i, '').trim()
    if (!text) continue

    // Junk filter
    const junkPattern = /^[\s\-\/\.\,\!\?\*\_\+\=\|\\\^~`@#$%^&]+$/
    if (junkPattern.test(text)) continue

    unprocessed.push({ text, dedupeKey: msgId, timestamp: Date.now() })
  }

  return unprocessed
}

// ─── CHECK CURRENTLY OPEN CHAT ────────────────────────────────
// Runs when no unread badge found but a chat is open.
// Catches new messages from ongoing conversations where badge
// was cleared because chat is visible on screen.
// Also handles recovery — if bot dropped mid-conversation and
// candidate sends a follow-up, we inject an apology context
// so the AI continues naturally.
async function checkOpenChatForNewMessages() {
  const header = document.querySelector('header')
  if (!header) return

  const sender = getSenderName(null)
  if (!sender) return

  // Only check senders we already have an ongoing conversation with
  if (!ongoingInterviews.has(sender)) return

  if (activeLock !== null) {
    console.log(`WA Bot: Open chat check skipped — lock busy`)
    return
  }

  if (pendingReplies.has(sender)) return
  if (!acquireLock(sender)) return

  console.log(`WA Bot: 👁 Checking open chat for new messages from "${sender}"`)

  await waitForMessages()

  const unprocessed = getAllUnprocessedMessages(sender)

  if (unprocessed.length === 0) {
    console.log(`WA Bot: Open chat — no new messages found`)
    releaseLock()
    return
  }

  console.log(`WA Bot: 👁 Found ${unprocessed.length} unprocessed message(s) from "${sender}"`)

  // Check if bot dropped mid-conversation — meaning there are
  // unprocessed messages but the last thing in history was the
  // bot asking a question with no reply recorded yet.
  // If so, prepend a recovery note so AI apologizes and continues.
  const hasMultiple = unprocessed.length > 1
  const followUpPhrases = ['are you there', 'hello', 'hi', 'you there', 'anyone', 'still there', 'okay', 'oya']
  const firstText = unprocessed[0].text.toLowerCase()
  const looksLikeFollowUp = followUpPhrases.some(p => firstText.includes(p))

  if (looksLikeFollowUp || hasMultiple) {
    console.log(`WA Bot: 🔄 Recovery scenario detected — injecting apology context`)
    // Inject a synthetic recovery message as the first thing forwarded
    // so the AI knows to apologize and pick up where it left off
    const recoveryKey = `${sender}:recovery:${Date.now()}`
    if (!processedMessages.has(recoveryKey)) {
      processedMessages.add(recoveryKey)
      // Build combined text — apology context + all unprocessed messages
      const combinedText = `[System note: The bot dropped mid-conversation. The candidate sent these follow-up messages: "${unprocessed.map(m => m.text).join('" then "')}". Apologize briefly, then continue screening from where you left off based on the conversation history.]`

      // Mark all unprocessed messages as handled so they don't double-fire
      unprocessed.forEach(m => processedMessages.add(m.dedupeKey))

      forwardToBackground(sender, recoveryKey, combinedText)
      return
    }
  }

  // Normal case — process messages one by one in order
  // Mark all as processed upfront to prevent double-fire
  unprocessed.forEach(m => processedMessages.add(m.dedupeKey))

  // Combine into one forwarded message if multiple
  // so AI gets full context in one call instead of rapid-firing
  if (unprocessed.length === 1) {
    const { text, dedupeKey } = unprocessed[0]
    console.log(`WA Bot: 👁 Forwarding — "${text}"`)
    forwardToBackground(sender, dedupeKey, text)
  } else {
    // Multiple messages — join them naturally
    const combined = unprocessed.map(m => m.text).join(' ')
    const combinedKey = `${sender}:combined:${Date.now()}`
    console.log(`WA Bot: 👁 Combining ${unprocessed.length} messages — "${combined}"`)
    forwardToBackground(sender, combinedKey, combined)
  }
}

// ─── MAIN SCAN LOOP ───────────────────────────────────────────
async function runScan() {
  if (!botRunning) return
  if (activeLock !== null) {
    console.log(`WA Bot: Scan skipped — busy with "${activeLock}"`)
    return
  }

  console.log('WA Bot: Scanning for unread chats...')
const unreadChat = findFirstUnreadChat()
  if (!unreadChat) {
    console.log('WA Bot: No unread chats found — checking open chat...')
    await checkOpenChatForNewMessages()
    return
  }

  // Read sender from the row before clicking so our lock key is consistent
  const senderFromRow = getSenderNameFromRow(unreadChat)
  const lockKey = senderFromRow || `unknown-${Date.now()}`

 if (pendingReplies.has(lockKey)) {
  console.log(`WA Bot: Reply pending for "${lockKey}" — skipping`)
  return
}

if (!acquireLock(lockKey)) {
  console.log(`WA Bot: Lock busy, skipping`)
  return
}


  setTimeout(() => processOpenChat(lockKey), 2500)
}


// ─── SIMULATE HUMAN CLICK ─────────────────────────────────────
// WhatsApp Web blocks plain .click() on outer row elements for unsaved numbers.
// We simulate a real mouse interaction sequence to force the chat to open.
function simulateClick(row) {
  const inner =
    row.querySelector("[data-testid=\"cell-frame-container\"]") ||
    row.querySelector("[role=\"button\"]") ||
    row

  ;["mouseenter", "mouseover", "mousedown", "mouseup", "click"].forEach(evtType => {
    inner.dispatchEvent(new MouseEvent(evtType, {
      view: window,
      bubbles: true,
      cancelable: true,
      buttons: 1
    }))
  })

  console.log("WA Bot: Simulated click on: " + (inner.getAttribute("data-testid") || inner.tagName))
}
// ─── FIND FIRST UNREAD CHAT ───────────────────────────────────
function findFirstUnreadChat() {
  const chatList = document.querySelector('div[aria-label="Chat list"]')
  if (!chatList) {
    console.log('WA Bot: Chat list not found')
    return null
  }

  const rows = Array.from(chatList.querySelectorAll('[role="row"], [role="listitem"]'))
  console.log(`WA Bot: Found ${rows.length} chat rows`)

  for (const row of rows) {
    const rowText = row.innerText || ''
    if (rowText.toLowerCase().includes('archived')) continue
    if (!hasUnreadBadge(row)) continue

    const senderName = getSenderNameFromRow(row)
    if (senderName) {
      const looksLikePhone = /^[+\d][\d\s\-().]{4,}$/.test(senderName)
      if (!looksLikePhone) {
        console.log(`WA Bot: ⏭ Skipping saved contact row "${senderName}"`)
        continue
      }
    }

    return row
  }

  return null
}

// ─── GET SENDER NAME FROM ROW (sidebar, before clicking) ──────
// For unsaved numbers, WhatsApp uses span[dir="ltr"] in the sidebar row.
// We try title attr first (saved contacts), then auto, then ltr.
function getSenderNameFromRow(row) {
  const titleSpan = row.querySelector('span[title]')
  if (titleSpan?.getAttribute('title')?.trim()) return titleSpan.getAttribute('title').trim()

  const autoSpan = row.querySelector('span[dir="auto"]')
  if (autoSpan?.innerText?.trim()) return autoSpan.innerText.trim()

  // Unsaved numbers show up as dir="ltr" in the sidebar
  const ltrSpan = row.querySelector('span[dir="ltr"]')
  if (ltrSpan?.innerText?.trim()) return ltrSpan.innerText.trim()

  return null
}

// ─── UNREAD BADGE DETECTION ───────────────────────────────────
function hasUnreadBadge(row) {
  // STRATEGY 1: aria-label — most stable
  const ariaUnread = row.querySelector('span[aria-label*="unread message"]')
  if (ariaUnread) {
    console.log(`WA Bot: Unread via aria-label: "${ariaUnread.getAttribute('aria-label')}"`)
    return true
  }

  // STRATEGY 2: data-testid
  if (row.querySelector('[data-testid="unread-count"]')) return true

  // STRATEGY 3: small numeric span (1–99, narrow width = badge pill)
  for (const span of row.querySelectorAll('span')) {
    const raw = span.textContent?.trim()
    if (!raw) continue
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n > 0 && n < 100 && raw === String(n)) {
      const rect = span.getBoundingClientRect()
      if (rect.width > 0 && rect.width < 28) return true
    }
  }

  return false
}

// ─── PROCESS THE CURRENTLY OPEN CHAT ─────────────────────────
async function processOpenChat(lockKey) {
  console.log(`WA Bot: Processing open chat (lock: "${lockKey}")`)

  try {
    const { isActive } = await chrome.storage.local.get(['isActive'])

    if (!isActive) {
      releaseLock()
      return
    }

    if (pendingReplies.has(lockKey)) {
      console.log(`WA Bot: Reply already pending for "${lockKey}" — releasing`)
      releaseLock()
      return
    }
    const sender = getSenderName(lockKey)
    if (!sender) { // Should never happen now — lockKey is always the fallback
      console.log('WA Bot: Could not determine sender name — releasing')
      releaseLock()
      return
    }
    console.log(`WA Bot: Sender: "${sender}"`)

    await waitForMessages()

   // ── COLLECT ALL NEW MESSAGES ────────────────────────────
    // Get every unprocessed incoming message, not just the last one.
    // This handles candidates who send multiple messages while bot was locked.
    const newMessages = getAllUnprocessedMessages(sender)

    // ── HANDLE NON-TEXT MESSAGES ────────────────────────────
    if (newMessages.length === 0) {
      const placeholderKey = `${sender}:[media]`
      if (!processedMessages.has(placeholderKey)) {
        console.log('WA Bot: No text — forwarding media placeholder to AI')
        processedMessages.add(placeholderKey)
        forwardToBackground(sender, placeholderKey, '[User sent a non-text message such as an image, voice note, or sticker. Ask them to please send a text message instead.]')
      } else {
        console.log('WA Bot: Media placeholder already sent — releasing quietly')
        releaseLock()
      }
      return
    }

    const outgoingCount = document.querySelectorAll('.message-out').length
    const conversationOngoing = ongoingInterviews.has(sender) || outgoingCount > 0

    if (!conversationOngoing && newMessages.length === 0) {
      console.log(`WA Bot: No new text messages found — releasing`)
      releaseLock()
      return
    }

    ongoingInterviews.add(sender)

    // Mark all new messages as processed
    newMessages.forEach(m => processedMessages.add(m.dedupeKey))

    // Combine into one message for the AI
   // If there are many "unprocessed" messages it's likely a reload artifact
    // Only use the last message to avoid dumping entire chat history to AI
    const messagesToSend = newMessages.length > 3 
      ? [newMessages[newMessages.length - 1]] 
      : newMessages
    const combinedText = messagesToSend.map(m => m.text).join(' ')
    const combinedKey = newMessages[newMessages.length - 1].dedupeKey

    console.log(`WA Bot: ✉ Forwarding to AI — "${combinedText}" (key: ${combinedKey.substring(0, 40)})`)
    forwardToBackground(sender, combinedKey, combinedText)

  } catch (err) {
    console.error('WA Bot: processOpenChat error —', err?.message || err?.toString() || 'unknown error', err?.stack)
    releaseLock()
  }
}

// ─── FORWARD MESSAGE TO BACKGROUND ───────────────────────────
function forwardToBackground(sender, msgKey, text) {
  if (!chrome.runtime?.id) {
    console.warn('WA Bot: Extension context invalid — releasing')
    releaseLock()
    return
  }

  pendingReplies.add(sender)

  chrome.runtime.sendMessage({
    type: 'NEW_MESSAGE',
    payload: { messageId: msgKey, sender, text }
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('WA Bot:', chrome.runtime.lastError.message)
      pendingReplies.delete(sender)
      releaseLock()
      return
    }

    console.log('WA Bot: ✅ Message sent to background')
   setTimeout(() => {
  pendingReplies.delete(sender)
  releaseLock()
}, 35000)
  })
}

// ─── GET SENDER NAME (from open chat header) ──────────────────
// Unsaved contacts: WhatsApp renders phone numbers with dir="ltr" (not dir="auto")
// so we must check both directions. We also fall back to the lockKey passed in
// from the sidebar scan so unsaved numbers are never lost.
function getSenderName(fallback) {
  const header = document.querySelector('header')
  if (header) {
    // Layer 1: data-testid — most stable
    const byTestId = header.querySelector(
      '[data-testid="conversation-info-header-chat-title"] span'
    )
    if (byTestId?.innerText?.trim()) return byTestId.innerText.trim()

    // Layer 2: dir="auto" = saved contact name
    const byAuto = header.querySelector('span[dir="auto"]')
    if (byAuto?.innerText?.trim()) return byAuto.innerText.trim()

    // Layer 3: dir="ltr" = unsaved phone number (e.g. +234 817 959 0478)
    const byLtr = header.querySelector('span[dir="ltr"]')
    if (byLtr?.innerText?.trim()) return byLtr.innerText.trim()

    // Layer 4: any span with a phone-number-like string
    const allSpans = header.querySelectorAll('span')
    for (const s of allSpans) {
      const t = s.innerText?.trim()
      if (t && /^[+\d][\d\s\-().]+$/.test(t) && t.length > 5) return t
    }
  }

  // Layer 5: fall back to the lock key we read from the sidebar before clicking
  if (fallback) {
    console.log('WA Bot: Header read failed — using sidebar fallback: "' + fallback + '"')
    return fallback
  }

  return null
}

// ─── WAIT FOR MESSAGES ────────────────────────────────────────
function waitForMessages() {
  return new Promise((resolve) => {
    const maxAttempts = 8
    let attempts = 0
    const check = setInterval(() => {
      const msgs = document.querySelectorAll('[data-testid="msg-container"]')
      if (msgs.length > 0 || ++attempts >= maxAttempts) {
        clearInterval(check)
        resolve()
      }
    }, 500)
  })
}

// ─── GET LAST INCOMING MESSAGE ────────────────────────────────
// Uses data-id for deduplication. Three strategies to find incoming bubbles
// because WhatsApp doesn't always wrap every message in msg-container.
function getLastIncomingMessage(sender) {
  // Strategy A: .message-in with msg-container testid (most specific)
  let containers = Array.from(document.querySelectorAll('.message-in [data-testid="msg-container"]'))
  console.log(`WA Bot: Strategy A found ${containers.length} containers`)

  // Strategy B: any .message-in element (catches bubbles without msg-container wrapper)
  if (containers.length === 0) {
    containers = Array.from(document.querySelectorAll('.message-in'))
    console.log(`WA Bot: Strategy B found ${containers.length} .message-in elements`)
  }

  // Strategy C: all msg-containers that aren't inside .message-out
  if (containers.length === 0) {
    containers = Array.from(document.querySelectorAll('[data-testid="msg-container"]'))
      .filter(m => !m.closest('.message-out'))
    console.log(`WA Bot: Strategy C found ${containers.length} non-outgoing containers`)
  }

  for (let i = containers.length - 1; i >= 0; i--) {
    const msg = containers[i]

    // Get the unique message ID from the closest data-id ancestor
    // data-id format: "true_PHONENUMBER_MSGID" (outgoing) or "false_PHONENUMBER_MSGID" (incoming)
    const idEl = msg.closest('[data-id]')
    const msgId = idEl ? idEl.getAttribute('data-id') : null

    // Skip if this is an outgoing message (data-id starts with "true_")
  if (msgId && msgId.startsWith('true_')) continue
    if (msg.closest('.message-out')) continue

    let text = null

    // Layer 1: .copyable-text — WhatsApp's outer text wrapper.
    // Using .innerText on this flattens ALL nested child nodes (slashes,
    // emojis, special chars, hyperlink-wrapped text) into clean plain text.
    const copyableText = msg.querySelector('.copyable-text')
    if (copyableText) text = copyableText.innerText?.trim()

    // Layer 2: data-testid="selectable-text" — WhatsApp's copy-text hook
    if (!text) {
      const selectableText = msg.querySelector('[data-testid="selectable-text"]')
      if (selectableText) text = selectableText.innerText?.trim()
    }

    // Layer 3: data-pre-plain-text wrapper spans
    if (!text) {
      const preText = msg.querySelector(
        '[data-pre-plain-text] span[dir="ltr"],' +
        '[data-pre-plain-text] span[dir="rtl"],' +
        '[data-pre-plain-text] span'
      )
      if (preText) text = preText.innerText?.trim()
    }

    // Layer 4: dir="ltr" span (unsaved number messages)
    if (!text) {
      const ltrSpan = msg.querySelector('span[dir="ltr"]')
      if (ltrSpan) text = ltrSpan.innerText?.trim()
    }

    // Layer 5: any span
    if (!text) {
      const anySpan = msg.querySelector('span')
      if (anySpan) text = anySpan.innerText?.trim()
    }

    // Layer 6: Nuclear — all spans, filter timestamps, pick longest
    if (!text) {
      const allSpans = Array.from(msg.querySelectorAll('span'))
      const candidates = allSpans
        .map(s => s.innerText?.trim())
        .filter(t => t && t.length > 2 && !/^\d{1,2}:\d{2}$/.test(t))
      if (candidates.length) {
        text = candidates.reduce((a, b) => (a.length >= b.length ? a : b))
      }
    }

    if (!text) continue

    // Strip trailing timestamps WhatsApp sometimes includes in copyable-text
    // e.g. "Yes I can sir / ma 6:42 AM" → "Yes I can sir / ma"
    text = text.replace(/\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*$/i, '').trim()

    if (!text) continue

    // Deduplicate by data-id (unique per message) — NOT by text content.
    // This is the key fix: "Yes" in turn 2 and "Yes" in turn 5 have different
    // data-ids so both get processed correctly.
   if (!msgId) {
      console.log(`WA Bot: No data-id on message — skipping to avoid dedup collision`)
      continue
    }

    const dedupeKey = msgId
    const isNew = !processedMessages.has(dedupeKey)

    console.log(`WA Bot: Extracted text: "${text.substring(0, 60)}" | id: ${msgId} | isNew: ${isNew}`)
    return { text, isNew, dedupeKey }
}

  return { text: null, isNew: false, dedupeKey: null }
}

// ─── TYPE AND SEND REPLY ──────────────────────────────────────
function typeReply(replyText) {
  console.log('WA Bot: Typing reply...')

  const inputBox =
    document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
    document.querySelector('[data-testid="conversation-compose-box-input"]')

  if (!inputBox) {
    console.log('WA Bot: ❌ Input box not found')
    return
  }

  inputBox.focus()
  document.execCommand('insertText', false, replyText)

const delay = 1000 + Math.floor(Math.random() * 1500)
  console.log(`WA Bot: Sending reply in ${delay}ms...`)

  setTimeout(() => {
    const sendBtn = document.querySelector('[data-testid="send"]')
    if (sendBtn) {
      sendBtn.click()
      console.log('WA Bot: ✅ Sent via button')
    } else {
      inputBox.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }))
      console.log('WA Bot: ✅ Sent via Enter key')
    }
  }, delay)
}

// ─── LISTEN FOR REPLY FROM BACKGROUND ────────────────────────
// Must return true to keep the message channel open for async responses.
// Must call sendResponse so background's callback doesn't get "port closed".
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SEND_REPLY') {
    console.log('WA Bot: 📨 SEND_REPLY received — typing now')
    typeReply(message.reply)
    sendResponse({ ok: true })
  }

  // When background signals a terminal status, remove from ongoingInterviews
  // so the sender's next fresh application starts clean.
if (message.type === 'INTERVIEW_ENDED') {
    console.log(`WA Bot: 🏁 Interview ended for ${message.sender} (${message.status}) — clearing session`)
    ongoingInterviews.delete(message.sender)
    // Do NOT clear processedMessages for this sender — keeping old message IDs
    // prevents the bot from re-reading its own outgoing messages as new incoming ones
    // after a session reset. The .message-out class check handles filtering now.
  }

  return true
})


// ─── CATCH-UP MODE ────────────────────────────────────────────
let catchupQueue = []
let catchupIndex = 0
let catchupRunning = false

async function runCatchupScan(dayWindow) {
  console.log(`WA Bot: 🔍 Starting catch-up scan — ${dayWindow} day window`)

  const wasRunning = botRunning
  if (wasRunning) {
    clearInterval(scanInterval)
    scanInterval = null
    console.log('WA Bot: ⏸ Live scan paused for catch-up')
  }

  const chatList = document.querySelector('div[aria-label="Chat list"]')
  if (!chatList) {
    console.log('WA Bot: ❌ Chat list not found')
    chrome.runtime.sendMessage({ type: 'CATCHUP_SCAN_DONE', count: 0, candidates: [] })
    if (wasRunning) scanInterval = setInterval(runScan, 5000)
    return
  }

  // Click the panel background to deselect any open chat
  const pane = document.querySelector('#pane-side')
  if (pane) pane.click()
  await sleep(1000)

  const rows = Array.from(chatList.querySelectorAll('[role="row"], [role="listitem"]'))
  const total = rows.length
  console.log(`WA Bot: 🔍 Found ${total} rows to scan`)

  // Store candidates with their context for smart processing
  // { senderName, lastText, hasHistory }
  const found = []
  let scanned = 0

  chrome.runtime.sendMessage({ type: 'CATCHUP_PROGRESS', scanned: 0, total, found: 0 })

  for (const row of rows) {
    scanned++

    const rowText = row.innerText || ''
    if (rowText.toLowerCase().includes('archived')) continue

    const senderName = getSenderNameFromRow(row)
    if (!senderName) continue

    // Only unsaved numbers (phone-like)
    const looksLikePhone = /^[+\d][\d\s\-().]{4,}$/.test(senderName)
    if (!looksLikePhone) continue

    // Skip if bot already has an active conversation with this sender
const data = await chrome.storage.local.get(['conversationHistory', 'catchupSkipList'])
    if (data.conversationHistory?.[senderName]) continue
    if (data.catchupSkipList?.includes(senderName)) {
      console.log(`WA Bot: ⏭ "${senderName}" — manually reset, skipping catch-up`)
      continue
    }

    // Click and wait for chat to fully render
    simulateClick(row)
    await sleep(2500)

    // Wait for messages to actually appear in DOM
   // Wait for messages to actually appear in DOM — up to 5 seconds
// Wait for ANY chat content to appear — messages, media, system messages
    let waited = 0
    while (
      document.querySelectorAll('.message-in, .message-out, [data-id]').length === 0
      && waited < 6000
    ) {
      await sleep(500)
      waited += 500
    }
    // Extra buffer for full render
    await sleep(1500)

console.log(`WA Bot: DOM check — message-in: ${document.querySelectorAll('.message-in').length}, message-out: ${document.querySelectorAll('.message-out').length}, data-id: ${document.querySelectorAll('[data-id]').length}`)
    
    // Debug: show first 3 data-id values so we know the format
    Array.from(document.querySelectorAll('[data-id]')).slice(0, 3).forEach(el => {
      console.log(`WA Bot: data-id="${el.getAttribute('data-id')}" classes="${el.className.substring(0, 60)}"`)
    })
const mainPanel = document.querySelector('#main') ||
      document.querySelector('[data-testid="conversation-panel-wrapper"]') ||
      document.querySelector('[data-testid="msg-container"]')?.closest('div[role]') ||
      document.body

   const allDataIds = Array.from(mainPanel.querySelectorAll('[data-id]'))
    console.log(`WA Bot: Found ${allDataIds.length} data-id elements inside main panel — panel tag="${mainPanel.tagName}" id="${mainPanel.id}" testid="${mainPanel.getAttribute('data-testid')}" rect=${JSON.stringify(mainPanel.getBoundingClientRect())}`)

    if (allDataIds.length === 0) {
      console.log(`WA Bot: ⏭ "${senderName}" — no messages visible, skipping`)
      chrome.runtime.sendMessage({ type: 'CATCHUP_PROGRESS', scanned, total, found: found.length })
      continue
    }

    // Detect incoming vs outgoing by horizontal position
    // Outgoing = right-aligned, incoming = left-aligned
  const chatPanel = mainPanel
    const panelWidth = chatPanel.getBoundingClientRect().width || window.innerWidth

   const lastEl = allDataIds[allDataIds.length - 1]
    const lastId = lastEl.getAttribute('data-id') || ''

    // Primary check: data-id starting with "true_" = outgoing (most reliable)
    // Secondary check: position-based (fallback)
    // Third check: delivery tick (double checkmark = outgoing)
    let lastIsIncoming = true

    if (lastId.startsWith('true_')) {
      lastIsIncoming = false
    } else if (!lastId.startsWith('false_')) {
      // No clear prefix — fall back to position
      const lastRect = lastEl.getBoundingClientRect()
      const panelLeft = chatPanel.getBoundingClientRect().left
      const relativeCenterX = (lastRect.left + lastRect.width / 2) - panelLeft
      const isRightAligned = relativeCenterX > panelWidth * 0.55
      const hasOutgoingTick = !!lastEl.querySelector(
        '[data-testid="msg-dblcheck"], [data-testid="msg-check"]'
      )
      lastIsIncoming = !isRightAligned && !hasOutgoingTick
    }
console.log(`WA Bot: Last msg id="${lastId.substring(0, 20)}" lastIsIncoming=${lastIsIncoming}`)

    if (!lastIsIncoming) {
      console.log(`WA Bot: ✅ "${senderName}" — last message is outgoing, already replied`)
      chrome.runtime.sendMessage({ type: 'CATCHUP_PROGRESS', scanned, total, found: found.length })
      continue
    }

    // Extract text from last incoming element
    let lastText = null
    const copyable = lastEl.querySelector('.copyable-text')
    if (copyable) lastText = copyable.innerText?.trim()
    if (!lastText) {
      const selectable = lastEl.querySelector('[data-testid="selectable-text"]')
      if (selectable) lastText = selectable.innerText?.trim()
    }
    if (!lastText) {
      const ltrSpan = lastEl.querySelector('span[dir="ltr"], span[dir="auto"]')
      if (ltrSpan) lastText = ltrSpan.innerText?.trim()
    }
    if (!lastText) lastText = 'Hello'
    if (lastText) lastText = lastText.replace(/\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*$/i, '').trim()

    if (!lastText) {
      console.log(`WA Bot: ⏭ "${senderName}" — no readable text, skipping`)
      chrome.runtime.sendMessage({ type: 'CATCHUP_PROGRESS', scanned, total, found: found.length })
      continue
    }

    const hasHistory = allDataIds.length > 1

    console.log(`WA Bot: 📬 "${senderName}" — unanswered | hasHistory=${hasHistory} | lastText="${lastText.substring(0, 40)}"`)
    found.push({ senderName, lastText, hasHistory })

    chrome.runtime.sendMessage({ type: 'CATCHUP_PROGRESS', scanned, total, found: found.length })
    await sleep(500)
  }

  console.log(`WA Bot: ✅ Scan complete — ${found.length} unanswered chats`)
  catchupQueue = found

  if (wasRunning && !scanInterval) {
scanInterval = setInterval(runScan, 3000)
    console.log('WA Bot: ▶ Live scan resumed')
  }

  chrome.runtime.sendMessage({
    type: 'CATCHUP_SCAN_DONE',
    count: found.length,
    candidates: found.map(f => f.senderName)
  })
}

async function runCatchupProcess() {
  if (catchupQueue.length === 0) {
    chrome.runtime.sendMessage({ type: 'CATCHUP_COMPLETE' })
    return
  }

  // Pause live scan during processing
  const wasRunning = botRunning
  if (wasRunning) {
    clearInterval(scanInterval)
    scanInterval = null
    console.log('WA Bot: ⏸ Live scan paused for catch-up processing')
  }

  catchupRunning = true
  catchupIndex = 0
  const total = catchupQueue.length

 for (const queueItem of catchupQueue) {
    const senderName = queueItem.senderName
    const { lastText, hasHistory } = queueItem
    catchupIndex++
    console.log(`WA Bot: 📤 Catch-up processing ${catchupIndex}/${total} — "${senderName}"`)

    chrome.runtime.sendMessage({
      type: 'CATCHUP_RUNNING',
      current: catchupIndex,
      total,
      sender: senderName
    })

    const chatList = document.querySelector('div[aria-label="Chat list"]')
    if (!chatList) break

    const rows = Array.from(chatList.querySelectorAll('[role="row"], [role="listitem"]'))
    let targetRow = null

    for (const row of rows) {
      const name = getSenderNameFromRow(row)
      if (name === senderName) { targetRow = row; break }
    }
    if (!targetRow) {
      console.log(`WA Bot: ⚠️ Could not find row for "${senderName}" — skipping`)
      continue
    }
simulateClick(targetRow)
    await sleep(2500)

    if (!lastText) {
      console.log(`WA Bot: ⚠️ No text for "${senderName}" — skipping`)
      continue
    }

    // Second click to ensure chat is open and rendered
    simulateClick(targetRow)
    await sleep(2500)

    // Double-check: if the last visible message is now outgoing, 
    // the bot already replied — skip to avoid double reply
    const mainPanel = document.querySelector('#main') || document.body
    const allIds = Array.from(mainPanel.querySelectorAll('[data-id]'))
    if (allIds.length > 0) {
      const lastId = allIds[allIds.length - 1].getAttribute('data-id')
      if (lastId && lastId.startsWith('true_')) {
        console.log(`WA Bot: ⏭ "${senderName}" — last message is outgoing, already replied — skipping`)
        continue
      }
      // Also check position-based
      const panelRect = (document.querySelector('#main') || document.body).getBoundingClientRect()
      const lastEl = allIds[allIds.length - 1]
      const lastRect = lastEl.getBoundingClientRect()
      const relativeCenterX = (lastRect.left + lastRect.width / 2) - panelRect.left
      if (relativeCenterX > panelRect.width * 0.55) {
        console.log(`WA Bot: ⏭ "${senderName}" — last message is right-aligned (outgoing) — skipping`)
        continue
      }
    }

   // Get the actual data-id for dedup
    // Skip if last message is outgoing (data-id starts with true_)
    const { dedupeKey, text: lastMsgText } = getLastIncomingMessage(senderName)
    if (!dedupeKey || dedupeKey.startsWith('true_')) {
      console.log(`WA Bot: ⏭ Last message is outgoing for "${senderName}" — skipping catch-up`)
      continue
    }
    const msgKey = `${senderName}:catchup:${dedupeKey || Date.now()}`
    // Build smart context message based on history
    let contextText
    if (!hasHistory) {
      // Fresh conversation — treat as first contact
      contextText = lastText
    } else {
      // Existing conversation — tell AI to pick up where it left off
      contextText = `[System note: This candidate messaged before and the conversation was not completed. Their last message was: "${lastText}". Review the conversation history and continue screening naturally from where it left off. If the last question was already asked, move to the next step.]`
    }

    processedMessages.add(msgKey)
    ongoingInterviews.add(senderName)

    await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'NEW_MESSAGE',
        payload: {
          messageId: msgKey,
          sender: senderName,
          text: contextText
        }
      }, () => resolve())
    })

    // Wait for AI to respond and reply to be sent before moving on
    // 15s gives enough time for API call + typing delay
    await sleep(15000)
  }

catchupRunning = false

  // Resume live scan
  if (wasRunning && !scanInterval) {
scanInterval = setInterval(runScan, 3000)
    console.log('WA Bot: ▶ Live scan resumed after catch-up processing')
  }

  console.log('WA Bot: ✅ Catch-up complete')
  chrome.runtime.sendMessage({ type: 'CATCHUP_COMPLETE' })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── CATCH-UP MESSAGE LISTENER ────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_CATCHUP_SCAN') {
    runCatchupScan(message.dayWindow || 7)
    sendResponse({ ok: true })
  }

if (message.type === 'START_CATCHUP_PROCESS') {
    runCatchupProcess()
    sendResponse({ ok: true })
  }

  if (message.type === 'CATCHUP_REMOVE') {
    catchupQueue = catchupQueue.filter(q => q.senderName !== message.name)
    console.log(`WA Bot: 🗑 Removed "${message.name}" from catch-up queue`)
    sendResponse({ ok: true })
  }
})

// ─── NETWORK MONITORING ───────────────────────────────────────
function setupNetworkMonitoring() {
  function notifyOnline() {
    console.log('WA Bot: 🌐 Network online')
    chrome.runtime.sendMessage({ type: 'NETWORK_ONLINE' }).catch(() => {})
  }
  function notifyOffline() {
    console.log('WA Bot: 📵 Network offline')
    chrome.runtime.sendMessage({ type: 'NETWORK_OFFLINE' }).catch(() => {})
  }

  window.addEventListener('online', notifyOnline)
  window.addEventListener('offline', notifyOffline)

  // Send initial state
  if (!navigator.onLine) notifyOffline()
}

setupNetworkMonitoring()

// ─── RESTORE ONGOING INTERVIEWS FROM STORAGE ──────────────────
// ─── RESTORE ONGOING INTERVIEWS FROM STORAGE ──────────────────
// ongoingInterviews is in-memory only. On extension reload it's
// empty, so we repopulate it from background conversation state
// so the open chat checker can still pick up ongoing sessions.
async function restoreOngoingInterviews() {
  try {
    const data = await chrome.storage.local.get(['conversationHistory'])
    if (data.conversationHistory) {
      Object.keys(data.conversationHistory).forEach(sender => {
        ongoingInterviews.add(sender)
        console.log(`WA Bot: 🔄 Restored ongoing interview: "${sender}"`)
      })
    }
  } catch (e) {
    console.warn('WA Bot: Could not restore ongoing interviews —', e.message)
  }
}

// ─── START ────────────────────────────────────────────────────
restoreOngoingInterviews().then(() => waitForWhatsApp())