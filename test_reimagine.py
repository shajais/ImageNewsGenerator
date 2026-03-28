"""
Live test of all reimagine/regenerate AI functions against the article:
https://www.onlinekhabar.com/2026/03/1899906/i-dont-think-there-is-a-need-for-immediate-arrest
"""
import urllib.request, json, re

TITLE = "i dont think there is a need for immediate arrest"
BODY = (
    "14 Chaitra, Kathmandu. Former PM and CPN-UML Chairman KP Sharma Oli and former Home "
    "Minister Congress leader Ramesh Lekhak were arrested after the government decided to "
    "implement the Gauri Bahadur Karki Commission report, which named them guilty and "
    "recommended action. Police issued urgent arrest warrants. Oli is admitted to TU Teaching "
    "Hospital bed 501. Lekhak is held at Police Battalion 2, Maharajgunj. Former AIG "
    "Tekprasad Rai told Onlinekhabar: The JanZ (GenZ) movement of Bhadra 23-24 caused a "
    "change of government. This arrest should be seen as a political event, not purely "
    "criminal. The government should have formed an investigation team first, completed "
    "chain-of-custody and scene-of-crime documentation, taken statements, before making any "
    "arrest. Immediate arrest was not necessary. The risk now is that UML will treat this "
    "as political revenge, protest, and the situation could escalate into fresh conflict. "
    "Nepal needs peace and prosperity."
)

def call_gemini(prompt):
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.85, "maxOutputTokens": 1200}
    }).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:3000/proxy/gemini", data=payload,
        headers={"Content-Type": "application/json; charset=utf-8", "Accept-Encoding": "identity"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw_bytes = r.read()
            print("  [HTTP " + str(r.status) + "] " + str(len(raw_bytes)) + " bytes")
            if not raw_bytes:
                return {"raw": "EMPTY_RESPONSE"}
            resp = json.loads(raw_bytes)
            raw = resp["candidates"][0]["content"]["parts"][0]["text"]
            mo = re.search(r'\{[\s\S]*\}', raw)
            ma = re.search(r'\[[\s\S]*\]', raw)
            if mo:
                try: return json.loads(mo.group(0))
                except: pass
            if ma:
                try: return json.loads(ma.group(0))
                except: pass
            return {"raw": raw}
    except urllib.error.HTTPError as e:
        body = e.read()
        print("  [HTTP ERROR " + str(e.code) + "]: " + str(body[:300]))
        return {"raw": "HTTP_ERROR_" + str(e.code)}
    except Exception as e:
        print("  [EXCEPTION]: " + str(e))
        return {"raw": str(e)}

SEP = "=" * 62

# ── TEST 1: rewriteWithAI ──────────────────────────────────────
print(SEP)
print("TEST 1 — rewriteWithAI  (initial generation, all 4 fields)")
print(SEP)
p1 = (
    "You are a professional Nepali viral news editor with deep knowledge of Nepal's current affairs.\n\n"
    "TASK: Read the news story carefully and produce 100% original Nepali content specific to THIS story.\n\n"
    "SOURCE NEWS (English):\n"
    "Title: " + TITLE + "\n"
    "Body: " + BODY + "\n\n"
    "RULES:\n"
    "1. hook: 1 emoji + max 20 Nepali words — must name KP Sharma Oli or Ramesh Lekhak or Karki Commission\n"
    "2. title: max 12 Nepali words, SEO — must contain a key proper noun from the story\n"
    "3. description: 3-4 sentences, 60-90 Nepali words — S1 what/who, S2 cause/context, S3 impact, S4 what next\n"
    "4. hashtags: exactly 8 — min 4 story-specific (ओली, लेखक, कार्कीआयोग, etc.), mix Nepali+English\n"
    "   FORBIDDEN tags: #Nepal #नेपाल #NepalNews #BreakingNews #Kathmandu\n"
    "5. All text in Nepali Devanagari. Return ONLY raw JSON, no markdown.\n\n"
    "Return ONLY a raw JSON object with keys: hook, title, description, hashtags (array of 8 strings). No markdown."
)
r1 = call_gemini(p1)
print("HOOK:        ", r1.get("hook", "NOT FOUND"))
print("TITLE:       ", r1.get("title", "NOT FOUND"))
print("DESCRIPTION: ", r1.get("description", "NOT FOUND"))
print("HASHTAGS:    ", r1.get("hashtags", "NOT FOUND"))

# ── TEST 2: reimagineField HOOK ────────────────────────────────
print()
print(SEP)
print("TEST 2 — reimagineField: HOOK  (fresh angle)")
print(SEP)
existing_hook = r1.get("hook", "")
p2 = (
    "You are a professional Nepali viral news editor.\n\n"
    "NEWS STORY:\n"
    "Title: " + TITLE + "\n"
    "Body: " + BODY + "\n\n"
    "TASK: Write ONE brand-new viral hook — completely different angle from the existing one.\n\n"
    "RULES:\n"
    "1. Must specifically name KP Sharma Oli OR Ramesh Lekhak OR Karki Commission\n"
    "2. Start with exactly 1 emoji matching the mood\n"
    "3. Max 20 Nepali words, emotionally gripping\n"
    "4. Nepali Devanagari only\n"
    "5. FORBIDDEN phrases: नेपालमा ठूलो घटना, ब्रेकिङ न्युज, यो समाचार\n"
    "6. Existing hook to avoid: " + existing_hook + "\n\n"
    "Return ONLY raw JSON: {\"hook\":\"...\"} — No markdown."
)
r2 = call_gemini(p2)
print("REIMAGINED HOOK:", r2.get("hook", "NOT FOUND"))

# ── TEST 3: reimagineField TITLE ───────────────────────────────
print()
print(SEP)
print("TEST 3 — reimagineField: TITLE  (fresh SEO headline)")
print(SEP)
existing_title = r1.get("title", "")
p3 = (
    "You are a Nepali SEO news editor.\n\n"
    "NEWS STORY:\n"
    "Title: " + TITLE + "\n"
    "Body: " + BODY + "\n\n"
    "TASK: Write ONE brand-new Nepali SEO headline.\n\n"
    "RULES:\n"
    "1. Must contain at least one of: ओली, रमेश लेखक, कार्की आयोग, टेकप्रसाद राई\n"
    "2. Max 12 Nepali words, factual\n"
    "3. Nepali Devanagari only\n"
    "4. Existing title to avoid: " + existing_title + "\n\n"
    "Return ONLY raw JSON: {\"title\":\"...\"} — No markdown."
)
r3 = call_gemini(p3)
print("REIMAGINED TITLE:", r3.get("title", "NOT FOUND"))

# ── TEST 4: reimagineField DESCRIPTION ────────────────────────
print()
print(SEP)
print("TEST 4 — reimagineField: DESCRIPTION  (fresh paragraph)")
print(SEP)
existing_desc = r1.get("description", "")
p4 = (
    "You are a Nepali news journalist.\n\n"
    "NEWS STORY:\n"
    "Title: " + TITLE + "\n"
    "Body: " + BODY + "\n\n"
    "TASK: Write a completely fresh 3-4 sentence description.\n\n"
    "RULES:\n"
    "1. S1: What happened + who (KP Sharma Oli, Ramesh Lekhak, Karki Commission, Teaching Hospital)\n"
    "2. S2: Cause/context (Bhadra 23-24 movement, commission recommendation)\n"
    "3. S3: Reaction/impact (Tekprasad Rai, UML protest risk)\n"
    "4. S4: Current status or what happens next\n"
    "5. Total 60-90 Nepali words, Devanagari only\n"
    "6. Existing desc to avoid: " + existing_desc[:100] + "\n\n"
    "Return ONLY raw JSON: {\"description\":\"...\"} — No markdown."
)
r4 = call_gemini(p4)
print("REIMAGINED DESC:", r4.get("description", "NOT FOUND"))

# ── TEST 5: regenerateHashtags ─────────────────────────────────
print()
print(SEP)
print("TEST 5 — regenerateHashtags  (fresh set)")
print(SEP)
p5 = (
    "You are a Nepali social media expert who knows trending hashtags.\n\n"
    "NEWS STORY:\n"
    "Title: " + TITLE + "\n"
    "Body: " + BODY[:500] + "\n\n"
    "TASK: Generate exactly 8 hashtags for this story to maximise reach.\n\n"
    "RULES:\n"
    "1. At least 4 MUST be story-specific: ओली, लेखक, कार्कीआयोग, टेकप्रसादराई, भदौआन्दोलन, शिक्षणअस्पताल\n"
    "2. Mix Nepali Devanagari + English\n"
    "3. FORBIDDEN: #Nepal #नेपाल #NepalNews #नेपालसमाचार #BreakingNews #Kathmandu\n\n"
    "Return ONLY a raw JSON array of 8 strings: [\"#Tag1\",\"#Tag2\",...]"
)
r5 = call_gemini(p5)
tags = r5 if isinstance(r5, list) else r5.get("hashtags", r5.get("raw", "NOT FOUND"))
print("HASHTAGS:", tags)

print()
print(SEP)
print("ALL TESTS COMPLETE")
print(SEP)
