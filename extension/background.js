// ADD THIS AT THE VERY TOP
const DASHBOARD_DOMAIN = "localhost"; // Change to your actual domain when you deploy
const SUPABASE_PROJECT_ID = "iwdvkljbvbftbjmzvmqe"; // Your Project ID from the URL you sent
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3ZHZrbGpidmJmdGJqbXp2bXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjM4MTcsImV4cCI6MjA5NzE5OTgxN30.QMIdhha3Tn846MFuAhJ1Jtu6O0G04K5l-XvVwTeMWrA"; // Paste your public anon key here

// THE COOKIE STEALER
async function getSupabaseSession() {
  return new Promise((resolve) => {
    // Lead Dev Fix: We search by DOMAIN "localhost" instead of "http://localhost:3000"
    chrome.cookies.getAll({ domain: "localhost" }, (cookies) => {
      
      console.log("Lead Dev: Found " + (cookies ? cookies.length : 0) + " total localhost cookies.");

      if (!cookies || cookies.length === 0) {
        console.warn("Lead Dev: Still no cookies. Trying 127.0.0.1...");
        // Backup: Try the IP address version of localhost
        chrome.cookies.getAll({ domain: "127.0.0.1" }, (cookiesIp) => {
           processCookies(cookiesIp, resolve);
        });
        return;
      }

      processCookies(cookies, resolve);
    });
  });
}

// Helper to keep code clean
function processCookies(cookies, resolve) {
  const authCookie = cookies.find(c => c.name.includes("-auth-token"));
  if (authCookie) {
    const sessionData = JSON.parse(decodeURIComponent(authCookie.value));
    console.log("Lead Dev: ✅ SESSION FOUND!", sessionData.user.email);
    resolve(sessionData);
  } else {
    console.log("Found names:", cookies.map(c => c.name));
    resolve(null);
  }
}
// Trigger this check as soon as the background script loads
getSupabaseSession();

// ─── KEEPALIVE ────────────────────────────────────────────────
setInterval(() => {
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => console.log('WA Bot: keepalive')
      }).catch(() => {})
    }
  })
}, 20000)

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id })
})

// ─── STATE ────────────────────────────────────────────────────
let conversations = {}
let candidateStatus = {}
let lastReplyPerSender = {}
let lastProcessedId = {}
let lastMessageTime = {}

// ─── NETWORK STATE ────────────────────────────────────────────
let isOnline = true
let retryQueue = [] // { payload, retryCount, addedAt }
let retryInterval = null

function startRetryLoop() {
  if (retryInterval) return
  retryInterval = setInterval(async () => {
    if (!isOnline || retryQueue.length === 0) return
    console.log(`WA Bot BG: 🔄 Retrying ${retryQueue.length} queued message(s)...`)
    const batch = [...retryQueue]
    retryQueue = []
    for (const item of batch) {
      await handleNewMessage(item.payload)
    }
  }, 15000) // retry every 15s when online
}

function stopRetryLoop() {
  clearInterval(retryInterval)
  retryInterval = null
}

// Listen for online/offline from content script
chrome.runtime.onMessage.addListener((message) => {
 if (message.type === 'NETWORK_ONLINE') {
    isOnline = true
    console.log('WA Bot BG: 🌐 Network online')
    chrome.runtime.sendMessage({ type: 'NETWORK_STATUS', online: true }).catch(() => {})
    // Immediately process retry queue if anything is waiting
    if (retryQueue.length > 0) {
      console.log(`WA Bot BG: 🔄 Network back — processing ${retryQueue.length} queued message(s)`)
      const batch = [...retryQueue]
      retryQueue = []
      batch.forEach(item => handleNewMessage(item.payload))
    }
  }
if (message.type === 'NETWORK_OFFLINE') {
    isOnline = false
    console.log('WA Bot BG: 📵 Network lost')
    chrome.runtime.sendMessage({ type: 'NETWORK_STATUS', online: false }).catch(() => {})
  }
})

startRetryLoop()

// REPLACE your old checkConnectivity with this:
async function checkConnectivity() {
  // navigator.onLine is built into the browser. No fetch needed!
  const online = navigator.onLine; 
  
  if (online && !isOnline) {
    isOnline = true;
    console.log('WA Bot BG: 🌐 Network restored');
    chrome.runtime.sendMessage({ type: 'NETWORK_STATUS', online: true }).catch(() => {});
  } else if (!online && isOnline) {
    isOnline = false;
    console.log('WA Bot BG: 📵 Network lost');
    chrome.runtime.sendMessage({ type: 'NETWORK_STATUS', online: false }).catch(() => {});
  }
}

// ─── FREE TIER MODEL POOL ─────────────────────────────────────

// ─── MODEL COUNTER HELPERS ────────────────────────────────────
async function getModelCounters() {
  const data = await chrome.storage.local.get(['modelCounters', 'modelCounterDate'])
  const today = new Date().toDateString()

  // Reset counters if it's a new day
  if (data.modelCounterDate !== today) {
    const fresh = {}
    FREE_MODELS.forEach(m => fresh[m.id] = 0)
    await chrome.storage.local.set({ modelCounters: fresh, modelCounterDate: today })
    console.log('WA Bot BG: 🔄 Model counters reset for new day')
    return fresh
  }

  return data.modelCounters || {}
}

async function incrementModelCounter(modelId) {
  const counters = await getModelCounters()
  counters[modelId] = (counters[modelId] || 0) + 1
  await chrome.storage.local.set({ modelCounters: counters })
}

async function getNextFreeModel() {
  const counters = await getModelCounters()
  const { groqKey } = await chrome.storage.local.get(['groqKey'])

  for (const model of FREE_MODELS) {
    // Skip Groq models if no Groq key provided
    if (model.provider === 'groq' && !groqKey) {
      console.log(`WA Bot BG: ⏭ Skipping Groq model "${model.id}" — no Groq key`)
      continue
    }
    const used = counters[model.id] || 0
    if (used < model.softCap) {
      console.log(`WA Bot BG: 🎯 Using model "${model.id}" (${used}/${model.softCap})`)
      return model
    }
    console.log(`WA Bot BG: ⛔ Model "${model.id}" exhausted (${used}/${model.softCap})`)
  }

  console.log('WA Bot BG: ❌ All available models exhausted for today')
  return null
}

// ─── INTENT DETECTION ─────────────────────────────────────────
// Called only on the very first message from a new sender.
// Makes a lightweight AI call to decide if the message is job-related.
// Returns true = engage, false = ignore silently.
async function checkIntent(geminiKey, groqKey, briefing, text) {
 const prompt = `You are a filter for a recruitment bot.

A person just sent this first message: "${text}"

The recruiter is hiring for:
${briefing}

Is this person likely messaging about the job? Consider:
- Greetings like "hello", "hi", "good morning", "good day sir", "please I saw your job" are job inquiries
- Short polite openers are job inquiries — people often just say hi before asking about the job
- Clearly personal messages ("can you pick me up", "did you see the match", "send me money") are not
- Anything ambiguous should be treated as job-related (return true)
- Informal language, pidgin, or broken English does not make a message non-job-related
- Only return false if you are very confident the message has nothing to do with work or jobs

Respond with ONLY valid JSON, nothing else:
{"isJobRelated": true} or {"isJobRelated": false}`

  try {
    let rawText = null

    // Use next available free model for intent check
    const model = await getNextFreeModel()
    if (!model) {
      console.warn('WA Bot BG: No free model available for intent check — defaulting to engage')
      return true
    }

    await incrementModelCounter(model.id)

    if (model.provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${geminiKey}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 20 }
        })
      })
      const data = await resp.json()
      rawText = data.candidates?.[0]?.content?.parts?.[0]?.text

    } else if (model.provider === 'groq') {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: model.id,
          max_tokens: 20,
          messages: [{ role: 'user', content: prompt }]
        })
      })
      const data = await resp.json()
      rawText = data.choices?.[0]?.message?.content
    }

    if (!rawText) return true // fail open — if AI fails, engage anyway

    const cleaned = rawText.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return parsed.isJobRelated !== false // default true if missing

  } catch (e) {
    console.warn('WA Bot BG: Intent check failed —', e.message, '— defaulting to engage')
    return true // fail open
  }
}

// ─── RESTORE STATE ON BOOT ────────────────────────────────────
async function restoreState() {
const data = await chrome.storage.local.get(['conversationHistory', 'candidateStatus', 'lastMessageTime'])
if (data.conversationHistory) {
  conversations = data.conversationHistory
  console.log(`WA Bot BG: Restored ${Object.keys(conversations).length} conversations`)
}
if (data.candidateStatus) {
  candidateStatus = data.candidateStatus
}
if (data.lastMessageTime) {
  lastMessageTime = data.lastMessageTime
}
}
restoreState()

// ─── SAVE STATE ───────────────────────────────────────────────
async function persistState() {
  await chrome.storage.local.set({
    conversationHistory: conversations,
    candidateStatus: candidateStatus,
    lastMessageTime: lastMessageTime
  })
}

// ─── INCOMING MESSAGE HANDLER ─────────────────────────────────
// NEW
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NEW_MESSAGE') {
    handleNewMessage(message.payload)
    sendResponse({ ok: true })
  }

  if (message.type === 'RESET_CANDIDATE') {
    const s = message.sender
    delete conversations[s]
    delete candidateStatus[s]
    delete lastReplyPerSender[s]
    delete lastMessageTime[s]
    // Mark as manually reset so catch-up doesn't re-engage
    chrome.storage.local.get(['catchupSkipList'], (data) => {
      const skipList = data.catchupSkipList || []
      if (!skipList.includes(s)) {
        skipList.push(s)
        chrome.storage.local.set({ catchupSkipList: skipList })
      }
    })
    persistState().then(() => broadcastUpdate())
    console.log(`WA Bot BG: 🗑 Reset candidate: ${s}`)
    sendResponse({ ok: true })
  }

  return true
})

async function handleNewMessage({ messageId, sender, text }) {
  console.log(`WA Bot BG: ── NEW_MESSAGE ──────────────────────`)
  console.log(`WA Bot BG: sender="${sender}" | messageId="${messageId}"`)
  console.log(`WA Bot BG: text="${text}"`)

  // Dedup guard
if (lastProcessedId[sender] === messageId) {
  console.log(`WA Bot BG: Duplicate messageId for ${sender} — skipping`)
  return
}
lastProcessedId[sender] = messageId

  // Per-sender cooldown (8s)
  const now = Date.now()
  const lastReply = lastReplyPerSender[sender] || 0
  if (now - lastReply < 8000) {
    console.log(`WA Bot BG: Cooldown active for ${sender} — skipping`)
    return
  }

  // REPLACE WITH THIS
const session = await getSupabaseSession();
if (!session) {
    console.log("WA Bot BG: ❌ User not logged into Dashboard. Ignoring.");
    return;
}

const accessToken = session.access_token;

// 1. Fetch Active Jobs for this recruiter from Supabase
const jobsResp = await fetch(`https://${SUPABASE_PROJECT_ID}.supabase.co/rest/v1/jobs?is_active=eq.true`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${accessToken}` }
});
const activeJobs = await jobsResp.json();

// 2. Fetch API Keys from Profiles table
const profileResp = await fetch(`https://${SUPABASE_PROJECT_ID}.supabase.co/rest/v1/profiles?id=eq.${session.user.id}`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${accessToken}` }
});
const profile = await profileResp.json();

const geminiKey = profile[0]?.gemini_key;
const groqKey = profile[0]?.groq_key;

if (activeJobs.length === 0 || !geminiKey) {
    console.log("WA Bot BG: ❌ No active jobs or Gemini Key found in Supabase.");
    return;
}

  // ── SESSION EXPIRY ─────────────────────────────────────────
  const resetMs = (settings.sessionResetDays || 7) * 24 * 60 * 60 * 1000
  const lastTime = lastMessageTime[sender] || 0
  const isExpired = conversations[sender] && (now - lastTime > resetMs)

  if (isExpired) {
    console.log(`WA Bot BG: ⏰ Session expired for ${sender} — resetting`)
    delete conversations[sender]
    delete candidateStatus[sender]
  }

// ── JUNK MESSAGE FILTER ────────────────────────────────────
  // Drop messages that are pure symbols, single characters, or
  // whitespace — these are accidental taps or UI artifacts.
  // Numbers are allowed through because "10" is a valid answer.
  const junkPattern = /^[\s\-\/\.\,\!\?\*\_\+\=\|\\\^~`@#$%^&]+$/
  if (junkPattern.test(text.trim())) {
    console.log(`WA Bot BG: ⏭ Junk message filtered — "${text}" — ignoring`)
    return
  }

  // ── INTENT CHECK (new senders only) ───────────────────────
  if (!conversations[sender]) {
    console.log(`WA Bot BG: 🆕 New sender — running intent check for ${sender}`)

   const isJobRelated = await checkIntent(
      settings.geminiKey,
      settings.groqKey,
      settings.briefing,
      text
    )

    if (!isJobRelated) {
      console.log(`WA Bot BG: ⏭ Intent check failed — not job-related, pinging owner`)
      candidateStatus[sender] = 'needs_owner'
      await persistState()
      broadcastUpdate()
      chrome.notifications.create(`ping-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon.png'),
        title: '⚠️ WA Recruit needs you',
        message: `${sender} sent something unrelated to the job. Please handle manually.`
      })
      return
    }

    console.log(`WA Bot BG: ✅ Intent confirmed — starting conversation for ${sender}`)
    conversations[sender] = []
  }

  // Update last message timestamp
  lastMessageTime[sender] = now

  // ── ALREADY REJECTED ───────────────────────────────────────
  if (candidateStatus[sender] === 'rejected') {
    console.log(`WA Bot BG: ${sender} already rejected — ignoring`)
    return
  }

  conversations[sender].push({ role: 'user', content: text })
  broadcastUpdate()

  console.log(`WA Bot BG: Calling AI (provider=${settings.provider})...`)

  // ── CALL AI ────────────────────────────────────────────────
  const MAX_HISTORY = 8
  const trimmedHistory = conversations[sender].slice(-MAX_HISTORY)

// REPLACE WITH THIS
const aiResult = await callAI('freetier', geminiKey, groqKey, activeJobs, '', trimmedHistory)

if (!aiResult) {
    console.log('WA Bot BG: ❌ AI returned null — check provider logs above')
    // If offline, queue for retry
    if (!isOnline) {
      const existing = retryQueue.find(q => q.payload.sender === sender)
      if (!existing) {
        retryQueue.push({ payload: { messageId, sender, text }, retryCount: 0, addedAt: Date.now() })
        console.log(`WA Bot BG: 📥 Queued message from ${sender} for retry when online`)
        chrome.runtime.sendMessage({ type: 'MESSAGE_QUEUED', sender, count: retryQueue.length }).catch(() => {})
      }
    }
    return
  }

  const { replyMessage, status, reason } = aiResult
  console.log(`WA Bot BG: ✅ AI responded — status="${status}" | reason="${reason}"`)
  console.log(`WA Bot BG: replyMessage="${replyMessage}"`)

  // ── PING OWNER ─────────────────────────────────────────────
  if (replyMessage === 'PING_OWNER' || status === 'needs_owner') {
    candidateStatus[sender] = 'needs_owner'
    await persistState()
    broadcastUpdate()
    chrome.notifications.create(`ping-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.png'),
      title: '⚠️ WA Recruit needs you',
      message: `${sender} sent something the bot can't handle. Please reply manually.`
    })
    chrome.runtime.sendMessage({ type: 'PING_OWNER', sender }).catch(() => {})
    return
  }

  // ── UPDATE STATUS ──────────────────────────────────────────
  if (status && status !== 'screening') {
    candidateStatus[sender] = status

    if (status === 'qualified' || status === 'rejected') {
      chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'INTERVIEW_ENDED',
            sender,
            status
          }).catch(() => {})
        }
      })
    }
  }

  conversations[sender].push({ role: 'assistant', content: replyMessage })
  await persistState()
  broadcastUpdate()

  lastReplyPerSender[sender] = Date.now()

  console.log('WA Bot BG: Sending SEND_REPLY to content script...')
  sendReplyToTab(replyMessage, 0)
}


// ─── SEND REPLY WITH RETRY ────────────────────────────────────
// Retries up to 3 times with 1s delay in case the content script
// context reloaded and needs a moment to re-register its listener.
function sendReplyToTab(replyMessage, attempt) {
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    if (tabs.length === 0) {
      console.log('WA Bot BG: ❌ No WhatsApp tab found')
      return
    }
    const tabId = tabs[0].id
    chrome.tabs.sendMessage(tabId, { type: 'SEND_REPLY', reply: replyMessage }, (resp) => {
      if (chrome.runtime.lastError) {
        console.log(`WA Bot BG: ⚠️ sendMessage attempt ${attempt + 1} failed:`, chrome.runtime.lastError.message)
        if (attempt < 3) {
          setTimeout(() => sendReplyToTab(replyMessage, attempt + 1), 1000)
        } else {
          console.log('WA Bot BG: ❌ All retry attempts failed — reply not delivered')
        }
      } else {
        console.log('WA Bot BG: ✅ SEND_REPLY delivered to content script')
      }
    })
  })
}

// ─── BROADCAST TO SIDE PANEL ──────────────────────────────────
function broadcastUpdate() {
  const summary = buildSummary()
  chrome.storage.local.set({ conversations: summary })
  chrome.runtime.sendMessage({
    type: 'UPDATE_CONVERSATIONS',
    conversations: summary
  }).catch(() => {})
}

function buildSummary() {
  return Object.keys(conversations).map(sender => {
    const history = conversations[sender]
    const last = history[history.length - 1]
    const status = candidateStatus[sender] || 'screening'
    return {
      sender,
      lastMessage: last.content.substring(0, 60) + (last.content.length > 60 ? '...' : ''),
      messageCount: history.length,
      role: last.role,
      status,
      needsOwner: status === 'needs_owner',
      fullHistory: history // include full history for conversation viewer
    }
  })
}

// ─── AI ROUTER ────────────────────────────────────────────────
async function callAI(provider, geminiKey, groqKey, activeJobs, tallyLink, history) {
  const systemPrompt = buildSystemPrompt(activeJobs) // Passes the jobs array now
  console.log(`WA Bot BG: AI router — provider="${provider}"`)

  if (provider === 'freetier') {
    return await callFreeTier(geminiKey, groqKey, systemPrompt, history)
  }

  console.log('WA Bot BG: ❌ Unknown provider:', provider)
  return null
}
// ─── SYSTEM PROMPT ────────────────────────────────────────────
function buildSystemPrompt(activeJobs) {
  // Turn the Supabase array into a context the AI understands
  const jobsContext = activeJobs.map(job => `
    ROLE: ${job.title}
    LOCATION: ${job.locations.join(', ')}
    REQUIREMENTS: ${job.requirements.join(', ')}
    DISQUALIFIERS: ${job.disqualifiers.join(', ')}
    VIBE: ${job.vibe} (Talk in this style)
    SALARY: ${job.salary_min} - ${job.salary_max}
    MUST ASK: ${job.must_ask_question}
    OUTCOME: If qualified, ${job.final_action_type}: ${job.final_action_value}
  `).join("\n---\n");

  return `You are a recruitment assistant. We have ${activeJobs.length} active roles:
  ${jobsContext}

  RULES:
  1. Greet the candidate warmly.
  2. If they haven't mentioned a role, list the available roles and ask which one they want.
  3. Once a role is picked, screen them strictly based on the REQUIREMENTS and DISQUALIFIERS for that specific job.
  4. Ask ONE question at a time.
  5. If they qualify, give them the specific OUTCOME instructions for that job.
  6. Return ONLY valid JSON: {"replyMessage": "...", "status": "screening|qualified|rejected|needs_owner", "reason": "..."}`;
}
// ─── CLAUDE ───────────────────────────────────────────────────
async function callClaude(apiKey, model, systemPrompt, history) {
  const usedModel = model || 'claude-haiku-4-5-20251001'
  console.log(`WA Bot BG: Claude request — model="${usedModel}"`)
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: usedModel,
       // NEW
max_tokens: 1024,
        system: systemPrompt,
        messages: history
      })
    })
    const data = await resp.json()
    console.log('WA Bot BG: Claude raw response status:', resp.status)
    if (data.error) {
      console.log('WA Bot BG: ❌ Claude API error:', JSON.stringify(data.error))
      return null
    }
    console.log('WA Bot BG: Claude raw text:', data.content[0].text)
    return parseAIResponse(data.content[0].text)
  } catch (e) {
    console.error('WA Bot BG: ❌ Claude fetch exception:', e.message)
    return null
  }
}

// ─── OPENAI ───────────────────────────────────────────────────
async function callOpenAI(apiKey, model, systemPrompt, history) {
  const usedModel = model || 'gpt-4o-mini'
  console.log(`WA Bot BG: OpenAI request — model="${usedModel}"`)
  try {
    const messages = [{ role: 'system', content: systemPrompt }, ...history]
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: usedModel,
       max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages
      })
    })
    const data = await resp.json()
    console.log('WA Bot BG: OpenAI raw response status:', resp.status)
    if (data.error) {
      console.log('WA Bot BG: ❌ OpenAI API error:', JSON.stringify(data.error))
      return null
    }
    console.log('WA Bot BG: OpenAI raw text:', data.choices[0].message.content)
    return parseAIResponse(data.choices[0].message.content)
  } catch (e) {
    console.error('WA Bot BG: ❌ OpenAI fetch exception:', e.message)
    return null
  }
}


// ─── FETCH WITH EXPONENTIAL BACKOFF ──────────────────────────
// Retries on 503 (server overload) and 429 (rate limit) with
// increasing delays: 5s → 7.5s → 11.25s (1.5x multiplier each time)
async function fetchWithRetry(url, options, retries = 3, delay = 5000) {
  try {
    const resp = await fetch(url, options)
    if ((resp.status === 503 || resp.status === 429) && retries > 0) {
      console.warn(`WA Bot BG: ⏳ Server busy (${resp.status}) — retrying in ${delay/1000}s... (${retries} left)`)
      await new Promise(r => setTimeout(r, delay))
      return fetchWithRetry(url, options, retries - 1, Math.round(delay * 1.5))
    }
    return resp
  } catch (err) {
    if (retries > 0) {
      console.warn(`WA Bot BG: ⏳ Fetch error — retrying in ${delay/1000}s...`)
      await new Promise(r => setTimeout(r, delay))
      return fetchWithRetry(url, options, retries - 1, Math.round(delay * 1.5))
    }
    throw err
  }
}

// ─── GEMINI ───────────────────────────────────────────────────
async function callGemini(apiKey, model, systemPrompt, history) {
  // Use model from settings; fall back to gemini-2.0-flash
  const usedModel = (model && model.trim()) ? model.trim() : 'gemini-2.0-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${usedModel}:generateContent?key=${apiKey}`

  console.log(`WA Bot BG: Gemini request — model="${usedModel}"`)
  console.log(`WA Bot BG: Gemini URL: ${url.replace(apiKey, 'KEY_HIDDEN')}`)
  console.log(`WA Bot BG: History length: ${history.length} turns`)

  try {
    const contents = history.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))

    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
    // NEW
generationConfig: {
  maxOutputTokens: 1024,
  responseMimeType: 'application/json'
}
    }

    const fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }

    // Use fetchWithRetry for ALL requests — handles 503/429 from the first attempt
    console.log('WA Bot BG: Gemini sending request (with auto-retry)...')
    const resp = await fetchWithRetry(url, fetchOptions, 3, 5000)

    console.log('WA Bot BG: Gemini HTTP status:', resp.status, resp.statusText)

    const data = await resp.json()

    if (data.error) {
      console.log('WA Bot BG: ❌ Gemini API error:', JSON.stringify(data.error))
      console.log('WA Bot BG: Error code:', data.error.code, '| Message:', data.error.message)
      return null
    }

    if (!data.candidates || data.candidates.length === 0) {
      console.log('WA Bot BG: ❌ Gemini returned no candidates:', JSON.stringify(data))
      return null
    }

    const rawText = data.candidates[0].content.parts[0].text
    console.log('WA Bot BG: Gemini raw response text:', rawText)
    return parseAIResponse(rawText)

  } catch (e) {
    console.error('WA Bot BG: ❌ Gemini fetch exception:', e.message, e.stack)
    return null
  }
}

// ─── FREE TIER CALLER ─────────────────────────────────────────
async function callFreeTier(geminiKey, groqKey, systemPrompt, history) {
  const model = await getNextFreeModel()

  if (!model) {
    // All models exhausted — alert the user
    chrome.notifications.create(`limit-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.png'),
      title: '⚠️ Daily limit reached',
      message: 'All free tier models are exhausted for today. Bot paused until midnight.'
    })
    // Broadcast limit state to panel
    chrome.runtime.sendMessage({ type: 'DAILY_LIMIT_REACHED' }).catch(() => {})
    return null
  }

  await incrementModelCounter(model.id)

  if (model.provider === 'gemini') {
    return await callGemini(geminiKey, model.id, systemPrompt, history)
  }

  if (model.provider === 'groq') {
    return await callGroq(groqKey, model.id, systemPrompt, history)
  }

  return null
}

// ─── GROQ CALLER ──────────────────────────────────────────────
async function callGroq(apiKey, model, systemPrompt, history) {
  const usedModel = model || 'llama-3.1-8b-instant'
  console.log(`WA Bot BG: Groq request — model="${usedModel}"`)
  try {
    const messages = [{ role: 'system', content: systemPrompt }, ...history]
    const resp = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: usedModel,
        max_tokens: 1024,
        messages,
        response_format: { type: 'json_object' }
      })
    }, 3, 5000)

    const data = await resp.json()
    console.log('WA Bot BG: Groq raw response status:', resp.status)

    if (data.error) {
      console.log('WA Bot BG: ❌ Groq API error:', JSON.stringify(data.error))
      // If rate limited, mark model as exhausted and retry with next
      if (resp.status === 429) {
        console.log('WA Bot BG: ⏭ Groq 429 — marking exhausted and retrying')
        const counters = await getModelCounters()
        const modelDef = FREE_MODELS.find(m => m.id === usedModel)
        if (modelDef) counters[usedModel] = modelDef.softCap
        await chrome.storage.local.set({ modelCounters: counters })
      }
      return null
    }

    console.log('WA Bot BG: Groq raw text:', data.choices[0].message.content)
    return parseAIResponse(data.choices[0].message.content)
  } catch (e) {
    console.error('WA Bot BG: ❌ Groq fetch exception:', e.message)
    return null
  }
}

// ─── PARSE AI RESPONSE ────────────────────────────────────────
function parseAIResponse(rawText) {
  try {
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    const parsed = JSON.parse(cleaned)
    if (typeof parsed.replyMessage !== 'string') throw new Error('Missing replyMessage')
    console.log('WA Bot BG: Parsed AI response OK — status:', parsed.status)
    return {
      replyMessage: parsed.replyMessage,
      status: parsed.status || 'screening',
      reason: parsed.reason || ''
    }
  } catch (e) {
    console.warn('WA Bot BG: ⚠️ JSON parse failed. Error:', e.message, '| Raw:', rawText.substring(0, 120))
    // If raw text looks like broken JSON (starts with { or [), NEVER send it
    // This is what caused "{" to be delivered to the candidate
    const looksLikeBrokenJSON = rawText.trim().startsWith('{') || rawText.trim().startsWith('[')
    if (looksLikeBrokenJSON) {
      console.warn('WA Bot BG: Suppressing broken JSON — no reply sent')
      return null
    }
    // Only use raw text if it looks like a real sentence
    return {
      replyMessage: rawText.trim(),
      status: 'screening',
      reason: 'Raw text fallback'
    }
  }
}